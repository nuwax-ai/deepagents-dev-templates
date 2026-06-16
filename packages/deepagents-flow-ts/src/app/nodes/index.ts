/**
 * 默认图节点 barrel —— graph.ts 从这里聚合 4 个节点，自身只剩「建节点 + 连边」。
 *
 *   prepare（纯） → think（自管 model + bindTools）─┬─ tools（ToolNode + onToolCall）→ think
 *                                                  └─ respond（流式收尾）→ END
 *
 * prepare 是纯节点（直接导出函数）；think / tools / respond 需运行时依赖，走工厂
 * （create*Node(deps) → 节点函数）。新增节点照此放一个文件 + 在此 re-export，再到 graph.ts 连线。
 */

export { prepareNode } from "./prepare.js";
export { createThinkNode, type ThinkNodeDeps } from "./think.js";
export { createToolsNode, type ToolsNodeDeps } from "./tools.js";
export { createRespondNode, type RespondNodeDeps } from "./respond.js";
