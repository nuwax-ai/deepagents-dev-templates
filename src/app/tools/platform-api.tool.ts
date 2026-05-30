/**
 * Platform API Tool
 *
 * Direct access to Nuwax platform APIs — built with @langchain/core/tools.
 * The platformClient is injected at factory time via closure.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { PlatformClient } from "../../runtime/platform-client.js";

/**
 * Create the platform_api tool bound to a specific PlatformClient instance.
 * Called from agent-factory at agent creation time.
 */
export function createPlatformApiTool(platformClient: PlatformClient) {
  return tool(
    async ({ operation, params }) => {
      try {
        const p = params || {};
        switch (operation) {
          case "save_prompt": {
            const prompt = typeof p.prompt === "string" ? p.prompt : null;
            if (!prompt) return "Error: 'prompt' parameter must be a string";
            await platformClient.savePrompt(prompt, p.metadata as Record<string, unknown>);
            return `Prompt saved to platform (${prompt.length} chars)`;
          }

          case "query_plugins": {
            const query = typeof p.query === "string" ? p.query : "";
            const type = ["mcp", "api", "workflow"].includes(p.type as string)
              ? (p.type as "mcp" | "api" | "workflow")
              : undefined;
            const limit = typeof p.limit === "number" ? p.limit : undefined;
            const plugins = await platformClient.queryPlugins(query, { type, limit });
            return JSON.stringify({ count: plugins.length, plugins }, null, 2);
          }

          case "bind_component": {
            const componentId = typeof p.componentId === "string" ? p.componentId : null;
            if (!componentId) return "Error: 'componentId' parameter must be a string";
            const type = typeof p.type === "string" ? p.type : "generic";
            await platformClient.bindComponent({
              componentId,
              type,
              config: p.config as Record<string, unknown>,
            });
            return `Component "${componentId}" bound to agent`;
          }

          case "list_components": {
            const components = await platformClient.listComponents();
            return JSON.stringify({ count: components.length, components }, null, 2);
          }

          case "execute_plugin": {
            const pluginId = typeof p.pluginId === "string" ? p.pluginId : null;
            if (!pluginId) return "Error: 'pluginId' parameter must be a string";
            const result = await platformClient.executePlugin(
              pluginId,
              (p.pluginParams as Record<string, unknown>) || {}
            );
            return JSON.stringify(result, null, 2);
          }

          case "create_debug_session": {
            const model = typeof p.model === "string" ? p.model : undefined;
            const session = await platformClient.createDebugSession({ model });
            return JSON.stringify(session, null, 2);
          }

          default:
            return `Unknown operation: ${operation}`;
        }
      } catch (err) {
        return `Platform API error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "platform_api",
      description: `Call Nuwax platform APIs for agent management.

Operations:
- save_prompt: Save AI-generated prompt to platform agent config (params: { prompt, metadata? })
- query_plugins: Search available platform plugins/tools (params: { query, type?, limit? })
- bind_component: Bind a platform component to the agent (params: { componentId, type?, config? })
- list_components: List components bound to the agent (params: {})
- execute_plugin: Execute a platform plugin (params: { pluginId, pluginParams? })
- create_debug_session: Create a devMode debug session (params: { model? })

IMPORTANT: Before writing custom tool code, ALWAYS use query_plugins to check
if the platform already provides the needed functionality.`,
      schema: z.object({
        operation: z
          .enum([
            "save_prompt",
            "query_plugins",
            "bind_component",
            "list_components",
            "execute_plugin",
            "create_debug_session",
          ])
          .describe("The platform API operation to perform"),
        params: z
          .record(z.unknown())
          .optional()
          .describe("Operation-specific parameters"),
      }),
    }
  );
}
