import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDeepAgentsHome, workspaceSlug } from "./runtime-storage.js";

export type ApprovalDecision = "allow" | "reject";

export interface ApprovalRecord {
  id: string;
  workspaceSlug: string;
  workspaceRoot: string;
  toolName: string;
  decision: ApprovalDecision;
  pathPattern?: string;
  commandHash?: string;
  createdAt: string;
  updatedAt: string;
}

export function approvalsPath(): string {
  return join(getDeepAgentsHome(), "approvals.json");
}

export function listApprovals(workspaceRoot?: string): ApprovalRecord[] {
  const records = readApprovals();
  if (!workspaceRoot) {
    return records;
  }
  const slug = workspaceSlug(workspaceRoot);
  return records.filter((record) => record.workspaceSlug === slug);
}

export function saveApproval(input: {
  workspaceRoot: string;
  toolName: string;
  decision: ApprovalDecision;
  pathPattern?: string;
  command?: string;
}): ApprovalRecord {
  const records = readApprovals();
  const now = new Date().toISOString();
  const commandHash = input.command ? hashCommand(input.command) : undefined;
  const id = approvalId({
    workspaceRoot: input.workspaceRoot,
    toolName: input.toolName,
    pathPattern: input.pathPattern,
    commandHash,
  });
  const existing = records.find((record) => record.id === id);
  const next: ApprovalRecord = {
    id,
    workspaceSlug: workspaceSlug(input.workspaceRoot),
    workspaceRoot: input.workspaceRoot,
    toolName: input.toolName,
    decision: input.decision,
    pathPattern: input.pathPattern,
    commandHash,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  writeApprovals([...records.filter((record) => record.id !== id), next]);
  return next;
}

export function approvalId(input: {
  workspaceRoot: string;
  toolName: string;
  pathPattern?: string;
  commandHash?: string;
}): string {
  return createHash("sha1")
    .update(JSON.stringify({
      workspaceSlug: workspaceSlug(input.workspaceRoot),
      toolName: input.toolName,
      pathPattern: input.pathPattern ?? "",
      commandHash: input.commandHash ?? "",
    }))
    .digest("hex")
    .slice(0, 16);
}

function hashCommand(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

function readApprovals(): ApprovalRecord[] {
  const path = approvalsPath();
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { approvals?: ApprovalRecord[] } | ApprovalRecord[];
    return Array.isArray(parsed) ? parsed : parsed.approvals ?? [];
  } catch {
    return [];
  }
}

function writeApprovals(approvals: ApprovalRecord[]): void {
  const path = approvalsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ approvals }, null, 2)}\n`, "utf-8");
}
