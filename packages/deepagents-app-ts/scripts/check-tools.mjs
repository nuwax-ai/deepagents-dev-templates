#!/usr/bin/env node
/** Report packaging CLI tool availability (rsync, zip, gzip, tar). */
import { detectPackagingTools, formatToolReport } from "./lib/tools.mjs";

const tools = detectPackagingTools();
console.log(formatToolReport(tools));
const missing = Object.entries(tools).filter(([, ok]) => !ok);
process.exit(missing.length > 0 ? 1 : 0);
