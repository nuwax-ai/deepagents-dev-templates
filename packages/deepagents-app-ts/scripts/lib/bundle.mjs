/**
 * Cross-platform esbuild bundle (Windows / macOS / Linux).
 */
import * as esbuild from "esbuild";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
