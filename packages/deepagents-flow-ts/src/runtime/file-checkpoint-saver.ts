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
import { MemorySaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { logger } from "deepagents-app-ts/runtime";

const log = logger.child("file-checkpoint");

export interface FileCheckpointOptions {
  /** 会话存储目录（相对路径按 cwd 解析）。 */
  dir: string;
}

interface ThreadFileData {
  storage?: Record<string, unknown>;
  writes?: Record<string, unknown>;
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

  /** thread_id → 安全文件名（防路径穿越；非安全字符 hex 编码）。 */
  private threadFile(threadId: string): string {
    const safe = /^[\w\-]+$/.test(threadId)
      ? threadId
      : Buffer.from(threadId).toString("hex");
    return join(this.dir, `${safe}.json`);
  }

  /** 首次访问某 thread 时，从文件懒载入内存（合并进 MemorySaver 的 storage/writes）。 */
  private ensureLoaded(threadId: string): void {
    if (!threadId || this.loaded.has(threadId)) return;
    this.loaded.add(threadId);
    const file = this.threadFile(threadId);
    if (!existsSync(file)) return;
    try {
      const data = JSON.parse(readFileSync(file, "utf-8")) as ThreadFileData;
      const storage = this.storage as unknown as Record<string, unknown>;
      const writes = this.writes as unknown as Record<string, unknown>;
      if (data.storage?.[threadId]) storage[threadId] = data.storage[threadId];
      if (data.writes) for (const [k, v] of Object.entries(data.writes)) writes[k] = v;
      log.debug("loaded checkpoint from file", { threadId });
    } catch (err) {
      log.warn("failed to load checkpoint file", { threadId, error: String(err) });
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
        JSON.stringify({ storage: { [threadId]: threadStorage }, writes: writesForThread })
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
      // 扫描目录所有 thread 文件，懒载入内存后交给基类 list
      for (const f of readdirSync(this.dir)) {
        const m = f.match(/^(.+)\.json$/);
        if (m) this.ensureLoaded(m[1]!);
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
      .map((f) => f.slice(0, -".json".length));
  }

  /** 删除某 thread 的持久化文件 + 内存。 */
  async deleteThread(threadId: string): Promise<void> {
    if (typeof super.deleteThread === "function") {
      await super.deleteThread(threadId);
    }
    const file = this.threadFile(threadId);
    if (existsSync(file)) unlinkSync(file);
  }
}
