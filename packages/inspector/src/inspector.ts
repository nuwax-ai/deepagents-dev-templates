import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { introspectRuntimeGraph } from "./graph-introspect.js";
import { loadTemplateRuntime, type ACPSessionConfig, type AppConfig, type RuntimeContext } from "./template-runtime.js";
import type { AgentOrchestrationSpec, EditableSpec, GraphSpec, InspectMode } from "./types.js";
import { EDITABLE_CONFIG_FIELDS } from "./editing/editable-model.js";
import { readConfigSource } from "./editing/config-source.js";
import { computeProvenance } from "./editing/provenance.js";
import {
  projectMemory,
  projectMeta,
  projectMiddleware,
  projectPermissions,
  projectSkills,
  projectSubagents,
  projectSystemPrompt,
  projectTools,
} from "./projection.js";

export interface InspectAgentOptions {
  configPath?: string;
  workspaceRoot?: string;
  sessionConfig?: ACPSessionConfig;
  mode?: InspectMode;
  xray?: boolean | number;
}

export async function inspectAgent(options: InspectAgentOptions = {}): Promise<AgentOrchestrationSpec> {
  const runtime = await loadTemplateRuntime();
  const sessionConfig = options.sessionConfig;
  const initialWorkspace = options.workspaceRoot ?? sessionConfig?.cwd ?? process.cwd();
  const config = runtime.loadConfig({
    configPath: options.configPath,
    workspaceRoot: initialWorkspace,
    sessionConfig,
  });
  const workspaceRoot = runtime.resolveConfiguredWorkspaceRoot(config, initialWorkspace);
  const mode = options.mode ?? "dry-run";

  let context: RuntimeContext;
  let graph: GraphSpec | null = null;
  const warnings: string[] = [];

  if (mode === "full") {
    try {
      const created = await withWorkingDirectory(workspaceRoot, () =>
        runtime.createAppAgentAsync(config, { ...sessionConfig, cwd: workspaceRoot })
      );
      context = created.context;
      const graphResult = await introspectRuntimeGraph(created.agent, { xray: options.xray ?? 1 });
      graph = graphResult.graph;
      warnings.push(...graphResult.warnings);
    } catch (error) {
      throw new Error(`Full inspection failed: ${credentialHint(error)}`);
    }
  } else {
    context = await withWorkingDirectory(workspaceRoot, () =>
      runtime.createRuntimeContext(config, { ...sessionConfig, cwd: workspaceRoot })
    );
  }

  return assembleSpec({
    config,
    configPath: options.configPath ?? "config/app-agent.config.json",
    context,
    graph,
    mode,
    runtime,
    sessionConfig,
    warnings,
    workspaceRoot,
  });
}

export async function writeOrchestrationSpec(
  spec: AgentOrchestrationSpec,
  outputPath: string,
  format: "json" | "mermaid" = "json"
): Promise<void> {
  const resolved = resolve(process.cwd(), outputPath);
  await mkdir(dirname(resolved), { recursive: true });
  if (format === "mermaid") {
    if (!spec.graph) {
      throw new Error("Cannot write Mermaid output in dry-run mode because no runtime graph is available. Re-run with --full.");
    }
    await writeFile(resolved, spec.graph.mermaid, "utf-8");
    return;
  }
  await writeFile(resolved, `${JSON.stringify(spec, null, 2)}\n`, "utf-8");
}

export function defaultStaticDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../web/graph-ui");
}

interface AssembleSpecInput {
  config: AppConfig;
  configPath: string;
  context: RuntimeContext;
  graph: GraphSpec | null;
  mode: InspectMode;
  runtime: Awaited<ReturnType<typeof loadTemplateRuntime>>;
  sessionConfig?: ACPSessionConfig;
  warnings: string[];
  workspaceRoot: string;
}

function assembleSpec(input: AssembleSpecInput): AgentOrchestrationSpec {
  const projectionInput = {
    config: input.config,
    runtimeContext: input.context,
    runtime: input.runtime,
    sessionConfig: input.sessionConfig,
    warnings: input.warnings,
    workspaceRoot: input.workspaceRoot,
  };
  const memory = projectMemory(projectionInput);

  return {
    schema: "nuwaclaw.agent-orchestration.v1",
    generatedAt: new Date().toISOString(),
    framework: "deepagents",
    packageVersion: "0.1.0",
    mode: input.mode,
    meta: projectMeta(projectionInput),
    systemPrompt: projectSystemPrompt(projectionInput),
    tools: projectTools(projectionInput),
    subagents: projectSubagents(projectionInput),
    skills: projectSkills(projectionInput),
    memory,
    middleware: projectMiddleware(projectionInput, memory),
    permissions: projectPermissions(projectionInput),
    graph: input.graph,
    warnings: input.warnings,
    editable: projectEditable(input.workspaceRoot, input.configPath, input.config),
  };
}

function projectEditable(workspaceRoot: string, configPath: string, merged: AppConfig): EditableSpec {
  const source = readConfigSource(workspaceRoot, configPath);
  const provenance = computeProvenance(
    source.raw,
    merged as unknown as Record<string, unknown>,
    EDITABLE_CONFIG_FIELDS
  );
  const byPath = new Map(provenance.map((p) => [p.configPath, p]));
  return {
    configFile: configPath,
    configBaseHash: source.hash,
    fields: EDITABLE_CONFIG_FIELDS.map((field) => {
      const p = byPath.get(field.configPath)!;
      return {
        ...field,
        sourceValue: p.sourceValue,
        effectiveValue: p.effectiveValue,
        overridden: p.overridden,
      };
    }),
  };
}

function credentialHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/api key|auth|credential|ANTHROPIC|OPENAI/i.test(message)) {
    return `${message}. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or OPENAI_API_KEY, or run without --full for dry-run inspection.`;
  }
  return message;
}

async function withWorkingDirectory<T>(cwd: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}
