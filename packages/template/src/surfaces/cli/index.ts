/**
 * CLI Surface — Barrel
 *
 * The terminal runnable surface: interactive REPL (`chat`) and one-shot
 * (`ask` / `run`) modes. Composes the runtime engine (`../../runtime`).
 */

export { startRepl } from "./repl.js";
export { runOneShot, runPromptFile } from "./one-shot.js";
