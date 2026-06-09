/**
 * Runtime Info Tool
 *
 * Reports the effective runtime workspace and session metadata. This gives the
 * agent a reliable source of truth instead of inferring workspace state by
 * listing parent directories.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeStorage } from "../../runtime/storage/runtime-storage.js";
import { readHarnessLifecycle } from "../../runtime/storage/harness-lifecycle.js";

export interface RuntimeInfoToolOptions {
  workspaceRoot: string;
}

export function createRuntimeInfoTool(options: RuntimeInfoToolOptions) {
  return tool(
    async ({ includeStorage, includeLifecycle }) => {
      const storage = getRuntimeStorage({ workspaceRoot: options.workspaceRoot });
      return JSON.stringify({
        workspaceRoot: storage.workspaceRoot,
        workspaceId: storage.workspaceSlug,
        processCwd: process.cwd(),
        sessionId: storage.sessionId,
        ...(includeStorage
          ? {
              storage: {
                workspaceDir: storage.workspaceDir,
                sessionDir: storage.sessionDir,
                messagesPath: storage.messagesPath,
                lifecyclePath: storage.lifecyclePath,
              },
            }
          : {}),
        ...(includeLifecycle
          ? {
              lifecycle: readHarnessLifecycle(storage),
            }
          : {}),
      });
    },
    {
      name: "runtime_info",
      description:
        "Return the effective DeepAgents runtime workspace root, current session id, process cwd, and optional storage paths. Use this when the user asks for the current workspace directory, project root, cwd, session, or runtime status.",
      schema: z.object({
        includeStorage: z
          .boolean()
          .optional()
          .default(false)
          .describe("Whether to include DeepAgents storage paths in the response"),
        includeLifecycle: z
          .boolean()
          .optional()
          .default(false)
          .describe("Whether to include the harness lifecycle snapshot for the current session"),
      }),
    }
  );
}
