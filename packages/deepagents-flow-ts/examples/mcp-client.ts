/**
 * examples/mcp-client.ts —— re-export shim（实现已提升到 src/libs/mcp/mcp-access.ts）。
 *
 * 保留此文件仅为过渡：examples 仍用 `import { ... } from "../mcp-client.js"`。
 * mcp-access 基于 @langchain/mcp-adapters 的 MultiServerMCPClient（多 transport，取代旧的自研
 * spawn→kill stdio 客户端）。P2 把 example 图逻辑提升进 libs/topologies 后，本 shim 与各
 * example 的 graph.ts 一并清理。
 */
export * from "../src/libs/mcp/mcp-access.js";
