import { describe, expect, it, beforeAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// This spawns the esbuild bundle (dist/bundle.mjs) — the real Nuwax runtime,
// not the tsc/tsx source. It only runs under `npm run test:bundle-smoke`, which
// rebuilds the bundle first and sets BUNDLE_SMOKE=1. The default `npm test`
// skips it: keeps the unit loop fast and avoids asserting on a stale bundle.
const ENABLED = process.env.BUNDLE_SMOKE === "1";

// vitest's root is this package (vitest.config.ts lives here), so cwd is the
// template dir — same assumption stdio-server.test.ts relies on.
const TEMPLATE_DIR = process.cwd();
const BUNDLE_PATH = join(TEMPLATE_DIR, "dist/bundle.mjs");
const CONFIG_PATH = join(TEMPLATE_DIR, "config/app-agent.config.json");

class SmokeClient implements Client {
  updates: SessionNotification[] = [];

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.updates.push(params);
  }

  async requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return { outcome: { outcome: "selected", optionId: "reject" } };
  }

  async readTextFile(_params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    return { content: "" };
  }

  async writeTextFile(_params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    return {};
  }
}

function startBundledServer(extraArgs: string[] = []): ChildProcessWithoutNullStreams {
  // Plain `node dist/bundle.mjs` — no --import tsx, no source tree. This is how
  // the bundle runs on a client machine, so a missing createRequire shim or an
  // unbundled CJS dep surfaces here rather than post-install in production.
  return spawn(process.execPath, [BUNDLE_PATH, ...extraArgs], {
    cwd: TEMPLATE_DIR,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "bundle-smoke-dummy-key",
      DEEPAGENTS_HOME: mkdtempSync(join(tmpdir(), "bundle-smoke-deepagents-")),
      LOG_LEVEL: "error",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function connect(child: ChildProcessWithoutNullStreams) {
  const client = new SmokeClient();
  const connection = new ClientSideConnection(
    () => client,
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
  );
  return { client, connection };
}

describe.runIf(ENABLED)("ACP stdio server (esbuild bundle)", () => {
  beforeAll(() => {
    if (!existsSync(BUNDLE_PATH)) {
      throw new Error(
        `dist/bundle.mjs not found at ${BUNDLE_PATH}.\n` +
          "Run `npm run test:bundle-smoke` (it builds the bundle first), " +
          "or `npm run bundle` before this test."
      );
    }
  });

  // Core smoke: the bundle must boot as a plain node ESM file and speak ACP.
  // A broken createRequire banner or an unbundled CJS dep would crash before
  // initialize() ever returns — that's the "runs in dev, dies on the client"
  // class of bug this test exists to catch.
  //
  // We do NOT assert agentInfo.name here: with no --config, the bundle can't
  // locate config/app-agent.config.json (its builtin-config path is derived
  // from import.meta.url, which points into dist/ once bundled), so it falls
  // back to zod schema defaults. That config-resolution gap is a separate,
  // tracked concern — see the --config case below, which proves the bundle
  // *can* load config when the path is passed the way production should.
  it("boots from dist/bundle.mjs and speaks ACP (initialize + session/new + command)", async () => {
    const child = startBundledServer();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    const { client, connection } = connect(child);

    try {
      const init = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "nuwaclaw-bundle-smoke", version: "0.0.0" },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });

      // Agent identity + capabilities are intrinsic to the bundle, not the config file.
      expect(init.agentInfo?.name).toBeTruthy();
      expect(init.agentCapabilities.loadSession).toBe(true);
      expect(init.agentCapabilities.sessionCapabilities?.commands).toBe(true);

      const session = await connection.newSession({ cwd: TEMPLATE_DIR, mcpServers: [] });
      expect(session.sessionId).toMatch(/^sess_/);
      expect(session.modes?.currentModeId).toBe("agent");

      const commandsUpdate = client.updates.find(
        (update) => update.update.sessionUpdate === "available_commands_update"
      );
      const commandNames =
        commandsUpdate?.update.sessionUpdate === "available_commands_update"
          ? commandsUpdate.update.availableCommands.map((command) => command.name)
          : [];
      expect(commandNames).toContain("help");
      expect(commandNames).toContain("config");

      // /config runs fully in-process (no model call). A clean end_turn with
      // non-empty text proves command dispatch + stdio round-trip work end to end.
      client.updates = [];
      const promptResult = await connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "/config" }],
      });
      expect(promptResult.stopReason).toBe("end_turn");
      const responseText = client.updates
        .filter((update) => update.update.sessionUpdate === "agent_message_chunk")
        .map((update) =>
          update.update.sessionUpdate === "agent_message_chunk" ? update.update.content.text : ""
        )
        .join("");
      expect(responseText.length).toBeGreaterThan(0);
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\nBundle stderr:\n${stderr}`
      );
    } finally {
      child.kill();
    }
  }, 20_000);

  // Production form: render-acp-config.sh starts the agent with an explicit
  // `--config <abs>/config/app-agent.config.json`. With that path passed, the
  // bundle must load the real config (agent.name = "my-scenario-agent"), not
  // the schema default. This pins the config-resolution gap to "the launch
  // args must include --config", not to a defect in the bundle itself.
  it("loads config/app-agent.config.json when --config is passed (production form)", async () => {
    const child = startBundledServer(["--config", CONFIG_PATH]);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    const { connection } = connect(child);

    try {
      const init = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "nuwaclaw-bundle-smoke", version: "0.0.0" },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      expect(init.agentInfo?.name).toBe("my-scenario-agent");
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\nBundle stderr:\n${stderr}`
      );
    } finally {
      child.kill();
    }
  }, 20_000);
});
