---
name: refactor
description: "Safe code refactoring patterns with incremental changes and regression prevention"
tags: [refactoring, cleanup, quality]
version: "1.0.0"
---

# Refactoring

## When to Use
When improving code structure, reducing duplication, or extracting reusable patterns.

## Refactoring Principles

### 1. Small Steps
- Make one change at a time
- Verify after each change (compile + test)
- Don't combine refactoring with new features

### 2. Preserve Behavior
- Refactoring should NOT change what the code does
- Run tests before AND after each refactor step
- If tests break, revert and try a different approach

### 3. Common Patterns

#### Extract Function
When a block of code has a clear purpose, extract it:
```typescript
// Before
function processOrder(order: Order) {
  // ... 20 lines of validation ...
  // ... 10 lines of pricing ...
  // ... 15 lines of fulfillment ...
}

// After
function processOrder(order: Order) {
  validateOrder(order);
  calculatePricing(order);
  fulfillOrder(order);
}
```

#### Extract Type
When a type is used in multiple places:
```typescript
// Before — repeated inline types
function createUser(data: { name: string; email: string }) { ... }
function updateUser(id: string, data: { name: string; email: string }) { ... }

// After — shared type
type UserData = { name: string; email: string };
function createUser(data: UserData) { ... }
function updateUser(id: string, data: UserData) { ... }
```

#### Replace Conditional with Map
```typescript
// Before
function getToolCategory(name: string): string {
  if (name === "http_request") return "utility";
  if (name === "platform_api") return "platform";
  if (name === "agent_variable") return "platform";
  return "custom";
}

// After
const TOOL_CATEGORIES: Record<string, string> = {
  http_request: "utility",
  platform_api: "platform",
  agent_variable: "platform",
};
function getToolCategory(name: string): string {
  return TOOL_CATEGORIES[name] ?? "custom";
}
```

## Refactoring Checklist
- [ ] Tests pass before starting
- [ ] Change is small and focused
- [ ] No behavior change
- [ ] Tests pass after each step
- [ ] Code is more readable after the change
- [ ] No new `any` types introduced
