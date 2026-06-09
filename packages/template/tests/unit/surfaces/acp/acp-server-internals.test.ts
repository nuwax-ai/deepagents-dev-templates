import { describe, expect, it } from "vitest";
import {
  DeepAgentsServerInternalsError,
  bindInternalHandler,
  getDeepAgentsServerInternals,
} from "../../../../src/runtime/acp-server-internals.js";

describe("acp-server-internals", () => {
  it("accepts the internal maps required by the lifecycle adapter", () => {
    const server = {
      sessions: new Map(),
      agentConfigs: new Map(),
      agents: new Map(),
      acpBackends: new Map(),
    };

    const internals = getDeepAgentsServerInternals(server, [
      "sessions",
      "agent-configs",
      "agents",
      "acp-backends",
    ]);

    expect(internals.sessions).toBe(server.sessions);
    expect(internals.agentConfigs).toBe(server.agentConfigs);
    expect(internals.agents).toBe(server.agents);
    expect(internals.acpBackends).toBe(server.acpBackends);
  });

  it("fails early when upstream internals are missing", () => {
    expect(() =>
      getDeepAgentsServerInternals({ sessions: new Map() }, ["sessions", "agent-configs"])
    ).toThrow(DeepAgentsServerInternalsError);
  });

  it("binds optional internal handlers to the server object", async () => {
    const server = {
      value: "bound",
      async handler(this: { value: string }) {
        return this.value;
      },
    };

    const handler = bindInternalHandler(server, server.handler);

    await expect(handler?.()).resolves.toBe("bound");
  });
});

