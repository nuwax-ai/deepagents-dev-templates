---
name: test-writer
description: "Write comprehensive tests with unit, integration, and edge case coverage"
tags: [testing, vitest, quality]
version: "1.0.0"
---

# Test Writer

## When to Use
When adding tests for new functionality, fixing flaky tests, or improving coverage.

## Test Structure

### File Organization
```
tests/
├── unit/              # Test individual functions/modules
│   ├── config-loader.test.ts
│   ├── platform-client.test.ts
│   └── mcp-manager.test.ts
├── acp-smoke/         # ACP protocol smoke tests
│   └── server.test.ts
└── integration/       # Full flow tests
    └── agent-flow.test.ts
```

### Test Pattern
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ModuleName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("functionName", () => {
    it("should do X when given Y", async () => {
      // Arrange
      const input = { ... };

      // Act
      const result = await functionName(input);

      // Assert
      expect(result).toBe(expected);
    });

    it("should throw when given invalid input", async () => {
      await expect(functionName(null)).rejects.toThrow();
    });
  });
});
```

## Testing Guidelines

### What to Test
- Happy path (normal input → expected output)
- Edge cases (empty input, null, boundary values)
- Error cases (invalid input, network failure, timeout)
- Integration points (mock external calls, verify they're called correctly)

### What NOT to Test
- Implementation details (private methods, internal state)
- Third-party library behavior
- Exact timestamps or random values

### Mocking
```typescript
// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ data: "test" }),
});
vi.stubGlobal("fetch", mockFetch);

// Mock environment variables
process.env.PLATFORM_API_TOKEN = "test-token";

// Mock file system
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue('{"test": true}'),
  existsSync: vi.fn().mockReturnValue(true),
}));
```

## Running Tests
```bash
npm test                    # All tests
npm run test:unit           # Unit tests only
npm run test:watch          # Watch mode
npm test -- --reporter=verbose  # Detailed output
```
