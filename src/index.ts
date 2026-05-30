#!/usr/bin/env node

/**
 * DeepAgents Dev Templates — Main Entry Point
 *
 * This is the entry point for the ACP application agent.
 * It bootstraps the runtime and starts the ACP server.
 *
 * Usage:
 *   node dist/index.js              # Start ACP server (production)
 *   tsx src/index.ts                # Start ACP server (development)
 *   tsx src/index.ts --debug        # Start with debug logging
 *   tsx src/index.ts --no-acp       # Skip ACP server (agent creation only)
 */

import { config as loadDotenv } from "dotenv";
import { bootstrap } from "./runtime/index.js";

// Load .env file if present (before any config reads)
loadDotenv();

// Parse CLI arguments
const args = process.argv.slice(2);
const debug = args.includes("--debug");
const acp = !args.includes("--no-acp"); // Default: ACP mode on

async function main(): Promise<void> {
  try {
    await bootstrap({ acp, debug });
  } catch (error) {
    console.error("Fatal error during bootstrap:", error);
    process.exit(1);
  }
}

main();
