import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getRuntimeStorage, type RuntimeStorage } from "./runtime-storage.js";

export type HarnessPhase = "idle" | "running" | "model_call" | "tool_call" | "failed";

export interface HarnessTurnSnapshot {
  id: string;
  index: number;
  startedAt: string;
  endedAt?: string;
  inputPreview?: string;
  modelCalls: number;
  toolCalls: number;
}

export interface PendingHarnessWrite {
  id: string;
  toolName: string;
  path?: string;
  startedAt: string;
}

export interface HarnessLifecycleSnapshot {
  schema: "deepagents.harness-lifecycle.v1";
  sessionId: string;
  phase: HarnessPhase;
  busy: boolean;
  updatedAt: string;
  currentTurn?: HarnessTurnSnapshot;
  counters: {
    turns: number;
    modelCalls: number;
    toolCalls: number;
    failedTurns: number;
  };
  pendingWrites: PendingHarnessWrite[];
  lastError?: string;
}

export function readHarnessLifecycle(
  storage = getRuntimeStorage()
): HarnessLifecycleSnapshot {
  return readLifecycleFile(storage) ?? createEmptyLifecycle(storage);
}

export function beginHarnessTurn(
  inputPreview?: string,
  storage = getRuntimeStorage()
): HarnessLifecycleSnapshot {
  const current = readHarnessLifecycle(storage);
  const now = new Date().toISOString();
  const turn: HarnessTurnSnapshot = {
    id: randomUUID(),
    index: current.counters.turns + 1,
    startedAt: now,
    inputPreview,
    modelCalls: 0,
    toolCalls: 0,
  };

  return writeLifecycle(storage, {
    ...current,
    phase: "running",
    busy: true,
    updatedAt: now,
    currentTurn: turn,
    counters: {
      ...current.counters,
      turns: current.counters.turns + 1,
    },
    pendingWrites: [],
    lastError: undefined,
  });
}

export function completeHarnessTurn(
  storage = getRuntimeStorage()
): HarnessLifecycleSnapshot {
  const current = readHarnessLifecycle(storage);
  const now = new Date().toISOString();
  return writeLifecycle(storage, {
    ...current,
    phase: "idle",
    busy: false,
    updatedAt: now,
    currentTurn: current.currentTurn
      ? { ...current.currentTurn, endedAt: now }
      : undefined,
    pendingWrites: [],
  });
}

export function failHarnessTurn(
  error: unknown,
  storage = getRuntimeStorage()
): HarnessLifecycleSnapshot {
  const current = readHarnessLifecycle(storage);
  const now = new Date().toISOString();
  return writeLifecycle(storage, {
    ...current,
    phase: "failed",
    busy: false,
    updatedAt: now,
    currentTurn: current.currentTurn
      ? { ...current.currentTurn, endedAt: now }
      : undefined,
    counters: {
      ...current.counters,
      failedTurns: current.counters.failedTurns + 1,
    },
    pendingWrites: [],
    lastError: error instanceof Error ? error.message : String(error),
  });
}

export function recordHarnessModelCall(
  storage = getRuntimeStorage()
): HarnessLifecycleSnapshot {
  const current = readHarnessLifecycle(storage);
  const now = new Date().toISOString();
  return writeLifecycle(storage, {
    ...current,
    phase: "model_call",
    busy: true,
    updatedAt: now,
    currentTurn: current.currentTurn
      ? {
          ...current.currentTurn,
          modelCalls: current.currentTurn.modelCalls + 1,
        }
      : undefined,
    counters: {
      ...current.counters,
      modelCalls: current.counters.modelCalls + 1,
    },
  });
}

export function beginHarnessToolCall(
  toolName: string,
  args: unknown,
  storage = getRuntimeStorage()
): { id: string; snapshot: HarnessLifecycleSnapshot } {
  const current = readHarnessLifecycle(storage);
  const now = new Date().toISOString();
  const pendingPath = maybePendingWrite(toolName, args);
  const id = randomUUID();
  const pendingWrites = pendingPath
    ? [...current.pendingWrites, { id, toolName, path: pendingPath, startedAt: now }]
    : current.pendingWrites;

  const snapshot = writeLifecycle(storage, {
    ...current,
    phase: "tool_call",
    busy: true,
    updatedAt: now,
    currentTurn: current.currentTurn
      ? {
          ...current.currentTurn,
          toolCalls: current.currentTurn.toolCalls + 1,
        }
      : undefined,
    counters: {
      ...current.counters,
      toolCalls: current.counters.toolCalls + 1,
    },
    pendingWrites,
  });

  return { id, snapshot };
}

export function completeHarnessToolCall(
  id: string,
  storage = getRuntimeStorage()
): HarnessLifecycleSnapshot {
  const current = readHarnessLifecycle(storage);
  const now = new Date().toISOString();
  return writeLifecycle(storage, {
    ...current,
    phase: current.busy ? "running" : "idle",
    updatedAt: now,
    pendingWrites: current.pendingWrites.filter((pending) => pending.id !== id),
  });
}

function createEmptyLifecycle(storage: RuntimeStorage): HarnessLifecycleSnapshot {
  return {
    schema: "deepagents.harness-lifecycle.v1",
    sessionId: storage.sessionId,
    phase: "idle",
    busy: false,
    updatedAt: new Date().toISOString(),
    counters: {
      turns: 0,
      modelCalls: 0,
      toolCalls: 0,
      failedTurns: 0,
    },
    pendingWrites: [],
  };
}

function maybePendingWrite(toolName: string, args: unknown): string | undefined {
  if (!["write_file", "edit_file"].includes(toolName)) {
    return undefined;
  }
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const candidate = args as Record<string, unknown>;
  return typeof candidate.file_path === "string"
    ? candidate.file_path
    : typeof candidate.path === "string"
      ? candidate.path
      : undefined;
}

function readLifecycleFile(storage: RuntimeStorage): HarnessLifecycleSnapshot | null {
  if (!existsSync(storage.lifecyclePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(storage.lifecyclePath, "utf-8")) as HarnessLifecycleSnapshot;
    return parsed.schema === "deepagents.harness-lifecycle.v1" ? parsed : null;
  } catch {
    return null;
  }
}

// Cache the directory-exists check so we don't run mkdirSync on every write.
// The lifecycle file lives at <sessionDir>/harness-lifecycle.json; once its
// parent exists (after the first call), mkdirSync is a no-op syscall but
// still costs a stat+mkdir. Caching the path avoids that overhead on the
// 50+ writes per turn.
const ensuredDirs = new WeakSet<RuntimeStorage>();

function writeLifecycle(
  storage: RuntimeStorage,
  snapshot: HarnessLifecycleSnapshot
): HarnessLifecycleSnapshot {
  if (!ensuredDirs.has(storage)) {
    mkdirSync(dirname(storage.lifecyclePath), { recursive: true });
    ensuredDirs.add(storage);
  }
  writeFileSync(storage.lifecyclePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  return snapshot;
}

