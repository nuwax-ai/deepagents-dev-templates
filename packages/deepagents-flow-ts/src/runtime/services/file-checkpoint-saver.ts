/**
 * FileCheckpointSaver —— 文件后端的 checkpoint saver。
 *
 * 继承 MemorySaver（复用全部 serde 序列化 + getTuple/list/put/putWrites 协议逻辑），
 * 仅加一层文件持久化：每次 put/putWrites 后把该 thread 的状态落盘到
 * `<dir>/<thread_id>.json`；首次访问某 thread 时从文件懒加载进内存。
 *
 * 因走标准 checkpointer 协议，graph.compile({ checkpointer }) 后：
 *  - thread_id 隔离（现成）
 *  - getState / setState（现成）
 *  - interrupt / resume **跨进程/重启也恢复**（优于纯 MemorySaver）
 *
 * 不引入 native 依赖（纯 JS JSON），bundle 干净。生产规模可换 sqlite/postgres saver
 * （接口已对齐 BaseCheckpointSaver）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { MemorySaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { logger, type AppConfig } from "../index.js";

const log = logger.child("file-checkpoint");

export interface FileCheckpointOptions {
  /** 会话存储目录（相对路径按 cwd 解析）。 */
  dir: string;
}

/** 展开 ~/ 前缀（config.memory.dir 可能是 ~/...）。 */
function expandHome(p: string): string {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

/**
 * 由 AppConfig 解析会话存储目录 —— 与 createFlowRuntime 同口径（memory.dir，缺省 ./.flow-sessions）。
 * 抽出来供 FlowRuntime 与 createStatefulFlow 共用，避免两处目录解析漂移。
 */
export function resolveSessionDir(appConfig: AppConfig, workspaceRoot = process.cwd()): string {
  const memoryDir = expandHome(appConfig.memory?.dir || "./.flow-sessions");
  return memoryDir.startsWith("/") ? memoryDir : resolve(workspaceRoot, memoryDir);
}

/**
 * 由 AppConfig 造一个文件后端 checkpointer（跨重启恢复 + interrupt/resume 持久化）。
 * StatefulFlow 默认走这个 → 长任务默认就是持久的，而非内存态。
 */
export function createFileCheckpointer(
  appConfig: AppConfig,
  workspaceRoot = process.cwd()
): FileCheckpointSaver {
  return new FileCheckpointSaver({ dir: resolveSessionDir(appConfig, workspaceRoot) });
}

interface ThreadFileData {
  storage?: Record<string, unknown>;
  writes?: Record<string, unknown>;
}

/**
 * MemorySaver 的 storage/writes 里存的是 serde 产出的 **Uint8Array**（二进制 checkpoint/metadata）。
 * 朴素 JSON.stringify 会把 Uint8Array 序列化成 `{"0":..,"1":..}` 普通对象，重载后
 * serde.loadsTyped 期望 ArrayBufferView → 抛 "list argument must be ... ArrayBufferView"。
 * 故用 base64 包装保真：落盘时编码（replacer），载入时还原成 Uint8Array（reviver）。
 * 这是 FileCheckpointSaver 跨进程/重启续跑真正生效的关键（纯 MemorySaver 不落盘，无此问题）。
 */
const U8_TAG = "__u8a_b64__";
function replaceBytes(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { [U8_TAG]: Buffer.from(value).toString("base64") };
  }
  return value;
}
function reviveBytes(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)[U8_TAG] === "string"
  ) {
    return new Uint8Array(Buffer.from((value as Record<string, string>)[U8_TAG]!, "base64"));
  }
  return value;
}

export class FileCheckpointSaver extends MemorySaver {
  private dir: string;
  private loaded = new Set<string>();

  constructor(opts: FileCheckpointOptions) {
    super();
    this.dir = resolve(opts.dir);
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    log.info("FileCheckpointSaver ready", { dir: this.dir });
  }

  /** thread_id → 安全文件名（防路径穿越；非安全字符加 __hex__ 前缀编码，保证可逆）。 */
  private threadFile(threadId: string): string {
    const safe = /^[\w\-]+$/.test(threadId)
      ? threadId
      : `__hex__${Buffer.from(threadId).toString("hex")}`;
    return join(this.dir, `${safe}.json`);
  }

