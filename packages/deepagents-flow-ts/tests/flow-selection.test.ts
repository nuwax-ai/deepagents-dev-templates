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
      unknownActivePolicy: "warn-default",
    });
  });

  it("resolveFlow falls back to default for unknown names", () => {
    expect(resolveFlow("not-registered").name).toBe("default");
  });
});

describe("flow profiles", () => {
  it("lists registered flows with machine-readable profiles", () => {
    const profiles = listFlowProfiles();
    expect(profiles.find((f) => f.name === "default")?.profile).toMatchObject({
      interaction: "chat",
      implementation: "default",
      defaultForAmbiguous: true,
    });
  });

  it("recommends default first for chat", () => {
    const [first] = recommendFlows("chat");
    expect(first?.name).toBe("default");
  });

  it("marks custom teaching flows as requiring graph reason", () => {
    expect(listFlowProfiles().find((f) => f.name === "router-gate")?.profile).toMatchObject({
      interaction: "pipeline",
      implementation: "custom",
      requiresGraphReason: true,
    });
  });
});
