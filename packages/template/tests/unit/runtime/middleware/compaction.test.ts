import { describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { shouldCompact, findCutPoint, generateSummary } from "../../../../src/runtime/middleware/compaction.js";

/** Build a fake chat model that returns the given content from invoke(). */
function fakeModel(content: string): BaseChatModel {
  return {
    invoke: vi.fn().mockResolvedValue({ content }),
  } as unknown as BaseChatModel;
}

/** Build a fake chat model whose invoke() throws. */
function failingModel(err: Error): BaseChatModel {
  return {
    invoke: vi.fn().mockRejectedValue(err),
  } as unknown as BaseChatModel;
}

describe("compaction", () => {
  describe("shouldCompact", () => {
    it("returns false when disabled", () => {
      expect(shouldCompact(100_000, 200_000, 0.8)).toBe(false);
    });

    it("returns false when under threshold", () => {
      expect(shouldCompact(100_000, 200_000, 0.8)).toBe(false);
    });

    it("returns true when over threshold", () => {
      expect(shouldCompact(170_000, 200_000, 0.8)).toBe(true);
    });

    it("returns true at exact threshold boundary", () => {
      expect(shouldCompact(160_000, 200_000, 0.8)).toBe(true);
    });
  });

  describe("findCutPoint", () => {
    it("returns 0 for empty messages", () => {
      expect(findCutPoint([], 20_000)).toBe(0);
    });

    it("returns 0 when all messages fit in keepRecentTokens", () => {
      const messages = [
        { content: "short" },
        { content: "message" },
      ];
      expect(findCutPoint(messages, 20_000)).toBe(0);
    });

    it("returns a valid cut index for large message lists", () => {
      // Create messages that would exceed keepRecentTokens
      const messages = Array.from({ length: 100 }, (_, i) => ({
        content: "a".repeat(1000),
        role: i % 2 === 0 ? "user" : "assistant",
      }));

      const cutIndex = findCutPoint(messages, 20_000);
      // Should cut somewhere in the middle, not at start or end
      expect(cutIndex).toBeGreaterThan(0);
      expect(cutIndex).toBeLessThan(messages.length);
    });
  });

  describe("generateSummary", () => {
    const sampleMessages = [
      { role: "user", content: "What is the capital of France?" },
      { role: "assistant", content: "Paris." },
      { role: "user", content: "And the population?" },
      { role: "assistant", content: "About 2.1 million in the city proper." },
    ];

    it("returns a placeholder when no summarizer is provided", async () => {
      const result = await generateSummary(sampleMessages, undefined, "claude-sonnet-4-6");
      expect(result).toContain("4 earlier messages compressed");
      expect(result).toContain("Configure a summarizer model");
    });

    it("returns the LLM's content when summarizer succeeds", async () => {
      const model = fakeModel("## Goal\nUser asked about France's capital and population.");
      const result = await generateSummary(sampleMessages, model);
      expect(result).toBe("## Goal\nUser asked about France's capital and population.");
      // Verify the model was called with system + user prompt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoke = (model as any).invoke as ReturnType<typeof vi.fn>;
      expect(invoke).toHaveBeenCalledTimes(1);
      const [prompt] = invoke.mock.calls[0]!;
      expect(prompt).toHaveLength(2);
      expect(prompt[0].role).toBe("system");
      expect(prompt[0].content).toContain("summarizing a conversation history");
      expect(prompt[1].role).toBe("user");
      expect(prompt[1].content).toContain("What is the capital of France?");
      expect(prompt[1].content).toContain("2.1 million");
    });

    it("returns a fallback placeholder when the summarizer throws", async () => {
      const model = failingModel(new Error("rate limit"));
      const result = await generateSummary(sampleMessages, model);
      expect(result).toContain("4 earlier messages compressed");
      expect(result).toContain("rate limit");
    });

    it("returns a fallback placeholder when the summarizer returns empty content", async () => {
      const model = fakeModel("   \n  ");
      const result = await generateSummary(sampleMessages, model);
      expect(result).toContain("4 earlier messages compressed");
      expect(result).toContain("Summarizer call failed");
    });

    it("stringifies BaseMessage-like content arrays (text parts only)", async () => {
      const model = fakeModel("ok");
      const messagesWithBlocks = [
        { role: "user", content: [
          { type: "text", text: "hello" },
          { type: "image_url", image_url: "http://example.com/x.png" },
          { type: "text", text: "world" },
        ] },
      ];
      await generateSummary(messagesWithBlocks, model);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoke = (model as any).invoke as ReturnType<typeof vi.fn>;
      const userContent = invoke.mock.calls[0][0][1].content as string;
      // image block dropped, text blocks joined
      expect(userContent).toContain("hello");
      expect(userContent).toContain("world");
      expect(userContent).not.toContain("image_url");
    });
  });
});
