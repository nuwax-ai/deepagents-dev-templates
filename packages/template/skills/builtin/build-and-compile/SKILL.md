---
name: build-and-compile
description: "Build system patterns, TypeScript compilation, and dependency management"
tags: [build, compile, typescript, npm]
version: "1.0.0"
---

# Build and Compile

## When to Use
When building the project, resolving compilation errors, or managing dependencies.

## Build Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm run typecheck` | Type check without emit |
| `npm run dev` | Development mode (tsx) |
| `npm run clean` | Remove dist/ directory |

## Common Build Errors

### TS2307: Cannot find module
- Check if the dependency is installed: `npm ls <package>`
- Verify the import path is correct (check for .js extension in ESM)
- Run `npm install` if node_modules is missing

### TS2345: Argument not assignable
- Check the expected type in the function signature
- Verify Zod schemas match the expected types
- Check for optional vs required properties

### TS2554: Expected N arguments, got M
- Check the function signature
- Verify all required parameters are passed

## Dependency Management

### Adding a dependency
```bash
npm install <package>          # runtime dependency
npm install -D <package>       # dev dependency
```

### Resolving conflicts
1. Check `npm ls --all` for the dependency tree
2. Look for peer dependency warnings
3. Use `npm install --legacy-peer-deps` as last resort

## ESM Module Rules
- Use `.js` extension in import paths (even for .ts files)
- Use `import`/`export`, not `require`
- package.json must have `"type": "module"`
- Use `import.meta.url` instead of `__dirname`
