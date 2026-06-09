/**
 * Example Tool Template
 *
 * Use this as a starting point for creating new custom tools.
 *
 * Steps:
 * 1. Copy this file and rename to {your-tool-name}.tool.ts
 * 2. Update the tool function, description, and Zod schema
 * 3. Add to createTools() in src/app/tools/index.ts
 *
 * Tools use @langchain/core/tools `tool()` helper so they are
 * fully compatible with deepagents' tool system.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const exampleTool = tool(
  async ({ param1, param2 }) => {
    // Your tool logic here
    return `Example result: param1="${param1}", param2=${param2}`;
  },
  {
    name: "example_tool",
    description: `Example tool template. Replace this with your tool's description.
Include:
- What the tool does
- When to use it
- Example usage`,
    schema: z.object({
      param1: z.string().describe("First parameter description"),
      param2: z.number().default(42).describe("Second parameter description"),
    }),
  }
);
