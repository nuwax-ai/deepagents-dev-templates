---
name: systematic-debugging
description: "5-step systematic approach to diagnosing and fixing errors"
tags: [debugging, errors, troubleshooting]
version: "1.0.0"
---

# Systematic Debugging

## When to Use
When encountering any unexpected error, failure, or behavior that doesn't match expectations.

## The 5-Step Debug Loop

### Step 1: REPRODUCE
- Run the exact command/action that failed
- Capture the full error message and stack trace
- Note the environment (OS, node version, dependencies)
- Confirm it's reproducible (not a flaky issue)

### Step 2: ISOLATE
- Identify the smallest unit that reproduces the error
- Check recent changes that might have introduced the bug
- Strip away unrelated code to create a minimal reproduction
- Determine: is this a config issue, code issue, or dependency issue?

### Step 3: DIAGNOSE
- Read the error message carefully — most errors tell you exactly what's wrong
- Check the error type:
  - `TypeError` → wrong type or undefined value
  - `ReferenceError` → missing import or variable
  - `SyntaxError` → malformed code
  - `ENOENT` → file not found
  - `ECONNREFUSED` → network/connection issue
  - `MODULE_NOT_FOUND` → missing dependency
- Add logging at key points if the error is unclear
- Check if it's a known issue (search docs, GitHub issues)

### Step 4: FIX
- Apply the smallest fix that addresses the root cause (not the symptom)
- Prefer fixing the source over adding error handling
- If fixing reveals a deeper issue, go back to Step 2
- Document what changed and why

### Step 5: VERIFY
- Re-run the original failing command
- Run related tests to check for regressions
- Verify the fix works in the actual environment (not just locally)
- Confirm no new errors were introduced

## Common Failure Patterns

| Pattern | Likely Cause | Quick Check |
|---------|-------------|-------------|
| Works locally, fails in CI | Environment difference | Compare env vars, node version |
| Intermittent failure | Race condition or timing | Add retry or proper awaits |
| Sudden failure after update | Breaking change in dependency | Check changelog |
| Permission denied | Path in protected zone | Check template.manifest.json |
| Module not found | Missing npm install | Run `npm install` |

## Anti-patterns
- ❌ Changing things randomly hoping it fixes the issue
- ❌ Ignoring the error message
- ❌ Adding try/catch without understanding the error
- ❌ Declaring "done" when tests still fail
