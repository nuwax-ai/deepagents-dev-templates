import { createHash } from "node:crypto";

type Obj = Record<string, unknown>;

export function getByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Obj)[key];
  }
  return current;
}

export function setByPath<T extends Obj>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const root: Obj = { ...obj };
  let cursor = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]!;
    const existing = cursor[key];
    cursor[key] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Obj) }
        : {};
    cursor = cursor[key] as Obj;
  }
  cursor[keys[keys.length - 1]!] = value;
  return root as T;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
