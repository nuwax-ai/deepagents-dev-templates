/**
 * Cross-platform staging helpers (Windows PowerShell / macOS / Linux).
 * Used by package-platforms.mjs, package.mjs, and thin bash wrappers.
 */
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { commandExists } from "./tools.mjs";

export const STAGING_EXCLUDES = [
  ".git",
  ".github",
  ".idea",
  ".vscode",
  ".DS_Store",
  "node_modules",
  "dist-packages",
  "logs",
  "coverage",
  "src",
  "tests",
  ".env",
  ".env.local",
  ".env.example",
  ".gitignore",
  ".version.json",
  ".platform.json",
  "agent-package.release.json",
  "package-lock.json",
  "code-graph.json",
  "tsconfig.json",
  "tsconfig.*.json",
  "vitest.config.*",
  "CLAUDE.md",
  "QUICKSTART.md",
  "*.tgz",
  "*.tar.gz",
  "*.zip",
  "*.log",
  "*.local.json",
  "*.tsbuildinfo",
  "*.map",
  "*.tmp",
];

function globMatch(pattern, value) {
  const re = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return re.test(value);
}

export function shouldExclude(relPath, { excludeDist = false } = {}) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm || norm === ".") return false;

  const segments = norm.split("/");
  const fileName = segments.at(-1) ?? "";
  const patterns = excludeDist ? [...STAGING_EXCLUDES, "dist"] : STAGING_EXCLUDES;

  for (const pat of patterns) {
    if (pat.includes("*")) {
      if (
        segments.some((s) => globMatch(pat, s)) ||
        globMatch(pat, norm) ||
        globMatch(pat, fileName)
      ) {
        return true;
      }
    } else if (segments.includes(pat) || fileName === pat) {
      return true;
    }
  }
  return false;
}

function rsyncExcludeArgs(excludeDist) {
  const patterns = excludeDist ? [...STAGING_EXCLUDES, "dist"] : STAGING_EXCLUDES;
  const args = [];
  for (const pat of patterns) {
    if (pat.includes("*")) {
      args.push("--exclude", pat);
    } else {
      args.push("--exclude", `${pat}/`, "--exclude", pat);
    }
  }
  return args;
}

export async function copyPackageTree(pkgDir, destDir, { excludeDist = false } = {}) {
  await mkdir(destDir, { recursive: true });

  if (commandExists("rsync")) {
    const src = `${path.resolve(pkgDir).replace(/\\/g, "/")}/`;
    const dest = `${path.resolve(destDir).replace(/\\/g, "/")}/`;
    const result = spawnSync("rsync", ["-a", ...rsyncExcludeArgs(excludeDist), src, dest], {
      stdio: "inherit",
      shell: false,
    });
    if (result.status === 0) return;
    throw new Error(`rsync exited ${result.status ?? 1}`);
  }

  const entries = await readdir(pkgDir);
  for (const name of entries) {
    const src = path.join(pkgDir, name);
    if (shouldExclude(name, { excludeDist })) continue;
    const dest = path.join(destDir, name);
    await cp(src, dest, {
      recursive: true,
      filter: (source) => {
        const rel = path.relative(pkgDir, source);
        return !shouldExclude(rel, { excludeDist });
      },
    });
  }
}

export async function pruneReleaseResidue(stageRoot) {
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      const st = await stat(full);
      if (st.isDirectory()) {
        await walk(full);
        continue;
      }
      if (
        name === "agent-package.release.json" ||
        name.endsWith(".tgz") ||
        name.endsWith(".tar.gz") ||
        name.endsWith(".zip")
      ) {
        await rm(full, { force: true });
      }
    }
  }
  await walk(stageRoot);
}

function tarPathArg(p) {
  // Windows tar (bsdtar) mishandles `-C C:\...`; forward slashes are safer.
  return process.platform === "win32" ? p.replace(/\\/g, "/") : p;
}

function tarCommand() {
  return process.platform === "win32" ? "tar" : "tar";
}

