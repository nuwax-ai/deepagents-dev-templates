import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface RuntimeStorageContext {
  workspaceRoot?: string;
  sessionId?: string;
}

export interface RuntimeStorage {
  homeDir: string;
  workspaceRoot: string;
  workspaceSlug: string;
  workspaceDir: string;
  sessionsDir: string;
  sessionId: string;
  sessionDir: string;
  messagesPath: string;
  planPath: string;
  todosPath: string;
  scheduledActionsPath: string;
  checkpointsDir: string;
  artifactsDir: string;
  memoryDir: string;
  metadataPath: string;
  lifecyclePath: string;
}

export interface SessionSummary {
  sessionId: string;
  path: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  mode?: string;
  status?: string;
  messageCount?: number;
}

export interface RuntimeMessage {
  role: string;
  content: unknown;
  timestamp?: string;
}

export interface LoadedSessionState {
  exists: boolean;
  summary: SessionSummary;
  metadata: Record<string, unknown> | null;
  messages: RuntimeMessage[];
  plan: string | null;
  todos: string | null;
  lifecycle: Record<string, unknown> | null;
}

const contextStore = new AsyncLocalStorage<RuntimeStorageContext>();

export function withRuntimeStorageContext<T>(
  context: RuntimeStorageContext,
  fn: () => T
): T {
  const parent = contextStore.getStore() ?? {};
  return contextStore.run({ ...parent, ...context }, fn);
}

export function getDeepAgentsHome(): string {
  return resolve(process.env.DEEPAGENTS_HOME || join(homedir(), ".deepagents"));
}

export function createSessionId(prefix = "sess"): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

export function workspaceSlug(workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot);
  const name = sanitizePathPart(basename(resolved) || "workspace");
  const hash = createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

export function getRuntimeStorage(options: RuntimeStorageContext = {}): RuntimeStorage {
  const stored = contextStore.getStore() ?? {};
  const workspaceRoot = resolve(options.workspaceRoot || stored.workspaceRoot || process.cwd());
  const sessionId =
    options.sessionId ||
    stored.sessionId ||
    process.env.DEEPAGENTS_SESSION_ID ||
    process.env.ACP_SESSION_ID ||
    "default";
  const homeDir = getDeepAgentsHome();
  const slug = workspaceSlug(workspaceRoot);
  const workspaceDir = join(homeDir, "workspaces", slug);
  const sessionsDir = join(workspaceDir, "sessions");
  const sessionDir = join(sessionsDir, sanitizePathPart(sessionId));

  return {
    homeDir,
    workspaceRoot,
    workspaceSlug: slug,
    workspaceDir,
    sessionsDir,
    sessionId,
    sessionDir,
    messagesPath: join(sessionDir, "messages.jsonl"),
    planPath: join(sessionDir, "plan.md"),
    todosPath: join(sessionDir, "todos.json"),
    scheduledActionsPath: join(sessionDir, "scheduled-actions.json"),
    checkpointsDir: join(sessionDir, "checkpoints"),
    artifactsDir: join(sessionDir, "artifacts"),
    memoryDir: join(workspaceDir, "memory"),
    metadataPath: join(sessionDir, "metadata.json"),
    lifecyclePath: join(sessionDir, "harness-lifecycle.json"),
  };
}

export function ensureWorkspaceState(storage = getRuntimeStorage()): void {
  mkdirSync(storage.workspaceDir, { recursive: true });
  const metadataPath = join(storage.workspaceDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    writeJson(metadataPath, {
      workspaceRoot: storage.workspaceRoot,
      workspaceSlug: storage.workspaceSlug,
      createdAt: new Date().toISOString(),
    });
  }
}

