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
  discoverSkills,
  discoverSubAgents,
  renderSkillsSection,
  renderSubagentsSection,
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

  const skillsPaths = resolveSkillsPaths(appConfig);
  const skills = discoverSkills(appConfig, workspaceRoot);
  const subAgents = discoverSubAgents(appConfig, workspaceRoot);
  const progressiveSkills = appConfig.skills.progressiveLoading;

  // skills → load_skill 工具；subAgents → task 委派工具（沙箱按 workspaceRoot / 各自 workdir）。
  const allTools = createFlowTools(ctx, {
    workspaceRoot,
    policy: sandbox,
    skills: progressiveSkills ? skills : [],
    subAgents,
  });

  // 系统提示词追加「Available Skills」「Subagents」清单 → 模型知道可 load_skill / task 委派。
  const baseSystemPrompt = resolveSystemPrompt(appConfig, options.sessionConfig, workspaceRoot);
  const sections = [
    renderSkillsSection(skills, progressiveSkills),
    renderSubagentsSection(subAgents),
  ].filter(Boolean);
  const systemPrompt = sections.length ? `${baseSystemPrompt}\n\n${sections.join("\n\n")}` : baseSystemPrompt;

  // 文件后端 checkpointer：与 createStatefulFlow 共用 resolveSessionDir 口径（见 file-checkpoint-saver）。
  const checkpointer = createFileCheckpointer(appConfig, workspaceRoot);

  return {
    config: appConfig,
    ctx,
    allTools,
    systemPrompt,
    skillsPaths,
    skills,
    subAgents,
    sandbox,
    workspaceRoot,
    checkpointer,
  };
}
