/**
 * Unit tests for variable-manager
 * Verifies env var priority, empty string preservation, and cache behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VariableManager } from "../../../src/runtime/platform/variable-manager.js";
import { PlatformClient } from "../../../src/runtime/platform/platform-client.js";

describe("VariableManager", () => {
  const originalEnv = { ...process.env };
  let mockPlatformClient: PlatformClient;

  beforeEach(() => {
    // Clear all AGENT_VAR_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AGENT_VAR_")) {
        delete process.env[key];
      }
    }
    // Create a mock platform client (not actually connected)
    mockPlatformClient = new PlatformClient({
      apiBaseUrl: "https://test.example.com",
      agentId: "test-agent",
      spaceId: "test-space",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("env var priority", () => {
    it("returns env var value when set", async () => {
      process.env.AGENT_VAR_API_KEY = "from-env";
      const vm = new VariableManager({ platformClient: mockPlatformClient });
      const value = await vm.get("API_KEY");
      expect(value).toBe("from-env");
    });

    it("preserves empty string from env var (does not treat as undefined)", async () => {
      process.env.AGENT_VAR_EMPTY = "";
      const vm = new VariableManager({ platformClient: mockPlatformClient });
      const value = await vm.get("EMPTY");
      expect(value).toBe("");
    });

    it("falls through to platform when env var is not set", async () => {
      // Mock the platform client's getVariable method
      vi.spyOn(mockPlatformClient, "getVariable").mockResolvedValue({
        id: "var-1",
        name: "PLATFORM_VAR",
        value: "from-platform",
        type: "string",
        required: false,
        description: "",
      });

      const vm = new VariableManager({ platformClient: mockPlatformClient });
      const value = await vm.get("PLATFORM_VAR");
      expect(value).toBe("from-platform");
    });

    it("returns undefined when nothing is set", async () => {
      vi.spyOn(mockPlatformClient, "getVariable").mockResolvedValue(null);
      const vm = new VariableManager({ platformClient: mockPlatformClient });
      const value = await vm.get("UNKNOWN");
      expect(value).toBeUndefined();
    });
  });

  describe("empty string preservation", () => {
    it("checkRequired does not report env-set empty string as missing", async () => {
      process.env.AGENT_VAR_API_KEY = "";
      const vm = new VariableManager({ platformClient: mockPlatformClient });
      vi.spyOn(mockPlatformClient, "listVariables").mockResolvedValue([]);

      const result = await vm.checkRequired();
      expect(result.allPresent).toBe(true);
      expect(result.missing).not.toContain("API_KEY");
    });

    it("toEnvMap includes env-set empty strings", async () => {
      process.env.AGENT_VAR_KEY = "";
      const vm = new VariableManager({ platformClient: mockPlatformClient });
      vi.spyOn(mockPlatformClient, "listVariables").mockResolvedValue([]);

      const envMap = await vm.toEnvMap();
      expect(envMap).toHaveProperty("AGENT_VAR_KEY", "");
    });
  });

  describe("local-only mode (no platform)", () => {
    it("works without a platform client", async () => {
      const vm = new VariableManager({ platformClient: null });
      const value = await vm.get("ANY_VAR");
      expect(value).toBeUndefined();
    });

    it("returns env var values without platform", async () => {
      process.env.AGENT_VAR_LOCAL = "local-value";
      const vm = new VariableManager({ platformClient: null });
      const value = await vm.get("LOCAL");
      expect(value).toBe("local-value");
    });

    it("set() creates local entries when no platform", async () => {
      const vm = new VariableManager({ platformClient: null });
      await vm.set("NEW_VAR", "new-value");

      // Should not throw and should populate local cache
      const value = await vm.get("NEW_VAR");
      expect(value).toBe("new-value");
    });
  });

  describe("env key generation", () => {
    it("normalizes names with non-alphanumeric chars to underscores", async () => {
      process.env.AGENT_VAR_MY_API_KEY = "value-1";
      const vm = new VariableManager({ platformClient: null });
      const value = await vm.get("my-api-key");
      expect(value).toBe("value-1");
    });

    it("uppercases names", async () => {
      process.env.AGENT_VAR_API_KEY = "value-2";
      const vm = new VariableManager({ platformClient: null });
      const value = await vm.get("api_key");
      expect(value).toBe("value-2");
    });
  });
});
