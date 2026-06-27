#!/usr/bin/env node
/**
 * NuwaClaw Electron 本地调试：用 monorepo packages/<template> 替换工作区里的模板文件（软链）。
 * 工作区保留 .agents / .logs / node_modules / project.md 等项目运行时目录。
 *
 * 用法（monorepo 根目录）：
 *   pnpm run dev:electron:link
 *   pnpm run dev:electron:status
 *   pnpm run dev:electron:unlink
 */
import { cp, lstat, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = path.join(REPO_ROOT, ".dev-electron-workspace.json");

const DEFAULT_PACKAGE = "deepagents-flow-ts";
const DEFAULT_WORKSPACE =
  "/Users/apple/Downloads/test-electron-client/computer-project-workspace/1746495851/1554162";

/**
 * 从 monorepo 包软链到 Electron 工作区的条目（相对包根）。
 * 新增模板顶层文件/目录时在此补充。
 */
const LINK_ENTRIES = [
  "src",
  "config",
  "prompts",
  "examples",
  "docs",
  "dist",
  "tests",
  "scripts",
  ".nuwax-agent",
  "package.json",
  "README.md",
  "tsconfig.json",
  "tsconfig.examples.json",
  "vitest.config.ts",
];

/** 工作区运行时目录/文件，link 时不触碰 */
const PRESERVE_NAMES = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".opencode",
  ".logs",
  ".tmp",
  ".flow-sessions",
  ".git",
  "node_modules",
  "pnpm-lock.yaml",
  ".npmrc",
  "project.md",
  ".env",
  ".env.example",
  ".env.local",
  ".DS_Store",
]);

function loadEnvFile(filePath, { override = false } = {}) {
  if (!existsSync(filePath)) {
    return;
  }
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(REPO_ROOT, ".env"));
loadEnvFile(path.join(REPO_ROOT, ".env.local"), { override: true });

function resolvePackageDir(packageName) {
  const pkgDir = path.join(REPO_ROOT, "packages", packageName);
  if (!existsSync(pkgDir)) {
    throw new Error(`模板包不存在: ${pkgDir}`);
  }
  return pkgDir;
}

