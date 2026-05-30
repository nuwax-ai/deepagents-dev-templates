/**
 * Nuwax Platform Client
 *
 * Direct API integration with the Nuwax platform.
 * Handles: saving prompts, querying plugins, binding components,
 * managing variables, executing plugins, and creating debug sessions.
 */

import { logger } from "./logger.js";

// ─── Types ──────────────────────────────────────────────

export interface PlatformClientOptions {
  apiBaseUrl: string;
  agentId: string;
  spaceId: string;
  authToken?: string;
  authType?: "bearer" | "apikey";
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  type: "mcp" | "api" | "workflow";
  config?: Record<string, unknown>;
}

export interface AgentVariable {
  id: string;
  name: string;
  description: string;
  value?: string;
  type: "string" | "secret" | "number" | "boolean";
  required: boolean;
}

export interface ComponentBinding {
  componentId: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface DebugSession {
  id: string;
  agentId: string;
  status: "active" | "completed" | "error";
  createdAt: string;
}

// ─── Client Implementation ──────────────────────────────

export class PlatformClient {
  private apiBaseUrl: string;
  private agentId: string;
  private spaceId: string;
  private authToken: string;
  private authType: "bearer" | "apikey";
  private timeout: number;
  private log = logger.child("platform");
  private variablesCache: { data: AgentVariable[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 30_000; // 30 seconds

  constructor(options: PlatformClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.agentId = options.agentId;
    this.spaceId = options.spaceId;
    this.authToken = options.authToken ?? process.env.PLATFORM_API_TOKEN ?? "";
    this.authType = options.authType ?? "bearer";
    this.timeout = options.timeout ?? 30_000;
  }

  // ─── HTTP Helpers ───────────────────────────────────

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      if (this.authType === "bearer") {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      } else {
        headers["X-API-Key"] = this.authToken;
      }
    }
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;
    this.log.debug(`${method} ${url}`, { body: body ? "present" : "none" });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Platform API error: ${response.status} ${response.statusText} — ${text}`
        );
      }

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Platform API timeout: ${method} ${url} exceeded ${this.timeout}ms`);
      }
      throw err;
    }
  }

  // ─── Prompt Management ──────────────────────────────

  /**
   * Save AI-generated prompt to platform agent config.
   * This is called when the AI generates or modifies a prompt
   * during agent development.
   */
  async savePrompt(prompt: string, metadata?: Record<string, unknown>): Promise<void> {
    this.log.info("Saving prompt to platform", {
      agentId: this.agentId,
      length: prompt.length,
    });

    await this.request("PUT", `/api/agents/${this.agentId}/prompt`, {
      prompt,
      metadata: {
        ...metadata,
        updatedAt: new Date().toISOString(),
        source: "ai-generated",
      },
    });
  }

  // ─── Plugin Discovery ───────────────────────────────

  /**
   * Query available platform plugins/tools.
   * Used by the platform-tool-selection skill to find
   * existing tools before writing custom code.
   */
  async queryPlugins(query: string, options?: {
    type?: "mcp" | "api" | "workflow";
    limit?: number;
  }): Promise<PluginInfo[]> {
    this.log.debug("Querying plugins", { query, type: options?.type });

    const params = new URLSearchParams({ q: query });
    if (options?.type) params.set("type", options.type);
    if (options?.limit) params.set("limit", String(options.limit));

    const result = await this.request<{ plugins: PluginInfo[] }>(
      "GET",
      `/api/spaces/${this.spaceId}/plugins?${params.toString()}`
    );

    return result.plugins;
  }

  // ─── Component Binding ──────────────────────────────

  /**
   * Bind a platform component to the agent.
   */
  async bindComponent(binding: ComponentBinding): Promise<void> {
    this.log.info("Binding component", {
      agentId: this.agentId,
      componentId: binding.componentId,
    });

    await this.request("POST", `/api/agents/${this.agentId}/components`, binding);
  }

  /**
   * List all components bound to the agent.
   */
  async listComponents(): Promise<ComponentBinding[]> {
    const result = await this.request<{ components: ComponentBinding[] }>(
      "GET",
      `/api/agents/${this.agentId}/components`
    );
    return result.components;
  }

  // ─── Variable Management ────────────────────────────

  /**
   * Create an agent variable (e.g., for API keys, config values).
   * The variable starts with an empty value — the user fills it
   * in via the platform UI.
   */
  async createVariable(
    variable: Omit<AgentVariable, "id">
  ): Promise<AgentVariable> {
    this.log.info("Creating agent variable", {
      name: variable.name,
      type: variable.type,
    });

    const result = await this.request<AgentVariable>(
      "POST",
      `/api/agents/${this.agentId}/variables`,
      variable
    );

    // Invalidate cache since we added a new variable
    this.variablesCache = null;
    return result;
  }

  /**
   * Update an agent variable's value.
   */
  async updateVariable(
    variableId: string,
    value: string
  ): Promise<AgentVariable> {
    this.log.info("Updating agent variable", { variableId });

    const result = await this.request<AgentVariable>(
      "PATCH",
      `/api/agents/${this.agentId}/variables/${variableId}`,
      { value }
    );

    // Invalidate cache since we modified a variable
    this.variablesCache = null;
    return result;
  }

  /**
   * List all agent variables (with 30s cache to avoid N+1 queries).
   */
  async listVariables(): Promise<AgentVariable[]> {
    const now = Date.now();
    if (this.variablesCache && (now - this.variablesCache.timestamp) < this.CACHE_TTL) {
      return this.variablesCache.data;
    }

    const result = await this.request<{ variables: AgentVariable[] }>(
      "GET",
      `/api/agents/${this.agentId}/variables`
    );

    this.variablesCache = { data: result.variables, timestamp: now };
    return result.variables;
  }

  /**
   * Get a specific variable's value (uses cached list).
   */
  async getVariable(name: string): Promise<AgentVariable | null> {
    const variables = await this.listVariables();
    return variables.find((v) => v.name === name) ?? null;
  }

  // ─── Plugin Execution ───────────────────────────────

  /**
   * Execute a platform plugin in the sandbox.
   */
  async executePlugin(
    pluginId: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    this.log.info("Executing plugin", { pluginId });

    return await this.request<Record<string, unknown>>(
      "POST",
      `/api/plugins/${pluginId}/execute`,
      { params }
    );
  }

  // ─── Debug Sessions ─────────────────────────────────

  /**
   * Create a devMode debug session for testing.
   */
  async createDebugSession(config?: {
    model?: string;
    mcpServers?: Record<string, unknown>;
  }): Promise<DebugSession> {
    this.log.info("Creating debug session", { agentId: this.agentId });

    return await this.request<DebugSession>(
      "POST",
      `/api/agents/${this.agentId}/debug-sessions`,
      config
    );
  }

  /**
   * Get debug session status.
   */
  async getDebugSession(sessionId: string): Promise<DebugSession> {
    return await this.request<DebugSession>(
      "GET",
      `/api/agents/${this.agentId}/debug-sessions/${sessionId}`
    );
  }
}
