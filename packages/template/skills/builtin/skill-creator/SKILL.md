---
name: skill-creator
description: "Meta-skill: how to create new skills with SKILL.md format and directory structure"
tags: [meta, skills, creation]
version: "1.0.0"
---

# Skill Creator

## When to Use
When you need to create a new skill for the agent to use.

## Skill Structure

### Directory Layout
```
skills/
├── builtin/                    # General development skills
│   └── my-skill/
│       ├── SKILL.md            # Required — skill definition
│       ├── resources/          # Optional — reference docs, templates
│       │   └── reference.md
│       └── scripts/            # Optional — executable scripts
│           └── helper.sh
└── platform/                   # Platform-specific skills
    └── my-platform-skill/
        └── SKILL.md
```

### SKILL.md Format
```markdown
---
name: my-skill-name
description: "One-line description of what the skill does"
tags: [tag1, tag2]
version: "1.0.0"
---

# My Skill Name

## When to Use
Describe when this skill should be activated.

## Steps / Instructions
1. Step one
2. Step two
3. ...

## Anti-patterns
- ❌ What NOT to do
- ✅ What TO do
```

## Naming Rules
- Use lowercase with hyphens: `my-skill-name`
- Max 64 characters
- Pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`
- Avoid reserved names: `anthropic`, `claude`

## Description Rules
- One clear sentence
- Max 1024 characters
- Should answer: "When would I need this?"

## Content Guidelines
- Be actionable — give concrete steps, not abstract advice
- Include examples where possible
- Document common mistakes (anti-patterns)
- Keep instructions under 500 lines

## Progressive Loading
Skills are loaded progressively — the agent first sees only the name and description. Full content is loaded only when `load_skill` is called. This keeps the system prompt small.

Make your description compelling enough that the agent knows when to load the full skill!
