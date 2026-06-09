#!/usr/bin/env tsx
/**
 * Scaffold a new system prompt.
 *
 *   npm run new:prompt -- <name>    # e.g. data-analyst
 *
 * Creates prompts/<name>.system.md. This does NOT touch panel.config.json:
 * the ACP panel references a single `prompt.templatePath`, so wiring a prompt
 * in means *replacing* that path by hand if you intend it as the agent's
 * primary prompt.
 */
import { resolve } from "node:path";
import { PKG_ROOT, parseName, writeNew, toTitle } from "./_shared.js";

const name = parseName("prompt", "data-analyst");
const title = toTitle(name);
const fileRel = `prompts/${name}.system.md`;
const fileAbs = resolve(PKG_ROOT, fileRel);

const template = `# ${title} — System Prompt

TODO: describe the agent's role and expertise in one or two sentences.

## Responsibilities
- TODO

## Workflow
1. TODO

## Constraints
- TODO
`;

writeNew(fileAbs, template);

console.log(`✓ Created ${fileRel}`);
console.log(`\nNote: to make this the ACP agent's primary prompt, set`);
console.log(`  prompt.templatePath = "${fileRel}"  in .nuwax-agent/panel.config.json`);
