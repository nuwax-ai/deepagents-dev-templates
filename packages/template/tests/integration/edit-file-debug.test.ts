import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("edit_file tool debug", () => {
  it("should replace content in a file", () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "edit-test-"));
    const testFile = resolve(tmpDir, "test.txt");

    // Create file
    writeFileSync(testFile, "original content\nline 2\nline 3", "utf-8");

    // Simulate edit_file behavior
    const content = readFileSync(testFile, "utf-8");
    const oldString = "original content";
    const newString = "edited content";

    if (content.includes(oldString)) {
      const newContent = content.replace(oldString, newString);
      writeFileSync(testFile, newContent, "utf-8");
    }

    const result = readFileSync(testFile, "utf-8");
    expect(result).toContain("edited content");

    // Cleanup
    unlinkSync(testFile);
  });

  it("should handle exact match with newlines", () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "edit-test-"));
    const testFile = resolve(tmpDir, "test.txt");

    writeFileSync(testFile, "original content\nline 2\nline 3", "utf-8");

    const content = readFileSync(testFile, "utf-8");
    // Test with exact line including newline
    const oldString = "original content\n";
    const newString = "edited content\n";

    const newContent = content.replace(oldString, newString);
    writeFileSync(testFile, newContent, "utf-8");

    const result = readFileSync(testFile, "utf-8");
    expect(result).toBe("edited content\nline 2\nline 3");

    unlinkSync(testFile);
  });
});
