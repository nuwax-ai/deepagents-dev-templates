/**
 * Filesystem Path Resolution Middleware
 *
 * Resolves workspace-relative paths (e.g. "/test.txt") to absolute paths
 * before filesystem tools execute. This is needed because:
 * - The LLM generates workspace-relative paths like "/test.txt"
 * - ACP clients (Zed) require absolute paths for fs/write_text_file
 */

import { createMiddleware } from "langchain";
import { resolve } from "node:path";

const FS_TOOLS = new Set(["write_file", "edit_file", "read_file"]);
const PATH_KEYS = ["file_path", "path"];

export function createFsPathResolver(workspaceRoot: string) {
  // Normalize workspace root for comparison (ensure trailing slash)
  const normalizedRoot = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";

  return createMiddleware({
    name: "fsPathResolver",

    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name;
      const originalArgs = request.toolCall.args;

      if (FS_TOOLS.has(toolName) && originalArgs) {
        const args = { ...originalArgs };
        for (const key of PATH_KEYS) {
          const val = args[key];
          if (typeof val === "string" && val.startsWith("/")) {
            // Skip if already under workspace root
            if (val.startsWith(normalizedRoot) || val === workspaceRoot) {
              continue;
            }
            // Skip absolute system paths (e.g. /Users/..., /home/..., /tmp/...)
            // These are already absolute and should not be resolved relative to workspace
            const isSystemAbsolutePath =
              val.startsWith("/Users/") ||
              val.startsWith("/home/") ||
              val.startsWith("/tmp/") ||
              val.startsWith("/var/") ||
              val.startsWith("/opt/") ||
              val.startsWith("/usr/") ||
              val.startsWith("/etc/") ||
              val.startsWith("/bin/") ||
              val.startsWith("/sbin/") ||
              val.startsWith("/lib/") ||
              val.startsWith("/System/") ||
              val.startsWith("/Volumes/") ||
              val.startsWith("/private/") ||
              val.startsWith("/dev/") ||
              val.startsWith("/proc/") ||
              val.startsWith("/run/") ||
              val.startsWith("/boot/") ||
              val.startsWith("/mnt/") ||
              val.startsWith("/media/") ||
              val.startsWith("/srv/") ||
              val.startsWith("/sys/") ||
              val.startsWith("/snap/") ||
              val.startsWith("/cygdrive/") ||
              val.startsWith("/c/") ||
              val.startsWith("/d/") ||
              val.startsWith("/nix/") ||
              val.startsWith("/net/");
            if (isSystemAbsolutePath) {
              continue;
            }
            // Resolve workspace-relative path (e.g. "/test.txt" → "<workspace>/test.txt")
            args[key] = resolve(workspaceRoot, val.slice(1));
          }
        }
        request.toolCall.args = args;
      }

      const result = await handler(request);
      return result;
    },
  });
}
