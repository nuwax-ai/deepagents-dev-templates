/**
 * examples/shared.ts —— re-export shim（P1：实现已提升到 src/libs/nodes/model-resolver.ts）。
 *
 * 保留此文件仅为过渡：examples 仍用相对路径 `import { requireModel } from "../shared.js"`。
 * P2 把 example 图逻辑提升进 libs/topologies 后，本 shim 与各 example 的 graph.ts 一并清理。
 */
export { requireModel } from "../src/libs/nodes/index.js";
