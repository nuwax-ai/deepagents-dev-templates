#!/usr/bin/env node
/**
 * Flow 场景脚手架生成器。
 *
 * 用法: node scripts/scaffold/generate.mjs <spec.json>
 *   读 spec → zod 校验 → 选 blueprint 渲染 → 写 src/app/flows/<name>/
 *   → 注册到 src/app/flows/index.ts → 跑 typecheck + graph 验证（COMPLETION_GATE）。
 *
 * 生成的是真实可读、可手改、可被 inspector 可视化的 TS（贴合「图是契约」范式，不引运行时解释层）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parseSpec, SUPPORTED_TOPOLOGIES } from "./schema.mjs";
import * as reactTools from "./blueprints/react-tools.mjs";
import * as humanInLoop from "./blueprints/human-in-loop.mjs";
import * as projectManager from "./blueprints/project-manager.mjs";
import * as travelPlanner from "./blueprints/travel-planner.mjs";
import * as rag from "./blueprints/rag.mjs";
import * as deepResearch from "./blueprints/deep-research.mjs";
import * as devAgent from "./blueprints/dev-agent.mjs";

/** topology → blueprint 渲染器。新增拓扑在此注册。 */
const BLUEPRINTS = {
  "react-tools": reactTools,
  "human-in-loop": humanInLoop,
  "project-manager": projectManager,
  "travel-planner": travelPlanner,
  rag,
  "deep-research": deepResearch,
  "dev-agent": devAgent,
};

const SCAFFOLD_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(SCAFFOLD_DIR, "../..");

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** 把生成的 flow 注册进 src/app/flows/index.ts（import + 表项，幂等）。 */
function registerFlow(name, kind) {
  const regPath = resolve(PKG_ROOT, "src/app/flows/index.ts");
  let src = readFileSync(regPath, "utf-8");
  const alias = `${camel(name)}Flow`;
  const importLine = `import * as ${alias} from "./${name}/index.js";`;
  if (src.includes(importLine)) {
    console.log(`(flow "${name}" 已在注册表，跳过注册)`);
    return;
  }
  const importAnchor = `import { getFlowTopology, type FlowTopology } from "../topology.js";`;
  const regAnchor = "// --- SCAFFOLD-REGISTRY-START (generator 自动维护，勿手改此区) ---";
  if (!src.includes(importAnchor)) {
    throw new Error(
      `flows/index.ts 缺少 import 锚点（找不到 \`${importAnchor}\`）；若重构了该 import 行，请同步更新 generate.mjs 的 importAnchor。`
    );
  }
  if (!src.includes(regAnchor)) {
    throw new Error(
      `flows/index.ts 缺少 REGISTRY-START 标记（\`${regAnchor}\`）；勿手动删除该标记区。`
    );
  }
  // kind 决定注册表项形态：stateful-recipe 用 recipe；oneshot / stateful-custom 用 createExecutor。
  const entry =
    kind === "stateful-recipe"
      ? `  "${name}": { name: "${name}", kind: "stateful-recipe", recipe: ${alias}.recipe, getTopology: ${alias}.getTopology },`
      : `  "${name}": { name: "${name}", kind: "${kind}", createExecutor: ${alias}.createExecutor, getTopology: ${alias}.getTopology },`;
  src = src
    .replace(importAnchor, `${importAnchor}\n${importLine}`)
    .replace(regAnchor, `${regAnchor}\n${entry}`);
  writeFileSync(regPath, src, "utf-8");
}

function main() {
  const specArg = process.argv[2];
  if (!specArg) {
    console.error("用法: node scripts/scaffold/generate.mjs <spec.json>");
    console.error(`已实现拓扑: ${SUPPORTED_TOPOLOGIES.join(", ")}`);
    process.exit(1);
  }

  const specPath = resolve(process.cwd(), specArg);
  const raw = JSON.parse(readFileSync(specPath, "utf-8"));
  const spec = parseSpec(raw);

  const bp = BLUEPRINTS[spec.topology];
  if (!bp) {
    console.error(`拓扑 "${spec.topology}" 尚无 blueprint（已实现: ${Object.keys(BLUEPRINTS).join(", ")}）`);
    process.exit(1);
  }

  const files = bp.render(spec);
  for (const f of files) {
    const abs = resolve(PKG_ROOT, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, "utf-8");
    console.log(`✓ 写入 ${f.path}`);
  }

  registerFlow(spec.name, bp.kind);
  console.log(`✓ 注册 flow "${spec.name}" 到 src/app/flows/index.ts`);

  // —— COMPLETION_GATE：未跑通不算完成 ——
  console.log("→ pnpm typecheck ...");
  execSync("pnpm typecheck", { cwd: PKG_ROOT, stdio: "inherit" });
  console.log("→ pnpm graph（确认注册表未破坏全局拓扑）...");
  execSync("pnpm graph", { cwd: PKG_ROOT, stdio: "inherit" });

  console.log(`\n✅ flow "${spec.name}" 已生成并通过 typecheck + graph。`);
  console.log(`   启用：把 config/flow-agent.config.json 的 "activeFlow" 设为 "${spec.name}"，`);
  console.log(`   再 \`pnpm graph\` 查看该 flow 的拓扑、\`pnpm flow "..."\` 试跑。`);
}

main();
