# Scenario Agent Template Design

This document describes how the template should help an AI development agent
turn a user's natural language request into a scenario-specific Agent with
clear capabilities, prompts, skills, tools, variables, and platform bindings.

## Goal

The template should support this workflow:

```text
User request -> Agent Spec -> capability source mapping -> prompt/skills/tools -> validation -> package
```

The development agent should not start by writing custom code. It should first
understand the requested scenario, discover platform capabilities, decide which
capabilities are dynamic versus builtin, and only then create or modify files in
the editable zones.

## Requirement To Spec Workflow

For every scenario-agent request, the development agent should:

1. Parse the user's prompt for domain, users, tasks, inputs, outputs, external systems, and risks.
2. Ask at most three clarifying questions only when missing information changes the implementation materially.
3. Generate an Agent Spec.
4. Search Nuwax platform plugins/MCP/workflows before writing custom tools.
5. Map each capability to its source: ACP dynamic, agent builtin, env builtin, package placeholder, or future.
6. Generate or update target prompt, skills, variables, and app tools.
7. Run typecheck, tests, build, and graph.
8. Report what the user must configure in the panel.

## Agent Spec Format

The `agent-requirement-to-spec` skill should produce this shape:

```markdown
# Agent Spec

## Goal
## Target Users
## Core Tasks
## Inputs
## Outputs
## Tool Requirements
## Platform Capability Plan
## Variable Requirements
## Skills Requirements
## Prompt Structure
## Acceptance Scenarios
## Risks And Boundaries
```

## `.nuwax-agent` Directory

The `.nuwax-agent/` directory is the development configuration boundary between
the template project, the Nuwax configuration panel, cloud computer debugging,
and package installation.

```text
.nuwax-agent/
  README.md
  panel.config.json
  debug.agent_servers.example.json
  rcoder.chat.agent_servers.example.json
  cloud-debug.profile.json
  capability-sources.json
  agent.spec.example.json
  placeholders.json
  package.config.json
  lifecycle.json
```

### File Responsibilities

| File | Purpose |
|---|---|
| `README.md` | Explains that this is development configuration, not runtime core logic. |
| `panel.config.json` | Stores configuration-panel state such as prompt draft, model choice, selected MCP servers, selected skills, and publish state. |
| `debug.agent_servers.example.json` | Zed-compatible `agent_servers` example using absolute path placeholders. |
| `rcoder.chat.agent_servers.example.json` | Chat-delivered ACP `agent_servers` example for an installed rcoder cloud-computer package. |
| `cloud-debug.profile.json` | Cloud computer debug profile with command, args, env placeholders, logs path, and workspace root. |
| `capability-sources.json` | Declares whether each capability comes from ACP dynamic config, agent builtin, env builtin, package placeholder, or future work. |
| `sandbox-profiles.json` | Declares local debug and packaged runtime sandbox/environment profiles. |
| `agent.spec.example.json` | Example structured Agent Spec generated from a user request. |
| `placeholders.json` | Placeholder catalog for install/package-time values. |
| `package.config.json` | Packaging include/exclude and install replacement rules. |
| `lifecycle.json` | Install, upgrade, uninstall lifecycle declaration. |

## Capability Source Layers

| Source | Meaning | Examples |
|---|---|---|
| `acp-dynamic` | Delivered by configuration panel or ACP startup/session config. | `systemPrompt`, `mcpServers`, skills, model, `agentId`, `spaceId`. |
| `agent-builtin` | Built into the template package. | App tools, middleware, runtime storage, default skills, code graph. |
| `env-builtin` | Injected by runtime environment. | `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MAX_TOKENS`, `LOG_LEVEL`, `LOG_DIR`. |
| `package-placeholder` | Replaced by package/install tooling. | `INSTALL_ROOT`, `WORKSPACE_ROOT`, checksum, package version. |
| `future` | Designed now and implemented later. | ACP auth/logout, durable session DB, sandbox profile, harness lifecycle. |

Rules:

- System prompt, MCP servers, skills, and model selection are dynamic by default.
- Built-in tools and middleware stay in the agent package.
- Secrets and base URLs are environment-injected placeholders.
- Package/install metadata stays as placeholders until packaging or installation.
- Future capabilities are declared, but must not affect current runtime behavior.

## OpenAI-Compatible Debug Profile

OpenAI-compatible is the default development and cloud-debug profile.

```json
{
  "agent_servers": {
    "deepagents-template": {
      "type": "custom",
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "${TEMPLATE_ROOT}/src/index.ts",
        "--config",
        "${TEMPLATE_ROOT}/config/app-agent.config.json"
      ],
      "env": {
        "LLM_PROVIDER": "openai",
        "OPENAI_MODEL": "${OPENAI_MODEL}",
        "OPENAI_BASE_URL": "${OPENAI_BASE_URL}",
        "OPENAI_API_KEY": "${SECRET_OPENAI_API_KEY}",
        "MAX_TOKENS": "${MAX_TOKENS}",
        "LOG_LEVEL": "${LOG_LEVEL}",
        "LOG_DIR": "${LOG_DIR}"
      }
    }
  }
}
```

Rules:

- Example files must never contain real API keys.
- OpenAI profiles set only `OPENAI_*` model credentials.
- Anthropic-compatible profiles, if present, should live in separate example files and set only `ANTHROPIC_*` credentials.
- The platform should avoid injecting OpenAI and Anthropic credentials at the same time.

## Example Scenarios

Detailed examples live in [Scenario Agent Examples](./scenario-agent-examples.md).

| Scenario | User Request Example | Generated Capabilities |
|---|---|---|
| Customer support Agent | "Build an Agent that checks orders, explains refund policy, and creates support tickets when needed." | FAQ/RAG, order API, ticket workflow, response templates. |
| Sales CRM Agent | "Build an Agent that follows up leads, summarizes customer status, and recommends next actions." | CRM plugin, email/calendar MCP, customer summary skill. |
| Data analysis Agent | "Build an Agent that analyzes uploaded CSVs, creates reports, and flags anomalies." | File reading, data parsing, report output, anomaly rules. |
| Documentation QA Agent | "Build an Agent that answers from company docs and cites sources." | Knowledge-base/RAG MCP, citation format, refusal boundaries. |
| Code maintenance Agent | "Build an Agent that fixes bugs, writes tests, and drafts PR summaries." | Code search, test execution, git workflow, code-review skill. |
| Ops automation Agent | "Build an Agent that checks metrics every day and notifies Slack on anomalies." | Data API, Slack MCP, threshold variables, notification workflow. |

Each scenario example should include:

- Original user request.
- Clarifying questions.
- Agent Spec summary.
- Capability source mapping.
- Required variables.
- Skills to reuse or create.
- Target prompt snippet.
- Acceptance scenarios.

## Template Optimization Targets

- `prompts/developer-agent.system.md` should explicitly require spec-first development.
- `prompts/target-agent.base.md` should include mission, boundaries, tool strategy, variable requirements, failure handling, output format, and acceptance criteria.
- `skills/builtin/agent-requirement-to-spec/SKILL.md` owns the natural-language-to-spec workflow.
- `docs/scenario-agent-examples.md` stores concrete prompt-to-Agent examples.

## Acceptance

- Scenario Agent requests produce an Agent Spec before code changes.
- Capability source mapping is explicit.
- Platform tools are checked before custom code.
- Secrets are represented only as variables or placeholders.
- Generated prompts remain ACP/platform-managed.
