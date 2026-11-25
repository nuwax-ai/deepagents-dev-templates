/**
 * 跨平台 esbuild 打包（Windows / macOS / Linux）。
 * 将可运行入口及其生产依赖打成单一自包含 ESM 文件。
 */
import * as esbuild from "esbuild";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBundleGuarded } from "./bundle-guard.mjs";

// bundled CJS 依赖（如 dotenv）会调用 require("fs")，ESM bundle 需此 banner。
const BANNER =
  "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);";

export async function bundleAgent({
  entry = "src/index.ts",
  outfile,
  cwd = process.cwd(),
  quiet = false,
}) {
  const log = quiet ? () => {} : (msg) => console.error(msg);
  const absOut = path.resolve(cwd, outfile);
  await mkdir(path.dirname(absOut), { recursive: true });

  log(`Bundling ${entry} -> ${absOut} (esbuild)`);
  await esbuild.build({
    entryPoints: [path.join(cwd, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: absOut,
    banner: { js: BANNER },
    logLevel: "warning",
    absWorkingDir: cwd,
  });

  const { size } = await stat(absOut);
  // 产物守卫：发布的是 bundle 而不是 src/，所以在这里再验一次（pnpm bundle / package*.mjs 都经此处）。
  assertBundleGuarded(await readFile(absOut, "utf8"), { source: absOut });
  log(`Bundle guard passed`);

  const kb = (size / 1024).toFixed(1);
  log(`Bundle written: ${absOut} (${kb} KB)`);
}

async function runCli() {
  const outfile = process.argv[2] ?? "dist/bundle.mjs";
  const entry = process.env.ENTRY ?? "src/index.ts";
  await bundleAgent({ entry, outfile, cwd: process.cwd() });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
