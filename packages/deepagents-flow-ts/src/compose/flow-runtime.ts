/**
 * compose —— 组合根（L4，与 surfaces 平级）。
 *
 * `createFlowRuntime` 是唯一需要**跨层向下装配**的地方：它把 runtime 层的基础设施
 * （sandbox / checkpointer / ctx）与 app 层的工具（createFlowTools）组装成一个
 * `FlowRuntime` 对象，注入图节点。
 *
 * 之所以独立成 compose 层而非留在 runtime/：装配要 import `app/tools`（L3），若留在
 * runtime（L2）就是 runtime→app 的依赖倒挂。把**工厂**上移到 app 之上的 compose，
 * runtime 层回归纯基础设施（零上行依赖）。`FlowRuntime` **接口**仍定义在
 * `runtime/flow-runtime.ts`（它只引用 runtime 层类型，app→runtime 为合法下行）。
 *
 * 历史路径 `runtime/flow-runtime.ts` re-export 本文件的 createFlowRuntime（examples 兼容）。
 */

import {
  createRuntimeContextAsync,
  resolveSystemPrompt,
  resolveSkillsPaths,
  discoverSubAgents,
  type AppConfig,
  type ACPSessionConfig,
} from "../runtime/index.js";
import { createFlowTools } from "../app/tools/index.js";
import { getFlowSandboxPolicy } from "../runtime/fs/sandbox.js";
import { createFileCheckpointer } from "../runtime/services/file-checkpoint-saver.js";
import type { FlowRuntime } from "../runtime/flow-runtime.js";

export async function createFlowRuntime(
  appConfig: AppConfig,
  options: { sessionConfig?: ACPSessionConfig; workspaceRoot?: string } = {}
): Promise<FlowRuntime> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const ctx = await createRuntimeContextAsync(appConfig, options.sessionConfig, workspaceRoot);
  const sandbox = getFlowSandboxPolicy(appConfig);
  const allTools = createFlowTools(ctx, { workspaceRoot, policy: sandbox });
  const systemPrompt = resolveSystemPrompt(appConfig, options.sessionConfig, workspaceRoot);
  const skillsPaths = resolveSkillsPaths(appConfig);
  const subAgents = discoverSubAgents(appConfig, workspaceRoot);

  // 文件后端 checkpointer：与 createStatefulFlow 共用 resolveSessionDir 口径（见 file-checkpoint-saver）。
  const checkpointer = createFileCheckpointer(appConfig, workspaceRoot);

  return {
    config: appConfig,
    ctx,
    allTools,
    systemPrompt,
    skillsPaths,
    subAgents,
    sandbox,
    workspaceRoot,
    checkpointer,
  };
}
