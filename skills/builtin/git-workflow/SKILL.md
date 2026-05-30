---
name: git-workflow
description: "Git best practices for commits, branching, conflict resolution, and safety rules"
tags: [git, version-control, workflow]
version: "1.0.0"
---

# Git Workflow

## When to Use
When committing changes, creating branches, or resolving merge conflicts.

## Commit Message Format
```
<type>: <short description>

[optional body — explain WHY, not WHAT]
```

### Types
| Type | Use For |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation changes |
| `test` | Adding or updating tests |
| `chore` | Build, config, or tooling changes |

### Examples
```
feat: add platform API client for Nuwax integration

Implements savePrompt, queryPlugins, and variable management
methods to enable direct platform interaction from the agent.
```

```
fix: resolve MCP config merge priority for session overrides

Session-level MCP configs now correctly override platform
configs when using session-wins merge strategy.
```

## Branch Workflow
1. Always branch from the latest main
2. Use descriptive branch names: `feat/platform-api-client`
3. Keep branches focused on one feature/fix
4. Rebase onto main before merging (avoid merge commits)

## Safety Rules
- ❌ Never force-push to main
- ❌ Never commit secrets (API keys, tokens, passwords)
- ❌ Never commit node_modules or dist/
- ✅ Always check `git diff` before committing
- ✅ Always verify .gitignore covers sensitive files
- ✅ Run tests before committing

## Conflict Resolution
1. `git fetch origin` to get latest
2. `git rebase origin/main` to replay your changes
3. Resolve conflicts in each file
4. `git add <resolved-file>` and `git rebase --continue`
5. If stuck: `git rebase --abort` to start over