export function ensureSessionState(
  storage = getRuntimeStorage(),
  metadata: Record<string, unknown> = {}
): void {
  ensureWorkspaceState(storage);
  mkdirSync(storage.checkpointsDir, { recursive: true });
  mkdirSync(storage.artifactsDir, { recursive: true });

  const now = new Date().toISOString();
  const existing = readJson(storage.metadataPath);
  writeJson(storage.metadataPath, {
    sessionId: storage.sessionId,
    workspaceRoot: storage.workspaceRoot,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: existing?.status ?? "active",
    ...existing,
    ...metadata,
  });

  if (!existsSync(storage.messagesPath)) {
    writeFileSync(storage.messagesPath, "", "utf-8");
  }
  if (!existsSync(storage.planPath)) {
    writeFileSync(storage.planPath, "# Plan\n\nNo plan saved yet.\n", "utf-8");
  }
  if (!existsSync(storage.todosPath)) {
    writeFileSync(storage.todosPath, "[]\n", "utf-8");
  }
}

export function appendRuntimeMessage(
  message: RuntimeMessage,
  storage = getRuntimeStorage()
): void {
  ensureSessionState(storage);
  const entry = {
    ...message,
    timestamp: message.timestamp ?? new Date().toISOString(),
  };
  writeFileSync(storage.messagesPath, `${JSON.stringify(entry)}\n`, {
    encoding: "utf-8",
    flag: "a",
  });
  updateSessionMetadata(storage, { updatedAt: entry.timestamp });
}

export function listSessions(workspaceRoot = process.cwd()): SessionSummary[] {
  const storage = getRuntimeStorage({ workspaceRoot });
  if (!existsSync(storage.sessionsDir)) {
    return [];
  }

  const sessions: SessionSummary[] = [];
  for (const sessionId of readdirSync(storage.sessionsDir)) {
    const sessionDir = join(storage.sessionsDir, sessionId);
    if (!statSync(sessionDir).isDirectory()) {
      continue;
    }
    const metadata = readJson(join(sessionDir, "metadata.json")) ?? {};
    sessions.push({
      sessionId,
      path: sessionDir,
      createdAt: stringValue(metadata.createdAt),
      updatedAt: stringValue(metadata.updatedAt),
      closedAt: stringValue(metadata.closedAt),
      mode: stringValue(metadata.mode),
      status: stringValue(metadata.status),
      messageCount: countJsonlLines(join(sessionDir, "messages.jsonl")),
    });
  }
  return sessions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function readSessionMetadata(
  workspaceRoot: string,
  sessionId: string
): Record<string, unknown> | null {
  const storage = getRuntimeStorage({ workspaceRoot, sessionId });
  return readJson(storage.metadataPath);
}

export function readRuntimeMessages(
  workspaceRoot: string,
  sessionId: string
): RuntimeMessage[] {
  const storage = getRuntimeStorage({ workspaceRoot, sessionId });
  const content = readTextIfExists(storage.messagesPath);
  if (!content) {
    return [];
  }

  const messages: RuntimeMessage[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as RuntimeMessage;
      messages.push(parsed);
    } catch {
      messages.push({
        role: "system",
        content: line,
      });
    }
  }
  return messages;
}

export function loadSessionState(
  workspaceRoot: string,
  sessionId: string,
  options: { maxMessages?: number } = {}
): LoadedSessionState {
  const storage = getRuntimeStorage({ workspaceRoot, sessionId });
  const metadata = readJson(storage.metadataPath);
  const messages = readRuntimeMessages(workspaceRoot, sessionId);
  const maxMessages = options.maxMessages ?? 50;
  const recentMessages = maxMessages > 0 ? messages.slice(-maxMessages) : messages;

  return {
    exists: existsSync(storage.sessionDir),
    summary: {
      sessionId: storage.sessionId,
      path: storage.sessionDir,
      createdAt: stringValue(metadata?.createdAt),
      updatedAt: stringValue(metadata?.updatedAt),
      closedAt: stringValue(metadata?.closedAt),
      mode: stringValue(metadata?.mode),
      status: stringValue(metadata?.status),
      messageCount: messages.length,
    },
    metadata,
    messages: recentMessages,
    plan: readTextIfExists(storage.planPath),
    todos: readTextIfExists(storage.todosPath),
    lifecycle: readJson(storage.lifecyclePath),
  };
}

