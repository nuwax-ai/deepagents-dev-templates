#!/usr/bin/env node
/**
 * Install optional packaging CLI tools.
 * Windows: rsync + zip via Chocolatey (pnpm run setup:tools)
 * macOS/Linux: usually pre-installed; prints check report.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectPackagingTools, formatToolReport } from "./lib/tools.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function runWindowsSetup() {
  const ps1 = path.join(SCRIPT_DIR, "setup-win-tools.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { stdio: "inherit", shell: false },
  );
  process.exit(result.status ?? 1);
}

function main() {
  if (process.platform === "win32") {
    runWindowsSetup();
    return;
  }

  const tools = detectPackagingTools();
  console.log(formatToolReport(tools));
  const missing = Object.entries(tools).filter(([, ok]) => !ok);
  if (missing.length === 0) {
    console.log("\nAll packaging tools are available.");
    return;
  }
  console.log("\nmacOS:  brew install rsync zip");
  console.log("Linux:  sudo apt install rsync zip   # Debian/Ubuntu");
  console.log("        sudo dnf install rsync zip   # Fedora");
}

main();
