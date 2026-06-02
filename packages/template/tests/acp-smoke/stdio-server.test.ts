import { describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk";

class SmokeClient implements Client {
  updates: SessionNotification[] = [];

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.updates.push(params);
  }

  async requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return {
      outcome: {
        outcome: "selected",
        optionId: "reject",
      },
    };
  }

  async readTextFile(_params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    return { content: "" };
  }

  async writeTextFile(_params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    return {};
  }
}

function startAcpServer(): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "acp-smoke-dummy-key",
      LOG_LEVEL: "error",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("ACP stdio server", () => {
  it("handles initialize and session/new without invoking the LLM", async () => {
    const child = startAcpServer();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    const smokeClient = new SmokeClient();
    const connection = new ClientSideConnection(
      () => smokeClient,
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
      )
    );

    try {
      const init = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: {
          name: "nuwaclaw-acp-smoke",
          version: "0.0.0",
        },
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      });

      expect(init.agentInfo?.name).toBe("my-scenario-agent");
      expect(init.agentCapabilities.loadSession).toBe(true);
      expect(init.agentCapabilities.sessionCapabilities?.commands).toBe(true);

      const session = await connection.newSession({
        cwd: process.cwd(),
        mcpServers: [],
      });

      expect(session.sessionId).toMatch(/^sess_/);
      expect(session.modes?.currentModeId).toBe("agent");
      expect(smokeClient.updates.some((update) =>
        update.update.sessionUpdate === "available_commands_update"
      )).toBe(true);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nACP stderr:\n${stderr}`);
    } finally {
      child.kill();
    }
  }, 10_000);
});
