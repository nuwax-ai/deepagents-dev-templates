#!/usr/bin/env tsx
/**
 * Scaffold a new built-in skill.
 *
 *   npm run new:skill -- <name>     # e.g. api-pagination
 *
 * Creates skills/builtin/<name>/SKILL.md with the standard frontmatter + section
 * skeleton. Skills are discovered from skills/builtin/ at load time; run
 * `npm run graph` afterwards to refresh code-graph.json.
 */
import { resolve } from "node:path";
import { PKG_ROOT, parseName, writeNew, toTitle } from "./_shared.js";

const name = parseName("skill", "api-pagination");
const title = toTitle(name);
const fileRel = `skills/builtin/${name}/SKILL.md`;
const fileAbs = resolve(PKG_ROOT, fileRel);

const template = `---
name: ${name}
description: "TODO: one line on what this skill does and when to use it (this is the model's primary signal for loading it)"
tags: []
version: "1.0.0"
---

# ${title}

## When to Use
TODO: the concrete trigger conditions -- when should the agent load this skill?

## Steps
1. TODO
2. TODO

## Notes
TODO: gotchas, constraints, examples.
`;

writeNew(fileAbs, template);

console.log(`✓ Created ${fileRel}`);
console.log(`\nNext:`);
console.log(`  1. Fill in the description -- it's the model's primary signal for loading the skill.`);
console.log(`  2. Run \`npm run graph\` to refresh code-graph.json.`);
