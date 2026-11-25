/**
 * FileCheckpointSaver —— checkpoint 目录不可用时不拖垮会话（降级为仅内存）。
 *
 * 回归点：`resolveCheckpointDir` 落在失效目录（如源目录被删的 bind mount）下时，
 * 旧实现的递归 mkdirSync 会在 session/new 路径上永久卡死；仅换成非递归则会让会话没有运行时。
 * 现在的行为：会话照常进行（等同纯 MemorySaver），只是不落盘；目录恢复后自动恢复落盘。
 * 日志只在状态切换时打，不每个 step 刷屏。
 */

import { describe, it, expect, afterEach, afterAll, beforeEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { FileCheckpointSaver } from "../src/runtime/services/file-checkpoint-saver.js";
import { flushFileLogging } from "../src/runtime/logger.js";

/**
 * node:fs.mkdirSync 探针：默认透传真实实现；各用例按需替换，模拟「上级目录失效」。
 * 用 vi.hoisted + 可变对象：mock 工厂重新执行时闭包对象仍是同一个。
 */
const mkdirProbe = vi.hoisted(() => ({
  impl: null as null | ((path: string) => void),
  calls: [] as Array<{ path: string; options: unknown }>,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const realMkdirSync = actual.mkdirSync as unknown as (
    path: string,
    options?: unknown
  ) => void;
  const mkdirSync = (path: string, options?: unknown) => {
    mkdirProbe.calls.push({ path: String(path), options });
    if (mkdirProbe.impl) return mkdirProbe.impl(String(path));
    return realMkdirSync(String(path), options);
  };
  return { ...actual, mkdirSync, default: { ...actual.default, mkdirSync } };
});

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "flow-ckpt-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(() => {
  // 要断言 warn / info：级别调到 info；日志文件指到临时目录，不污染真实 ~/.flowagents。
  vi.stubEnv("LOG_LEVEL", "info");
  vi.stubEnv("LOG_DIR", freshDir());
});
afterEach(async () => {
  // 先把运行时 logger 排队的文件日志写完：此时 env 和临时目录都还在，不会留下失败的尾随写入。
  await flushFileLogging();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mkdirProbe.impl = null;
  mkdirProbe.calls.length = 0;
});

function captureStderr() {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  const output = () => chunks.join("");
  const count = (marker: string) => output().split(marker).length - 1;
  return { output, count };
}

function fsError(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`${code}: no such file or directory, mkdir '${path}'`),
    { code }
  );
}

/** 模拟「源目录已被删除的 bind mount」：dead 本身 mkdir → EEXIST，其下 → ENOENT。 */
function deadDirImpl(dead: string) {
  return (path: string): void => {
    if (path === dead) throw fsError("EEXIST", path);
    if (path.startsWith(dead + sep)) throw fsError("ENOENT", path);
  };
}

async function putCheckpoint(saver: FileCheckpointSaver, threadId: string, text: string) {
  await saver.put(
    { configurable: { thread_id: threadId } },
    {
      v: 4,
      id: `${threadId}-cp`,
      ts: "2026-06-16T00:00:00.000Z",
      channel_values: { messages: [new HumanMessage(text)] },
      channel_versions: {},
      versions_seen: {},
    } as never,
    { source: "loop", step: 0, parents: {} } as never
  );
}

function expectNoRecursiveMkdir() {
  for (const call of mkdirProbe.calls) {
    expect(
      (call.options as { recursive?: boolean } | undefined)?.recursive,
      `mkdirSync(${call.path}) 不应带 recursive`
    ).not.toBe(true);
  }
}

describe("FileCheckpointSaver：checkpoint 目录不可用时不拖垮会话", () => {
  it("目录建不出来：不抛、仅内存、只告警一次，put / getTuple 照常", async () => {
    const dead = join(freshDir(), "dead");
    mkdirProbe.impl = deadDirImpl(dead);
    const stderr = captureStderr();
    const dir = join(dead, "sessions", "w1");

    let saver: FileCheckpointSaver | undefined;
    expect(() => {
      saver = new FileCheckpointSaver({ dir });
    }).not.toThrow();
    expect(saver!.isPersistent).toBe(false);

    await putCheckpoint(saver!, "t1", "first");
    await putCheckpoint(saver!, "t2", "second");
    const tuple = await saver!.getTuple({ configurable: { thread_id: "t1" } });
    expect(tuple).not.toBeNull();

    expect(stderr.count("checkpoint persistence disabled")).toBe(1);
    expect(stderr.count("checkpoint persistence restored")).toBe(0);
    expect(existsSync(dir)).toBe(false); // 没有落盘
    expectNoRecursiveMkdir();
    // 每一级最多试两次：构造 1 次 + 两次 persist 各重试 1 次，调用次数仍然有界
    expect(mkdirProbe.calls.length).toBeLessThanOrEqual(3 * 2 * 6);
  });

  it("目录恢复后自动恢复落盘", async () => {
    const dead = join(freshDir(), "dead");
    mkdirProbe.impl = deadDirImpl(dead);
    const stderr = captureStderr();
    const dir = join(dead, "sessions", "w1");
    const saver = new FileCheckpointSaver({ dir });
    await putCheckpoint(saver, "t1", "during-outage");
    expect(saver.isPersistent).toBe(false);

    mkdirProbe.impl = null; // 目录恢复可用
    await putCheckpoint(saver, "t2", "after-recovery");

    expect(saver.isPersistent).toBe(true);
    expect(readFileSync(join(dir, "t2.json"), "utf-8")).toContain("after-recovery");
    expect(stderr.count("checkpoint persistence disabled")).toBe(1);
    expect(stderr.count("checkpoint persistence restored")).toBe(1);
  });

  it("运行中被删：写入失败只告警一次，下一次写入自动恢复", async () => {
    const dir = join(freshDir(), "sessions", "w2");
    const stderr = captureStderr();
    const saver = new FileCheckpointSaver({ dir });
    expect(saver.isPersistent).toBe(true);
    await putCheckpoint(saver, "t1", "before-delete");
    expect(existsSync(join(dir, "t1.json"))).toBe(true);

    rmSync(dir, { recursive: true, force: true }); // 运行中被删
    await putCheckpoint(saver, "t2", "during-outage");
    expect(saver.isPersistent).toBe(false);
    expect(stderr.count("checkpoint persistence disabled")).toBe(1);

    await putCheckpoint(saver, "t3", "after-recovery");
    expect(saver.isPersistent).toBe(true);
    expect(readFileSync(join(dir, "t3.json"), "utf-8")).toContain("after-recovery");
    expect(stderr.count("checkpoint persistence disabled")).toBe(1);
    expect(stderr.count("checkpoint persistence restored")).toBe(1);
  });
});
