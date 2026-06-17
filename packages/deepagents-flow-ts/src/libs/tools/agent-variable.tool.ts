/**
 * Agent Variable Tool
 *
 * Manages agent variables — placeholders for API keys, base URLs, etc.
 * Built with @langchain/core/tools, bound to VariableManager at factory time.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { VariableManager } from "../../runtime/platform/variable-manager.js";

/**
 * Create the agent_variable tool bound to a specific VariableManager instance.
 */
export function createAgentVariableTool(variableManager: VariableManager) {
  return tool(
    async ({ operation, name, description, type, required, value }) => {
      switch (operation) {
        case "create": {
          if (!name) return "Error: 'name' is required for create";
          const variable = await variableManager.create({
            name,
            description: description || "",
            type: type || "string",
            required: required !== false,
          });
          return JSON.stringify({
            status: "created",
            variable: {
              id: variable.id,
              name: variable.name,
              type: variable.type,
              message: `Variable "${variable.name}" created. User will fill in the value via platform UI.`,
            },
          });
        }

        case "get": {
          if (!name) return "Error: 'name' is required for get";
          const val = await variableManager.get(name);
          return JSON.stringify({
            name,
            value: val ?? null,
            source: val ? "resolved" : "not_set",
            hint: !val
              ? `Variable "${name}" has no value yet. User needs to set it via platform UI or AGENT_VAR_${name} env var.`
              : undefined,
          });
        }

        case "set": {
          if (!name || !value) return "Error: 'name' and 'value' required for set";
          await variableManager.set(name, value);
          return `Variable "${name}" updated.`;
        }

        case "list": {
          const variables = await variableManager.list();
          return JSON.stringify({
            count: variables.length,
            variables: variables.map((v) => ({
              name: v.name,
              type: v.type,
              hasValue: !!v.value,
              required: v.required,
            })),
          });
        }

        default:
          return `Unknown operation: ${operation}`;
      }
    },
    {
      name: "agent_variable",
      description: `Manage agent variables for configuration values (API keys, base URLs, tenant IDs).

Use this when your custom tools need external credentials or user-configurable values.
The AI creates variables as placeholders — the user fills in actual values via platform UI.

Operations:
- create: Create a new variable (params: name, description, type, required)
- get: Get a variable's current value (params: name)
- set: Update a variable's value (params: name, value)
- list: List all agent variables

Example workflow for a tool needing an API key:
1. agent_variable(operation: "create", name: "WEATHER_API_KEY", description: "API key for weather service", type: "secret")
2. In tool code: const apiKey = await variableManager.get("WEATHER_API_KEY")
3. User fills in the key via platform UI`,
      schema: z.object({
        operation: z
          .enum(["create", "get", "set", "list"])
          .describe("Variable operation"),
        name: z
          .string()
          .optional()
          .describe("Variable name (UPPER_SNAKE_CASE recommended)"),
        description: z
          .string()
          .optional()
          .describe("Human-readable description"),
        type: z
          .enum(["string", "secret", "number", "boolean"])
          .optional()
          .describe("Variable type (secret = hidden in UI)"),
        required: z
          .boolean()
          .optional()
          .describe("Whether this variable must have a value"),
        value: z
          .string()
          .optional()
          .describe("Value to set (for 'set' operation)"),
      }),
    }
  );
}