function usage(exitCode = 0) {
  console.log(`Usage: node scripts/dev-electron-workspace.mjs <command> [options]

Commands:
  status   显示各条目软链状态
  link     用 packages/<pkg> 替换工作区模板文件（软链，默认）
  sync     复制替换（非软链）
  unlink   删除软链并恢复备份

Options:
  --workspace <dir>
  --package <name>     默认 deepagents-flow-ts
  --dry-run
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  let workspace;
  let packageName = process.env.DEEPAGENTS_ELECTRON_PACKAGE || DEFAULT_PACKAGE;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") {
      workspace = argv[++i];
      continue;
    }
    if (arg === "--package") {
      packageName = argv[++i];
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage(0);
    }
    positional.push(arg);
  }

  const command = positional[0];
  if (!command) {
    usage(1);
  }

  const pkgDir = resolvePackageDir(packageName);
  loadEnvFile(path.join(pkgDir, ".env"));
  loadEnvFile(path.join(pkgDir, ".env.local"), { override: true });

  const resolvedWorkspace = path.resolve(
    workspace ||
      process.env.NUWACLAW_ELECTRON_WORKSPACE ||
      DEFAULT_WORKSPACE,
  );

  return { command, workspace: resolvedWorkspace, pkgDir, packageName, dryRun };
}

async function readState() {
  if (!existsSync(STATE_FILE)) {
    return null;
  }
  return JSON.parse(await readFile(STATE_FILE, "utf8"));
}

async function writeState(state) {
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function clearState() {
  if (existsSync(STATE_FILE)) {
    await rm(STATE_FILE);
  }
}

async function isSymlinkTo(linkPath, expectedTarget) {
  if (!existsSync(linkPath)) {
    return false;
  }
  const st = await lstat(linkPath);
  if (!st.isSymbolicLink()) {
    return false;
  }
  const { realpath } = await import("node:fs/promises");
  const [linkReal, targetReal] = await Promise.all([
    realpath(linkPath),
    realpath(expectedTarget),
  ]);
  return linkReal === targetReal;
}

function assertWorkspace(workspace) {
  if (!existsSync(workspace)) {
    throw new Error(`工作区不存在: ${workspace}`);
  }
  if (!existsSync(path.join(workspace, "node_modules"))) {
    throw new Error(
      `工作区缺少 node_modules，请先在 Electron 工作区执行 pnpm install:\n  ${workspace}`,
    );
  }
}

function isLegacyBackupName(name) {
  return name.includes(".deployed-backup-") || name.startsWith(".electron-deployed-backup-");
}

function resolveLinkEntries(pkgDir) {
  return LINK_ENTRIES.filter((entry) => existsSync(path.join(pkgDir, entry)));
}

async function cmdStatus({ workspace, pkgDir, packageName }) {
  assertWorkspace(workspace);
  const state = await readState();
  const entries = resolveLinkEntries(pkgDir);
  const rows = [];

  for (const entry of entries) {
    const wsPath = path.join(workspace, entry);
    const pkgPath = path.join(pkgDir, entry);
    let status = "missing";
    if (await isSymlinkTo(wsPath, pkgPath)) {
      status = "linked";
    } else if (existsSync(wsPath)) {
      status = "local";
    }
    rows.push({ entry, status });
  }

  const linkedCount = rows.filter((r) => r.status === "linked").length;

  console.log("NuwaClaw Electron dev workspace");
  console.log(`  repo     : ${REPO_ROOT}`);
  console.log(`  package  : ${packageName} (${pkgDir})`);
  console.log(`  workspace: ${workspace}`);
  console.log(`  linked   : ${linkedCount}/${entries.length} 条目 → monorepo`);
  console.log(`  logs     : ${path.join(workspace, ".logs")}`);
  console.log("");
  for (const { entry, status } of rows) {
    const mark = status === "linked" ? "✓" : status === "local" ? "·" : " ";
    console.log(`  ${mark} ${entry.padEnd(24)} ${status}`);
  }
  console.log("");
  console.log(`启动: tsx ${path.join(workspace, "src/index.ts")}`);
  if (state) {
    console.log(`\nState: ${STATE_FILE}`);
    console.log(JSON.stringify(state, null, 2));
  }
}

function makeBackupRoot(workspace) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(workspace, `.electron-deployed-backup-${stamp}`);
}

async function backupEntry(wsPath, backupRoot, entry, dryRun) {
  const dest = path.join(backupRoot, entry);
  if (dryRun) {
    console.log(`[dry-run] backup ${wsPath} → ${dest}`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(wsPath, dest);
  console.log(`  备份 ${entry}`);
}

async function installEntry({ workspace, pkgDir, entry, mode, backupRoot, dryRun }) {
  const wsPath = path.join(workspace, entry);
  const pkgPath = path.join(pkgDir, entry);

  if (mode === "symlink" && (await isSymlinkTo(wsPath, pkgPath))) {
    return false;
  }

  if (existsSync(wsPath)) {
    const st = await lstat(wsPath);
    if (st.isSymbolicLink()) {
      if (!dryRun) {
        await rm(wsPath);
      }
    } else {
      await backupEntry(wsPath, backupRoot, entry, dryRun);
    }
  }

  if (dryRun) {
    if (mode === "symlink") {
      console.log(`[dry-run] ln -s ${pkgPath} ${wsPath}`);
    } else {
      console.log(`[dry-run] cp ${pkgPath} → ${wsPath}`);
    }
    return true;
  }

  if (mode === "symlink") {
    await symlink(pkgPath, wsPath);
    console.log(`  软链 ${entry} → monorepo`);
  } else {
    await cp(pkgPath, wsPath, { recursive: true, force: true });
    console.log(`  复制 ${entry} ← monorepo`);
  }
  return true;
}

async function applyPackageReplace({ workspace, pkgDir, packageName, mode, dryRun }) {
  assertWorkspace(workspace);
  const entries = resolveLinkEntries(pkgDir);
  if (entries.length === 0) {
    throw new Error(`包内无可链接条目: ${pkgDir}`);
  }

  const backupRoot = makeBackupRoot(workspace);
  const changed = [];

  console.log(mode === "symlink" ? "软链 monorepo 包到工作区:" : "复制 monorepo 包到工作区:");
  for (const entry of entries) {
    if (PRESERVE_NAMES.has(entry)) {
      continue;
    }
    const didChange = await installEntry({
      workspace,
      pkgDir,
      entry,
      mode,
      backupRoot,
      dryRun,
    });
    if (didChange) {
      changed.push(entry);
    }
  }

  if (!dryRun && changed.length > 0) {
    await writeState({
      workspace,
      packageName,
      pkgDir,
      mode,
      linkedAt: new Date().toISOString(),
      backupRoot: existsSync(backupRoot) ? backupRoot : null,
      linkedEntries: entries,
      changedEntries: changed,
    });
  }

  return { changed, entries };
}

async function cmdLink(ctx) {
  const { changed } = await applyPackageReplace({ ...ctx, mode: "symlink" });
  if (changed.length === 0) {
    console.log("已全部软链，无需重复操作。");
  }
  await cmdStatus(ctx);
}

async function cmdSync(ctx) {
  await applyPackageReplace({ ...ctx, mode: "copy" });
  await cmdStatus(ctx);
}

async function restoreFromBackup(backupRoot, workspace, entry, dryRun) {
  const src = path.join(backupRoot, entry);
  const dest = path.join(workspace, entry);
  if (!existsSync(src)) {
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] restore ${src} → ${dest}`);
    return;
  }
  if (existsSync(dest)) {
    await rm(dest, { recursive: true, force: true });
  }
  await rename(src, dest);
  console.log(`  恢复 ${entry}`);
}

