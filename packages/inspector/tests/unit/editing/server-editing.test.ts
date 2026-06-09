import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";
import { startInspectServer, type InspectServerHandle } from "../../../src/server.js";
import { inspectAgent, defaultStaticDir } from "../../../src/inspector.js";
import { hashContent } from "../../../src/editing/paths.js";
import { readConfigSource } from "../../../src/editing/config-source.js";

let root: string;
let handle: InspectServerHandle;
const CFG = "config/app-agent.config.json";

beforeEach(async () => {
  const templateRoot = resolve(process.cwd(), "../template");
  root = mkdtempSync(join(tmpdir(), "inspector-srv-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(
    join(root, CFG),
    readFileSync(join(templateRoot, "config/app-agent.config.json"), "utf-8"),
    "utf-8"
  );
  writeFileSync(join(root, "prompts/sys.md"), "hello from the server test", "utf-8");
  const runtime = await loadTemplateRuntime();
  const spec = await inspectAgent({ workspaceRoot: root, configPath: CFG });
  handle = await startInspectServer({
    spec,
    staticDir: defaultStaticDir(),
    port: 7400,
    portRangeEnd: 7450,
    editing: { runtime, workspaceRoot: root, configPath: CFG },
  });
});
afterEach(async () => {
  await handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe("editing endpoints", () => {
  it("POST /api/preview returns a config diff", async () => {
    const res = await fetch(`${handle.url}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "model.name": "gpt-4o" }, text: [] }),
    });
    const body = await res.json();
    expect(body.validation.ok).toBe(true);
    expect(body.files[0].after).toContain("gpt-4o");
  });

  it("POST /api/apply writes and returns a fresh spec", async () => {
    const res = await fetch(`${handle.url}/api/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "agent.name": "renamed-agent" }, text: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.spec.meta.agentName).toBe("renamed-agent");
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).agent.name).toBe("renamed-agent");
  });

  it("POST /api/apply rejects invalid config with 422", async () => {
    const res = await fetch(`${handle.url}/api/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "permissions.mode": "nope" }, text: [] }),
    });
    expect(res.status).toBe(422);
  });

  it("POST /api/apply returns 409 when configBaseHash is stale", async () => {
    const baseline = readConfigSource(root, CFG).hash;
    // Mutate the file out from under the request.
    writeFileSync(join(root, CFG), JSON.stringify({ model: { name: "claude-OTHER" } }, null, 2), "utf-8");
    const res = await fetch(`${handle.url}/api/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: { "model.name": "gpt-4o" },
        configBaseHash: baseline,
        text: [],
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.errors[0]?.path).toBe(CFG);
    // Disk state should not have been clobbered.
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("claude-OTHER");
  });

  it("GET /api/text returns content + hash for an editable file", async () => {
    const res = await fetch(`${handle.url}/api/text?path=${encodeURIComponent("prompts/sys.md")}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe("prompts/sys.md");
    expect(body.content).toBe("hello from the server test");
    expect(body.hash).toBe(hashContent("hello from the server test"));
  });

  it("GET /api/text returns 400 for an absolute or escaping path", async () => {
    const r1 = await fetch(`${handle.url}/api/text?path=${encodeURIComponent("/etc/passwd")}`);
    expect(r1.status).toBe(400);
    const r2 = await fetch(`${handle.url}/api/text?path=${encodeURIComponent("../outside.md")}`);
    expect(r2.status).toBe(400);
  });

  it("GET /api/text returns 400 for a denied path", async () => {
    const res = await fetch(`${handle.url}/api/text?path=${encodeURIComponent("src/runtime/foo.ts")}`);
    expect(res.status).toBe(400);
  });

  it("GET /api/text returns 404 when the file does not exist", async () => {
    const res = await fetch(`${handle.url}/api/text?path=${encodeURIComponent("prompts/missing.md")}`);
    expect(res.status).toBe(404);
  });

  it("GET /api/text returns 400 when ?path= is missing", async () => {
    const res = await fetch(`${handle.url}/api/text`);
    expect(res.status).toBe(400);
  });

  it("POST /api/preview normalizes a missing text array (legacy clients)", async () => {
    const res = await fetch(`${handle.url}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "agent.name": "no-text-field" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.validation.ok).toBe(true);
    expect(body.files.length).toBe(1);
  });
});