export async function createTarGz(artifact, parentDir, folderName) {
  if (process.platform === "darwin") {
    process.env.COPYFILE_DISABLE = "1";
  }

  const absArtifact = path.resolve(artifact);
  await mkdir(path.dirname(absArtifact), { recursive: true });

  if (commandExists("gzip")) {
    await new Promise((resolve, reject) => {
      const out = createWriteStream(absArtifact);
      const tar = spawn(
        tarCommand(),
        ["-C", tarPathArg(parentDir), "-cf", "-", folderName],
        { stdio: ["ignore", "pipe", "inherit"], shell: false },
      );
      const gzip = spawn("gzip", ["-n"], { stdio: ["pipe", "pipe", "inherit"], shell: false });
      tar.stdout.pipe(gzip.stdin);
      gzip.stdout.pipe(out);
      const fail = (err) => reject(err);
      tar.on("error", fail);
      gzip.on("error", fail);
      out.on("error", fail);
      out.on("finish", resolve);
      tar.on("close", (code) => {
        if (code !== 0 && code !== null) reject(new Error(`tar exited ${code}`));
      });
    });
    return;
  }

  await new Promise((resolve, reject) => {
    const out = createWriteStream(absArtifact);
    const tar = spawn(
      tarCommand(),
      ["-C", tarPathArg(parentDir), "-cf", "-", folderName],
      { stdio: ["ignore", "pipe", "inherit"], shell: false },
    );
    const gz = createGzip({ level: 9 });
    tar.stdout.pipe(gz).pipe(out);
    const fail = (err) => reject(err);
    tar.on("error", fail);
    gz.on("error", fail);
    out.on("error", fail);
    out.on("finish", resolve);
    tar.on("close", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`tar exited ${code}`));
    });
  });
}

async function createZipPowerShell(artifact, parentDir, folderName) {
  const absArtifact = path.resolve(artifact);
  const absFolder = path.join(path.resolve(parentDir), folderName);
  await rm(absArtifact, { force: true });
  await new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -LiteralPath '${absFolder.replace(/'/g, "''")}' -DestinationPath '${absArtifact.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit", shell: false },
    );
    ps.on("error", reject);
    ps.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Compress-Archive exited ${code}`))));
  });
}

export async function createZipArchive(artifact, parentDir, folderName) {
  const absArtifact = path.resolve(artifact);
  await mkdir(path.dirname(absArtifact), { recursive: true });
  await rm(absArtifact, { force: true });

  if (commandExists("zip")) {
    await new Promise((resolve, reject) => {
      const child = spawn("zip", ["-qr", absArtifact, folderName], {
        cwd: parentDir,
        stdio: "inherit",
        shell: false,
      });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`zip exited ${code}`))));
    });
    return;
  }

  // Windows: prefer PowerShell before tar (bsdtar misparses `-C C:\...` for zip).
  if (process.platform === "win32") {
    await createZipPowerShell(absArtifact, parentDir, folderName);
    return;
  }

  if (commandExists(tarCommand())) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        tarCommand(),
        ["-a", "-cf", tarPathArg(absArtifact), "-C", tarPathArg(path.resolve(parentDir)), folderName],
        { stdio: "inherit", shell: false },
      );
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar zip exited ${code}`))));
    });
    return;
  }

  throw new Error("No zip tool available (install zip, or use PowerShell / tar with zip support)");
}

async function runCli() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === "copy") {
    const dest = args[0];
    const excludeDist = args.includes("--exclude-dist");
    const pkgDir = process.cwd();
    await copyPackageTree(pkgDir, path.resolve(dest), { excludeDist });
    return;
  }
  if (cmd === "zip") {
    const [artifact, parentDir, folderName] = args.filter((a) => !a.startsWith("--"));
    await createZipArchive(artifact, parentDir, folderName);
    return;
  }
  if (cmd === "tar-gz") {
    const [artifact, parentDir, folderName] = args.filter((a) => !a.startsWith("--"));
    await createTarGz(artifact, parentDir, folderName);
    return;
  }
  console.error("Usage: node staging.mjs copy <dest> [--exclude-dist]");
  console.error("       node staging.mjs zip <artifact> <parentDir> <folderName>");
  console.error("       node staging.mjs tar-gz <artifact> <parentDir> <folderName>");
  process.exit(2);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCli().catch((err) => {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  });
}