async function cmdUnlink({ workspace, pkgDir, dryRun }) {
  assertWorkspace(workspace);
  const state = await readState();

  if (!state) {
    throw new Error("无 state 文件，无法自动恢复。请手动处理工作区。");
  }

  const entries = state.linkedEntries ?? LINK_ENTRIES;
  const backupRoot = state.backupRoot;

  console.log("删除 monorepo 软链:");
  for (const entry of entries) {
    const wsPath = path.join(workspace, entry);
    const pkgPath = path.join(state.pkgDir ?? pkgDir, entry);
    if (!(await isSymlinkTo(wsPath, pkgPath))) {
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] rm ${wsPath}`);
    } else {
      await rm(wsPath);
      console.log(`  删除软链 ${entry}`);
    }
  }

  if (backupRoot && existsSync(backupRoot)) {
    console.log(`从备份恢复: ${backupRoot}`);
    const backed = await readdir(backupRoot);
    for (const name of backed) {
      await restoreFromBackup(backupRoot, workspace, name, dryRun);
    }
    if (!dryRun) {
      await rm(backupRoot, { recursive: true, force: true });
    }
  } else if (state.backupDir && existsSync(state.backupDir)) {
    // 兼容旧版仅 src 备份
    const wsSrc = path.join(workspace, "src");
    if (dryRun) {
      console.log(`[dry-run] restore legacy ${state.backupDir} → ${wsSrc}`);
    } else {
      await rename(state.backupDir, wsSrc);
      console.log("  恢复 legacy src 备份");
    }
  }

  if (!dryRun) {
    await clearState();
  }
  console.log("完成。");
}

async function main() {
  const ctx = parseArgs(process.argv.slice(2));
  const { command, dryRun, ...rest } = ctx;

  switch (command) {
    case "status":
      await cmdStatus(rest);
      break;
    case "link":
      await cmdLink({ ...rest, dryRun });
      break;
    case "sync":
      await cmdSync({ ...rest, dryRun });
      break;
    case "unlink":
      await cmdUnlink({ ...rest, dryRun });
      break;
    default:
      console.error(`未知命令: ${command}`);
      usage(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
