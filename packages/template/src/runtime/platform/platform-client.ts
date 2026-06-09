/**
 * Nuwax Platform Client
 *
 * Direct API integration with the Nuwax platform.
 * Handles: saving prompts, querying plugins, binding components,
 * managing variables, executing plugins, and creating debug sessions.
 */

import { logger } from "../logger.js";
import type { MCPConfig, MCPServerConfig } from "./mcp-manager.js";

// ─── Types ──────────────────────────────────────────────

export interface PlatformClientOptions {
  apiBaseUrl: string;
  agentId: string;
  spaceId: string;
  authToken?: string;
  authType?: "bearer" | "apikey";
  endpoints?: Partial<Record<PlatformOperation, PlatformEndpoint>>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export type PlatformOperation =
  | "savePrompt"
  | "queryPlugins"
  | "bindComponent"
  | "listComponents"
  | "createVariable"
  | "updateVariable"
  | "listVariables"
  | "executePlugin"
  | "executeWorkflow"
  | "createDebugSession"
  | "getDebugSession";

export interface PlatformEndpoint {
  method: string;
  path: string;
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

const DEFAULT_ENDPOINTS: Record<PlatformOperation, PlatformEndpoint> = {
  savePrompt: { method: "POST", path: "/api/agent/config/update" },
  queryPlugins: { method: "GET", path: "/api/agent/component/search" },
  bindComponent: { method: "POST", path: "/api/agent/component/add" },
  listComponents: { method: "GET", path: "/api/agent/component/list/{agentId}" },
  createVariable: { method: "POST", path: "/api/agent/variable/add" },
  updateVariable: { method: "POST", path: "/api/agent/variable/update" },
  listVariables: { method: "GET", path: "/api/agent/variable/list/{agentId}" },
  executePlugin: { method: "POST", path: "/api/v1/plugin/{pluginId}/execute" },
  executeWorkflow: { method: "POST", path: "/api/v1/workflow/{workflowId}/execute" },
  createDebugSession: { method: "POST", path: "/api/agent/debug/session" },
  getDebugSession: { method: "GET", path: "/api/agent/debug/session/{sessionId}" },
};

export class PlatformClient {
  private apiBaseUrl: string;
  private agentId: string;
  private spaceId: string;
  private authToken: string;
  private authType: "bearer" | "apikey";
  private timeout: number;
  private endpoints: Record<PlatformOperation, PlatformEndpoint>;
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
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...options.endpoints };
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

  private endpoint(
    operation: PlatformOperation,
    params: Record<string, string> = {}
  ): PlatformEndpoint {
    const endpoint = this.endpoints[operation];
    const replacements: Record<string, string> = {
      agentId: this.agentId,
      spaceId: this.spaceId,
      ...params,
    };

    return {
      method: endpoint.method.toUpperCase(),
      path: endpoint.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) =>
        encodeURIComponent(replacements[key] ?? "")
      ),
    };
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