  /** 首次访问某 thread 时，从文件懒载入内存（合并进 MemorySaver 的 storage/writes）。 */
  private ensureLoaded(threadId: string): void {
    if (!threadId || this.loaded.has(threadId)) return;
    const file = this.threadFile(threadId);
    if (!existsSync(file)) {
      this.loaded.add(threadId);
      return;
    }
    try {
      const data = JSON.parse(readFileSync(file, "utf-8"), reviveBytes) as ThreadFileData;
      const storage = this.storage as unknown as Record<string, unknown>;
      const writes = this.writes as unknown as Record<string, unknown>;
      if (data.storage?.[threadId]) storage[threadId] = data.storage[threadId];
      if (data.writes) for (const [k, v] of Object.entries(data.writes)) writes[k] = v;
      this.loaded.add(threadId);
      log.debug("loaded checkpoint from file", { threadId });
    } catch (err) {
      log.warn("failed to load checkpoint file", { threadId, error: String(err) });
      // 不加入 loaded —— 下次访问可重试（文件损坏时不永久丢失会话）
    }
  }

  /** 把该 thread 的 storage + 相关 writes 落盘。 */
  private persist(threadId: string): void {
    if (!threadId) return;
    const storage = this.storage as unknown as Record<string, unknown>;
    const writes = this.writes as unknown as Record<string, unknown>;
    const threadStorage = storage[threadId];
    const writesForThread: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(writes)) {
      try {
        const parsed = JSON.parse(k) as [string, string?, string?];
        if (parsed[0] === threadId) writesForThread[k] = v;
      } catch {
        /* skip malformed keys */
      }
    }
    try {
      writeFileSync(
        this.threadFile(threadId),
        JSON.stringify(
          { storage: { [threadId]: threadStorage }, writes: writesForThread },
          replaceBytes
        )
      );
    } catch (err) {
      log.warn("failed to persist checkpoint", { threadId, error: String(err) });
    }
  }

  override async getTuple(config: RunnableConfig) {
    const tid = config.configurable?.thread_id as string | undefined;
    if (tid) this.ensureLoaded(tid);
    return super.getTuple(config);
  }

  override async *list(config: RunnableConfig, options?: unknown) {
    const tid = config.configurable?.thread_id as string | undefined;
    if (tid) {
      this.ensureLoaded(tid);
    } else if (existsSync(this.dir)) {
      // 扫描目录所有 thread 文件，懒载入内存后交给基类 list（经 listThreadIds 解码真实 ID）
      for (const realId of this.listThreadIds()) {
        this.ensureLoaded(realId);
      }
    }
    yield* super.list(config, options as Parameters<MemorySaver["list"]>[1]);
  }

  override async put(
    config: RunnableConfig,
    checkpoint: Parameters<MemorySaver["put"]>[1],
    metadata: Parameters<MemorySaver["put"]>[2]
  ): Promise<RunnableConfig> {
    // 防御：若重启后首次操作是 put（而非 getTuple），先 load 旧 checkpoint，避免 persist 覆盖丢失历史
    const tid = config.configurable?.thread_id as string | undefined;
    if (tid) this.ensureLoaded(tid);
    const ret = await super.put(config, checkpoint, metadata);
    if (tid) this.persist(tid);
    return ret;
  }

  override async putWrites(
    config: RunnableConfig,
    writes: Parameters<MemorySaver["putWrites"]>[1],
    taskId: string
  ): Promise<void> {
    const tid = config.configurable?.thread_id as string | undefined;
    if (tid) this.ensureLoaded(tid);
    await super.putWrites(config, writes, taskId);
    if (tid) this.persist(tid);
  }

  /** 列出所有已持久化的 thread id（供 CLI sessions list）。 */
  listThreadIds(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const stem = f.slice(0, -".json".length);
        return stem.startsWith("__hex__")
          ? Buffer.from(stem.slice("__hex__".length), "hex").toString("utf-8")
          : stem;
      });
  }

  /** 删除某 thread 的持久化文件 + 内存。 */
  async deleteThread(threadId: string): Promise<void> {
    if (typeof super.deleteThread === "function") {
      await super.deleteThread(threadId);
    }
    const file = this.threadFile(threadId);
    if (existsSync(file)) unlinkSync(file);
    this.loaded.delete(threadId);  // 允许同进程内以相同 threadId 重新开题
  }
}
