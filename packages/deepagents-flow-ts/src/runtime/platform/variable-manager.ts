/**
 * Variable Manager
 *
 * Manages agent variables — configuration values like API keys,
 * base URLs, and tenant settings that the AI creates as placeholders
 * and users fill in via the platform UI.
 */

import { logger } from "../logger.js";
import { PlatformClient, type AgentVariable } from "./platform-client.js";

// ─── Types ──────────────────────────────────────────────

export interface VariableDefinition {
  name: string;
  description: string;
  type: "string" | "secret" | "number" | "boolean";
  required: boolean;
  defaultValue?: string;
}

export interface VariableStore {
  [name: string]: string | undefined;
}

// ─── Variable Manager ───────────────────────────────────

export class VariableManager {
  private log = logger.child("variables");
  private localCache: Map<string, AgentVariable> = new Map();
  private platformClient: PlatformClient | null = null;
  private envPrefix = "AGENT_VAR_";

  constructor(options?: { platformClient?: PlatformClient; envPrefix?: string }) {
    if (options?.platformClient) {
      this.platformClient = options.platformClient;
    }
    if (options?.envPrefix) {
      this.envPrefix = options.envPrefix;
    }
  }

  /** Convert a variable name to its environment variable key */
  private toEnvKey(name: string): string {
    return `${this.envPrefix}${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  }

  /**
   * Create a new agent variable.
   * Called by the AI when it needs an API key or config value
   * for a custom tool.
   */
  async create(definition: VariableDefinition): Promise<AgentVariable> {
    this.log.info("Creating variable", {
      name: definition.name,
      type: definition.type,
    });

    // Check if already exists
    const existing = this.localCache.get(definition.name);
    if (existing) {
      this.log.debug(`Variable "${definition.name}" already exists`, { id: existing.id });
      return existing;
    }

    if (this.platformClient) {
      // Register with platform
      const variable = await this.platformClient.createVariable(definition);
      this.localCache.set(definition.name, variable);
      return variable;
    }

    // Local-only mode (no platform connection)
    const localVariable: AgentVariable = {
      id: `local_${Date.now()}_${definition.name}`,
      ...definition,
      value: definition.defaultValue ?? "",
    };
    this.localCache.set(definition.name, localVariable);
    return localVariable;
  }

  /**
   * Get a variable's value.
   * Priority: env var > platform value > local cache > default
   */
  async get(name: string): Promise<string | undefined> {
    // Check environment variable first (use !== undefined to preserve empty strings)
    const envValue = process.env[this.toEnvKey(name)];
    if (envValue !== undefined) {
      return envValue;
    }

    // Check local cache (use !== undefined to preserve empty strings)
    const cached = this.localCache.get(name);
    if (cached?.value !== undefined) {
      return cached.value;
    }

    // Fetch from platform if available
    if (this.platformClient) {
      try {
        const variable = await this.platformClient.getVariable(name);
        if (variable) {
          this.localCache.set(name, variable);
          return variable.value;
        }
      } catch (err) {
        this.log.warn("Failed to fetch variable from platform", {
          name,
          error: String(err),
        });
      }
    }

    this.log.debug(`Variable "${name}" not found`);
    return undefined;
  }

  /**
   * Update a variable's value.
   */
  async set(name: string, value: string): Promise<void> {
    this.log.info("Setting variable value", { name });

    let cached = this.localCache.get(name);

    // If not in cache, try to fetch from platform first
    if (!cached && this.platformClient) {
      try {
        const platformVar = await this.platformClient.getVariable(name);
        if (platformVar) {
          this.localCache.set(name, platformVar);
          cached = platformVar;
        }
      } catch (err) {
        this.log.debug("Variable not found on platform, will create local-only", {
          name,
          error: String(err),
        });
      }
    }

    // Update cache if we have the variable
    if (cached) {
      cached.value = value;
    } else {
      // Create a local-only entry
      this.localCache.set(name, {
        name,
        value,
        type: "string",
        required: false,
        description: "",
        id: `local-${Date.now()}`,
      });
    }

    // Persist to platform if we have a platform ID
    if (this.platformClient && cached?.id) {
      await this.platformClient.updateVariable(cached.id, value);
    }
  }

  /**
   * List all known variables.
   */
  async list(): Promise<AgentVariable[]> {
    // Merge platform variables with local cache
    if (this.platformClient) {
      try {
        const platformVars = await this.platformClient.listVariables();
        for (const v of platformVars) {
          this.localCache.set(v.name, v);
        }
      } catch (err) {
        this.log.warn("Failed to fetch variables from platform", {
          error: String(err),
        });
      }
    }

    return Array.from(this.localCache.values());
  }

  /**
   * Check if all required variables have values.
   * Returns list of missing variables.
   * Honors env-var priority chain (same as get()).
   */
  async checkRequired(): Promise<{ allPresent: boolean; missing: string[] }> {
    const variables = await this.list();
    const missing: string[] = [];

    for (const v of variables) {
      if (!v.required) continue;

      // Check env var first (priority chain: env > cache > platform)
      const envValue = process.env[this.toEnvKey(v.name)];
      const hasValue = (envValue !== undefined) || (v.value !== undefined);

      if (!hasValue) {
        missing.push(v.name);
      }
    }

    return {
      allPresent: missing.length === 0,
      missing,
    };
  }

  /**
   * Export all variables as environment variable mappings.
   * Useful for passing to MCP server configs or tool execution.
   * Honors env-var priority chain (same as get()).
   *
   * Includes both:
   *  - Variables known to the manager (from platform or cache)
   *  - Env vars matching the prefix that may not be in the variable registry
   */
  async toEnvMap(): Promise<Record<string, string>> {
    const variables = await this.list();
    const envMap: Record<string, string> = {};

    // 1. Export known variables with env override
    for (const v of variables) {
      const envValue = process.env[this.toEnvKey(v.name)];
      const value = envValue !== undefined ? envValue : v.value;
      if (value !== undefined) {
        envMap[this.toEnvKey(v.name)] = value;
      }
    }

    // 2. Also include env-only variables (not in the registry)
    for (const [envKey, envValue] of Object.entries(process.env)) {
      if (envKey.startsWith(this.envPrefix) && envValue !== undefined) {
        if (!(envKey in envMap)) {
          envMap[envKey] = envValue;
        }
      }
    }

    return envMap;
  }
}