    const endpoint = this.endpoint("savePrompt");
    await this.request(endpoint.method, endpoint.path, {
      agentId: this.agentId,
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

    const endpoint = this.endpoint("queryPlugins");
    const path = endpoint.method === "GET"
      ? `${endpoint.path}?${params.toString()}`
      : endpoint.path;
    const result = await this.request<{ plugins: PluginInfo[] }>(
      endpoint.method,
      path,
      endpoint.method === "GET" ? undefined : { query, ...options, agentId: this.agentId, spaceId: this.spaceId }
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

    const endpoint = this.endpoint("bindComponent");
    await this.request(endpoint.method, endpoint.path, {
      agentId: this.agentId,
      spaceId: this.spaceId,
      ...binding,
    });
  }

  /**
   * List all components bound to the agent.
   */
  async listComponents(): Promise<ComponentBinding[]> {
    const endpoint = this.endpoint("listComponents");
    const result = await this.request<{ components: ComponentBinding[] }>(
      endpoint.method,
      endpoint.path
    );
    return result.components;
  }

  /**
   * Read platform-bound MCP components and normalize them to the template MCP
   * config shape. Platform payloads are allowed to be flexible so endpoint
   * contracts can evolve without changing the agent runtime:
   *
   * - { type: "mcp", config: { command, args, env } }
   * - { type: "mcp", config: { url, headers/env } }
   * - { config: { mcpServer: { ... } } }
   * - { config: { mcp: { servers: { name: { ... } } } } }
   */
  async listMcpServers(): Promise<MCPConfig> {
    const components = await this.listComponents();
    const servers: Record<string, MCPServerConfig> = {};

    for (const component of components) {
      const normalized = normalizeComponentMcpServers(component);
      for (const [name, server] of Object.entries(normalized)) {
        servers[name] = server;
      }
    }

    return { servers };
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

    const endpoint = this.endpoint("createVariable");
    const result = await this.request<AgentVariable>(
      endpoint.method,
      endpoint.path,
      { agentId: this.agentId, ...variable }
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

    const endpoint = this.endpoint("updateVariable");
    const result = await this.request<AgentVariable>(
      endpoint.method,
      endpoint.path,
      { agentId: this.agentId, variableId, value }
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

    const endpoint = this.endpoint("listVariables");
    const result = await this.request<{ variables: AgentVariable[] }>(
      endpoint.method,
      endpoint.path
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

    const endpoint = this.endpoint("executePlugin", { pluginId });
    return await this.request<Record<string, unknown>>(
      endpoint.method,
      endpoint.path,
      { agentId: this.agentId, spaceId: this.spaceId, params }
    );
  }

  /**
   * Execute a platform workflow in the sandbox.
   */
  async executeWorkflow(
    workflowId: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    this.log.info("Executing workflow", { workflowId });

    const endpoint = this.endpoint("executeWorkflow", { workflowId });
    return await this.request<Record<string, unknown>>(
      endpoint.method,
      endpoint.path,
      { agentId: this.agentId, spaceId: this.spaceId, params }
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

    const endpoint = this.endpoint("createDebugSession");
    return await this.request<DebugSession>(
      endpoint.method,
      endpoint.path,
      { agentId: this.agentId, spaceId: this.spaceId, ...config }
    );
  }

  /**
   * Get debug session status.
   */
  async getDebugSession(sessionId: string): Promise<DebugSession> {
    const endpoint = this.endpoint("getDebugSession", { sessionId });
    return await this.request<DebugSession>(
      endpoint.method,
      endpoint.path
    );
  }
}

function normalizeComponentMcpServers(
  component: ComponentBinding
): Record<string, MCPServerConfig> {
  const config = component.config ?? {};
  const result: Record<string, MCPServerConfig> = {};

  const addServer = (name: string, candidate: unknown) => {
    const server = normalizeMcpServer(candidate);
    if (server) {
      result[toServerName(name)] = server;
    }
  };

  const mcp = config.mcp;
  if (isRecord(mcp)) {
    if (isRecord(mcp.servers)) {
      for (const [name, server] of Object.entries(mcp.servers)) {
        addServer(name, server);
      }
    } else {
      addServer(component.componentId, mcp);
    }
  }

  if (isRecord(config.mcpServer)) {
    const name =
      typeof config.name === "string"
        ? config.name
        : typeof config.serverName === "string"
          ? config.serverName
          : component.componentId;
    addServer(name, config.mcpServer);
  }

  if (
    component.type === "mcp" &&
    (typeof config.command === "string" || typeof config.url === "string")
  ) {
    const name =
      typeof config.name === "string"
        ? config.name
        : typeof config.serverName === "string"
          ? config.serverName
          : component.componentId;
    addServer(name, config);
  }

  return result;
}

function normalizeMcpServer(candidate: unknown): MCPServerConfig | null {
  if (!isRecord(candidate)) return null;

  const command = typeof candidate.command === "string" ? candidate.command : undefined;
  const url = typeof candidate.url === "string" ? candidate.url : undefined;
  if (!command && !url) return null;

  const server: MCPServerConfig = {};
  if (command) server.command = command;
  if (url) server.url = url;
  if (Array.isArray(candidate.args)) {
    server.args = candidate.args.filter((arg): arg is string => typeof arg === "string");
  }
  if (typeof candidate.description === "string") {
    server.description = candidate.description;
  }
  if (isStringRecord(candidate.env)) {
    server.env = candidate.env;
  }
  if (isRecord(candidate.auth)) {
    const type = candidate.auth.type;
    if (type === "env" || type === "header") {
      server.auth = {
        type,
        var: typeof candidate.auth.var === "string" ? candidate.auth.var : undefined,
        header: typeof candidate.auth.header === "string" ? candidate.auth.header : undefined,
      };
    }
  }
  return server;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
}

function toServerName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "platform-mcp";
}
