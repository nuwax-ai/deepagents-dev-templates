---
name: code-review
description: "5-category code review checklist for correctness, security, performance, style, and testing"
tags: [review, quality, checklist]
version: "1.0.0"
---

# Code Review

## When to Use
After implementing changes, before committing, or when reviewing generated code.

## Review Categories

### 1. Correctness
- Does the code do what it's supposed to?
- Are edge cases handled?
- Is error handling comprehensive?
- Are types correct and specific (avoid `any`)?
- Do async operations properly await?

### 2. Security
- No hardcoded secrets or API keys
- Input validation on all external data
- No SQL injection or XSS vulnerabilities
- File paths are validated against allowed zones
- API tokens are read from variables, not code

### 3. Performance
- No unnecessary loops or repeated operations
- Large data sets use streaming/pagination
- Network calls have timeouts
- No blocking operations in async context
- Parallel execution where independent

### 4. Style & Maintainability
- Follows project conventions (ESM, naming, structure)
- Functions have clear, single responsibility
- Comments explain WHY, not WHAT
- No dead code or commented-out blocks
- Imports are organized (node → deps → local)

### 5. Testing
- New functionality has corresponding tests
- Edge cases are tested
- Tests are deterministic (no random, no timing-dependent)
- Test names describe the behavior being tested

## Severity Levels
| Level | Meaning | Action |
|-------|---------|--------|
| 🔴 Critical | Security vulnerability or data loss risk | Must fix immediately |
| 🟠 High | Incorrect behavior or crash potential | Fix before merge |
| 🟡 Medium | Code quality or maintainability issue | Fix when possible |
| 🔵 Low | Style or minor improvement | Optional |

## Output Format
```
## Code Review Results
### 🔴 Critical
- [file:line] Issue description → Fix suggestion

### 🟠 High
- [file:line] Issue description → Fix suggestion

### Summary
- X issues found (Y critical, Z high)
- Overall: PASS / NEEDS CHANGES / FAIL
```