export function closeSessionState(
  workspaceRoot: string,
  sessionId: string,
  metadata: Record<string, unknown> = {}
): SessionSummary {
  const storage = getRuntimeStorage({ workspaceRoot, sessionId });
  ensureSessionState(storage);
  const closedAt = new Date().toISOString();
  updateSessionMetadata(storage, {
    status: "closed",
    closedAt,
    updatedAt: closedAt,
    ...metadata,
  });

  return {
    sessionId: storage.sessionId,
    path: storage.sessionDir,
    createdAt: stringValue(readSessionMetadata(workspaceRoot, sessionId)?.createdAt),
    updatedAt: closedAt,
    closedAt,
    mode: stringValue(readSessionMetadata(workspaceRoot, sessionId)?.mode),
    status: "closed",
    messageCount: countJsonlLines(storage.messagesPath),
  };
}

export function memoryPath(agentName: string, workspaceRoot = process.cwd()): string {
  const storage = getRuntimeStorage({ workspaceRoot });
  return join(storage.memoryDir, sanitizePathPart(agentName), "MEMORY.md");
}

export function legacyMemoryPath(agentName: string, workspaceRoot = process.cwd()): string {
  return resolve(workspaceRoot, ".agent-memory", sanitizePathPart(agentName), "MEMORY.md");
}

export function readableMemoryPath(agentName: string, workspaceRoot = process.cwd()): string {
  const nextPath = memoryPath(agentName, workspaceRoot);
  if (existsSync(nextPath)) {
    return nextPath;
  }
  const legacyPath = legacyMemoryPath(agentName, workspaceRoot);
  return existsSync(legacyPath) ? legacyPath : nextPath;
}

export function legacyCheckpointsDir(workspaceRoot = process.cwd()): string {
  return resolve(workspaceRoot, ".agent-checkpoints");
}

export function migrateLegacyState(
  workspaceRoot = process.cwd(),
  sessionId?: string
): { memoryFiles: number; checkpoints: number; target: string } {
  const storage = getRuntimeStorage({ workspaceRoot, sessionId });
  ensureSessionState(storage);
  let memoryFiles = 0;
  let checkpoints = 0;

  const oldMemoryDir = resolve(workspaceRoot, ".agent-memory");
  if (existsSync(oldMemoryDir)) {
    for (const agentName of readdirSync(oldMemoryDir)) {
      const source = join(oldMemoryDir, agentName, "MEMORY.md");
      if (!existsSync(source)) {
        continue;
      }
      const target = memoryPath(agentName, workspaceRoot);
      if (!existsSync(target)) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        memoryFiles++;
      }
    }
  }

  const oldCheckpointDir = legacyCheckpointsDir(workspaceRoot);
  if (existsSync(oldCheckpointDir)) {
    mkdirSync(storage.checkpointsDir, { recursive: true });
    for (const file of readdirSync(oldCheckpointDir)) {
      if (!file.startsWith("cp-") || !file.endsWith(".md")) {
        continue;
      }
      const source = join(oldCheckpointDir, file);
      const target = join(storage.checkpointsDir, sanitizeFileName(file));
      if (!existsSync(target)) {
        copyFileSync(source, target);
        checkpoints++;
      }
    }
  }

  return { memoryFiles, checkpoints, target: storage.workspaceDir };
}

export function readTextIfExists(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf-8");
}

function updateSessionMetadata(storage: RuntimeStorage, patch: Record<string, unknown>): void {
  const current = readJson(storage.metadataPath) ?? {};
  writeJson(storage.metadataPath, { ...current, ...patch });
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function countJsonlLines(path: string): number {
  const content = readTextIfExists(path);
  if (!content) {
    return 0;
  }
  return content.split("\n").filter((line) => line.trim()).length;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "default";
}

function sanitizeFileName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
