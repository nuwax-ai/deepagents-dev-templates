---
name: agent-requirement-to-spec
description: Turn a user's natural-language agent request into a concrete Agent Spec, capability-source map, prompt outline, and implementation plan.
tags:
  - agent-design
  - requirements
  - nuwax
version: 0.1.0
---

# Agent Requirement To Spec

Use this skill when the user asks to create, customize, or optimize a scenario-specific Agent from a natural-language prompt.

The goal is not to jump directly into code. First convert the request into a concrete Agent Spec that the platform, prompt generator, MCP configuration, skills, variables, and packaging flow can all understand.

## Required Output

Produce an Agent Spec with these sections:

1. `agent`: name, slug, summary, owner or workspace.
2. `sourceRequest`: original prompt, assumptions, clarifying questions.
3. `targetUsers`: expected users or roles.
4. `coreTasks`: the jobs the Agent must complete.
5. `inputs`: required and optional data.
6. `outputs`: expected response artifacts and formats.
7. `capabilityPlan`: capability to source mapping.
8. `variables`: required plain or secret variables.
9. `skills`: builtin or platform skills to attach.
10. `promptStructure`: target prompt sections.
11. `acceptanceScenarios`: concrete pass/fail behavior examples.
12. `risksAndBoundaries`: what the Agent must not do.

Use `.nuwax-agent/agent.spec.example.json` as the shape reference.

## Process

1. Restate the Agent's intended job in one sentence.
2. Identify missing facts that change architecture, not minor copy details.
3. Query platform capabilities first when tools are available:
   - MCP plugins and tool servers
   - available platform skills
   - prompt and variable APIs
4. Classify every required capability:
   - `acp-dynamic`: system prompt, MCP servers, skills, workspace rules, model choice.
   - `agent-builtin`: shipped runtime tools, middleware, prompt fragments, local templates.
   - `env-builtin`: API keys, base URLs, log paths, cloud-computer paths.
   - `package-placeholder`: install root, package version, platform IDs.
   - `future-durable-state`: memory, sessions, audit logs, long-term usage records.
5. Draft the target prompt from `prompts/target-agent.base.md`.
6. Create secret variables instead of writing secret literals.
7. Define acceptance scenarios before implementation.
8. Only then modify code, skills, prompts, or configuration.

## Capability Source Rules

- System prompts should be ACP dynamic and saved through `platform_api.save_prompt`.
- MCP servers should be ACP dynamic unless a server is truly bundled in the package.
- User-specific credentials belong in `agent_variable` or environment variables.
- Debug launch paths belong in `.nuwax-agent/debug.agent_servers.example.json`.
- Package-time substitutions belong in `.nuwax-agent/placeholders.json` and `.nuwax-agent/package.config.json`.
- Builtin tools should be treated as stable package capability, not panel-editable user configuration.

## Anti-Patterns

- Do not hardcode a user's API key into code, prompt, docs, or sample JSON.
- Do not invent MCP capabilities when the platform query fails; mark them as required or planned.
- Do not generate an Agent prompt without acceptance scenarios.
- Do not treat package installation paths as ACP dynamic workspace settings.
- Do not change protected runtime code just to satisfy a scenario-specific request.

## Minimal Spec Example

```json
{
  "agent": {
    "name": "Research Brief Agent",
    "slug": "research-brief-agent",
    "summary": "Collects sources, extracts evidence, and writes concise briefs."
  },
  "coreTasks": [
    "Search approved sources",
    "Extract facts with citations",
    "Write a brief with risks and open questions"
  ],
  "capabilityPlan": {
    "systemPrompt": "acp-dynamic",
    "searchMcp": "acp-dynamic",
    "sourceRules": "acp-dynamic",
    "apiKey": "env-builtin",
    "httpFallback": "agent-builtin"
  },
  "acceptanceScenarios": [
    "If no source is available, the Agent reports that limitation.",
    "If sources disagree, the Agent marks the conflict instead of choosing silently."
  ]
}
```

