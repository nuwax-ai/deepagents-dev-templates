#!/usr/bin/env tsx
/**
 * Scaffold a new stateless custom tool.
 *
 *   npm run new:tool -- <name>      # e.g. weather-lookup
 *
 * Creates src/app/tools/<name>.tool.ts from the stateless `tool()` template
 * (modeled on json-utils.tool.ts) and wires it into src/app/tools/index.ts:
 * adds the import and registers it in the stateless section of createTools().
 *
 * Platform-bound tools (those needing live runtime context) follow the
 * createXxxTool(ctx) factory pattern instead -- see runtime-info.tool.ts -- and
 * are out of scope for this scaffold; convert by hand if you need ctx.
 */
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { PKG_ROOT, parseName, writeNew, fail, toCamel, toSnake, toTitle } from "./_shared.js";

const name = parseName("tool", "weather-lookup");
const exportName = `${toCamel(name)}Tool`; // weatherLookupTool
const toolName = toSnake(name); // weather_lookup
const title = toTitle(name); // Weather Lookup
const fileRel = `src/app/tools/${name}.tool.ts`;
const fileAbs = resolve(PKG_ROOT, fileRel);

const template = `/**
 * ${title} Tool
 *
 * TODO: describe what this tool does and when the agent should reach for it.
 * Built with @langchain/core/tools (stateless pattern; see json-utils.tool.ts).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const ${exportName} = tool(
  async ({ input }) => {
    // TODO: implement. Return a string (often JSON.stringify(...)) for the model.
    return JSON.stringify({ ok: true, echo: input });
  },
  {
    name: "${toolName}",
    description:
      "TODO: one or two sentences telling the model exactly when to use ${toolName}.",
    schema: z.object({
      input: z.string().describe("TODO: describe this parameter"),
    }),
  }
);
`;

writeNew(fileAbs, template);

// ── Wire into the tool registry ───────────────────────────
const indexAbs = resolve(PKG_ROOT, "src/app/tools/index.ts");
let index = readFileSync(indexAbs, "utf8");

const importLine = `import { ${exportName} } from "./${name}.tool.js";\n`;
const registerLine = `    ${exportName},\n`;

if (index.includes(importLine)) {
  console.log(`• ${exportName} already imported in index.ts; left registry untouched.`);
} else {
  // Insert import just before the first `import type {` (end of value-import block).
  const typeAnchor = index.indexOf("import type {");
  if (typeAnchor === -1) {
    fail(`Could not find an "import type {" anchor in ${indexAbs}; wire it up by hand.`);
  }
  index = index.slice(0, typeAnchor) + importLine + index.slice(typeAnchor);

  // Register in the stateless section, just before the platform-bound block.
  const arrAnchor = index.indexOf("    // Platform-bound tools");
  if (arrAnchor === -1) {
    fail(
      `Could not find the "// Platform-bound tools" anchor in ${indexAbs}; add ${exportName} to createTools() by hand.`
    );
  }
  index = index.slice(0, arrAnchor) + registerLine + index.slice(arrAnchor);

  writeFileSync(indexAbs, index, "utf8");
}

console.log(`✓ Created ${fileRel}`);
console.log(`✓ Registered ${exportName} ("${toolName}") in src/app/tools/index.ts`);
console.log(`\nNext: implement the tool body, then \`npm run typecheck\`.`);
