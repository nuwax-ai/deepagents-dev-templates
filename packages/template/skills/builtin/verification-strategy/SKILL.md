---
name: verification-strategy
description: "How to verify changes work correctly before declaring completion"
tags: [testing, verification, quality]
version: "1.0.0"
---

# Verification Strategy

## When to Use
After making any change — verify it works before moving on or declaring the task complete.

## Verification Levels

### Level 1: Syntax Check
- Code compiles without errors (`npm run typecheck`)
- No linting errors (`npm run lint`)
- JSON/YAML files are valid

### Level 2: Unit Tests
- Run relevant unit tests (`npm run test:unit`)
- All tests pass
- No new test failures introduced

### Level 3: Integration Tests
- Run integration tests (`npm run test:integration`)
- Test the full flow from input to output
- Verify external integrations (MCP, platform API)

### Level 4: ACP Smoke Test
- Start the ACP server (`npm run start:acp`)
- Send a test prompt via ACP protocol
- Verify response format and content
- Check tool calls were made correctly

### Level 5: End-to-End
- Full platform debug session
- Test with real platform configuration
- Verify variable resolution
- Check logging output

## Verification Checklist
- [ ] Code compiles and type-checks
- [ ] Existing tests still pass
- [ ] New functionality works as expected
- [ ] Error cases are handled gracefully
- [ ] No secrets or sensitive data in code
- [ ] Documentation updated if needed

## Anti-patterns
- ❌ "It compiles, so it works" — compilation ≠ correctness
- ❌ Skipping tests "because I'm confident"
- ❌ Only testing the happy path
- ❌ Declaring done before running verification
