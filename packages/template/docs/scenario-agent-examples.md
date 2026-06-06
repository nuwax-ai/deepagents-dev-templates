# Scenario Agent Examples

This document shows how the template should turn user prompts into concrete Agent Specs, capability-source maps, prompts, variables, and acceptance checks.

Use these examples with:

- `.nuwax-agent/agent.spec.example.json`
- `skills/builtin/agent-requirement-to-spec/SKILL.md`
- `prompts/target-agent.base.md`
- `docs/scenario-agent-template-design.md`

## Shared Generation Pattern

1. Parse the user's natural-language request into intent, users, tasks, inputs, outputs, and boundaries.
2. Ask only architecture-changing clarification questions.
3. Query platform capabilities before writing custom tools.
4. Classify each capability as ACP dynamic, agent builtin, environment builtin, package placeholder, or future durable state.
5. Draft the target prompt from `prompts/target-agent.base.md`.
6. Create secret variables for credentials.
7. Define acceptance scenarios.
8. Implement only the missing pieces.

## Example 1: Customer Support Triage

User prompt:

```text
做一个客服 Agent，能看工单、判断优先级、追问缺失信息，并给出回复草稿。
```

Agent Spec summary:

- Name: Customer Support Triage Agent
- Users: support operator, support lead
- Core tasks: read ticket, classify category and urgency, find missing facts, draft reply, recommend escalation
- Inputs: ticket payload, customer history, policy snippets
- Outputs: triage summary, missing-info questions, reply draft

Capability source map:

| Capability | Source |
| --- | --- |
| system prompt | ACP dynamic |
| ticket MCP server | ACP dynamic |
| policy MCP or knowledge skill | ACP dynamic |
| reply style prompt | ACP dynamic |
| API token | agent variable / env builtin |
| HTTP fallback | agent builtin |

Prompt optimization:

- Add a strict rule: never promise refunds or credits without policy evidence.
- Keep customer-facing draft separate from internal triage notes.
- Ask for missing order ID before making order-specific claims.

Acceptance scenarios:

- Missing order ID produces a short clarification question.
- Payment failure is marked high priority with escalation advice.
- No ticket tool available produces a capability-missing report, not fabricated data.

## Example 2: Sales CRM Follow-Up

User prompt:

```text
帮我做一个销售助理，读取 CRM 线索，判断跟进优先级，生成下一步行动和邮件。
```

Agent Spec summary:

- Name: CRM Follow-Up Agent
- Users: sales representative, sales manager
- Core tasks: read lead profile, detect buying intent, prioritize follow-up, draft email, update next action
- Inputs: CRM lead, interaction history, sales playbook
- Outputs: priority score, next action, email draft, CRM update payload

Capability source map:

| Capability | Source |
| --- | --- |
| CRM MCP | ACP dynamic |
| sales playbook | ACP dynamic |
| email style skill | ACP dynamic |
| CRM API credentials | agent variable |
| scheduling integration | ACP dynamic or planned |
| install metadata | package placeholder |

Prompt optimization:

- Require evidence for each priority score.
- Separate "suggested CRM update" from actual tool execution.
- Do not send email unless the user explicitly confirms.

Acceptance scenarios:

- Hot lead with recent pricing question gets high priority.
- Lead with no recent activity gets a reactivation suggestion.
- Missing CRM write permission results in a draft-only output.

## Example 3: Data Analysis Copilot

User prompt:

```text
做一个数据分析 Agent，可以读表格，解释指标变化，生成图表建议和结论。
```

Agent Spec summary:

- Name: Metrics Analysis Agent
- Users: operations analyst, business owner
- Core tasks: inspect schema, validate data quality, analyze trend, explain deltas, propose charts
- Inputs: CSV, spreadsheet, database query result, metric definitions
- Outputs: metric summary, anomaly list, chart plan, recommended next questions

Capability source map:

| Capability | Source |
| --- | --- |
| spreadsheet or database MCP | ACP dynamic |
| metric definitions | ACP dynamic |
| local file parsing | agent builtin |
| chart rendering | planned or custom code |
| model config | env builtin / ACP dynamic |

Prompt optimization:

- Always distinguish observed data from inferred causes.
- Include data quality warnings before conclusions.
- Prefer reproducible calculations over narrative-only analysis.

Acceptance scenarios:

- Null-heavy columns are flagged before trend analysis.
- Week-over-week drop includes the exact compared dates.
- Missing metric definition triggers a clarification question.

## Example 4: Document QA Agent

User prompt:

```text
做一个文档问答 Agent，基于公司知识库回答问题，要给出处并说明不确定性。
```

Agent Spec summary:

- Name: Knowledge Base QA Agent
- Users: internal employees, support team
- Core tasks: retrieve relevant docs, cite evidence, answer with uncertainty, suggest follow-up docs
- Inputs: user question, retrieved passages, access policy
- Outputs: answer, citations, confidence note, unresolved gaps

Capability source map:

| Capability | Source |
| --- | --- |
| knowledge MCP | ACP dynamic |
| access policy | ACP dynamic |
| citation formatter | agent builtin or skill |
| memory | future durable state |
| secrets | agent variable |

Prompt optimization:

- Do not answer from memory when retrieval is required.
- Include citation IDs or links for factual claims.
- Say "未找到依据" when retrieval is empty.

Acceptance scenarios:

- Retrieval returns no documents, so the Agent refuses to invent.
- Conflicting documents are surfaced as conflict.
- User asks for restricted content, so the Agent explains access limitation.

## Example 5: Code Maintenance Agent

User prompt:

```text
做一个代码维护 Agent，能读项目、修 bug、跑测试、写变更总结。
```

Agent Spec summary:

- Name: Code Maintenance Agent
- Users: developers, maintainers
- Core tasks: inspect repository, diagnose bug, edit scoped files, run tests, report changes
- Inputs: bug report, codebase, test output
- Outputs: patch, verification log, risk summary

Capability source map:

| Capability | Source |
| --- | --- |
| filesystem and shell | agent builtin |
| repository rules | ACP dynamic |
| code review skill | agent builtin |
| issue tracker MCP | ACP dynamic |
| package lifecycle config | package placeholder |

Prompt optimization:

- Read relevant files before editing.
- Never revert unrelated user changes.
- Report failed tests honestly.

Acceptance scenarios:

- Dirty worktree exists, so unrelated files remain untouched.
- Test fails before fix and passes after fix.
- Missing dependency is installed or clearly reported.

## Example 6: Operations Automation Agent

User prompt:

```text
做一个运维 Agent，监控服务状态，发现异常后生成排查步骤并可执行安全命令。
```

Agent Spec summary:

- Name: Ops Diagnostic Agent
- Users: SRE, platform engineer
- Core tasks: check health, inspect logs, classify incident, run read-only diagnostics, propose remediation
- Inputs: service name, environment, logs, metrics
- Outputs: incident summary, diagnostic evidence, next actions, command log

Capability source map:

| Capability | Source |
| --- | --- |
| monitoring MCP | ACP dynamic |
| log access | ACP dynamic |
| shell diagnostics | agent builtin |
| destructive action approval | ACP dynamic policy |
| audit log | future durable state |

Prompt optimization:

- Default to read-only diagnostics.
- Require explicit approval for restart, delete, migration, or traffic changes.
- Include exact timestamps and affected service names.

Acceptance scenarios:

- Health endpoint fails, so the Agent checks logs before proposing restart.
- Destructive command is requested, so the Agent asks for approval.
- Monitoring MCP is unavailable, so the Agent reports the missing capability.

