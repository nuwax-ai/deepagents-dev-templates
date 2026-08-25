import { describe, expect, it } from "vitest";
import {
  listFlowProfiles,
  recommendFlows,
  resolveFlow,
  resolveFlowSelection,
} from "../src/app/flows/index.js";

describe("flow selection", () => {
  it("defaults to chat/default when no flow config exists", () => {
    expect(resolveFlowSelection({})).toMatchObject({
      active: "default",
      source: "default",
      defaultInteraction: "chat",
    });
  });

  it("keeps legacy activeFlow compatible", () => {
    expect(resolveFlowSelection({ activeFlow: "legacy-name" })).toMatchObject({
      active: "legacy-name",
      source: "activeFlow",
    });
  });

  it("prefers flow.active over legacy activeFlow", () => {
    expect(
      resolveFlowSelection({
        activeFlow: "legacy-name",
        flow: { active: "default" },
      })
    ).toMatchObject({
      active: "default",
      source: "flow.active",
    });
  });

  it("resolveFlow throws for unknown names (non-ReAct blocked)", () => {
    expect(() => resolveFlow("not-registered")).toThrow(/非 ReAct flow 已屏蔽/);
  });
});

describe("flow profiles", () => {
  it("lists registered flows with machine-readable profiles", () => {
    const profiles = listFlowProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.profile).toMatchObject({
      interaction: "chat",
      implementation: "default",
      defaultForAmbiguous: true,
    });
  });

  it("recommends default first for chat", () => {
    const [first] = recommendFlows("chat");
    expect(first?.name).toBe("default");
  });

  it("marks only default as the ambiguous chat default", () => {
    const ambiguousDefaults = listFlowProfiles().filter((f) => f.profile.defaultForAmbiguous);
    expect(ambiguousDefaults.map((f) => f.name)).toEqual(["default"]);
  });
});
