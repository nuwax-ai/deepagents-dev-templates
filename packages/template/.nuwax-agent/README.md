# .nuwax-agent Development Configuration

This directory stores Nuwax-specific development, debug, packaging, and lifecycle metadata for the template agent.

The files here are intentionally separate from `config/`:

- `config/` is runtime application configuration used by the agent server.
- `.nuwax-agent/` is platform-facing configuration used by cloud debug, configuration panels, packaging, installation, upgrade, and uninstall flows.

No real secrets should be committed here. Use placeholders such as `${SECRET_OPENAI_API_KEY}` and let ACP, environment variables, or the installer provide the final value.

## Capability Source Layers

| Layer | Examples | Ownership |
| --- | --- | --- |
| ACP dynamic | System prompt, MCP servers, skills, model selection | Nuwax platform and workspace config |
| Agent builtin | Runtime tools, middleware, prompt loaders, packaging hooks | Template package |
| Environment builtin | API keys, base URLs, install paths, log paths | Cloud computer, local machine, or installer |
| Package placeholder | `${INSTALL_ROOT}`, `${OPENAI_MODEL}`, `${AGENT_ID}` | Build and install pipeline |
| Future durable state | sessions, memory, usage, audit records | Platform and runtime storage |

## Files

- `panel.config.json` describes which configuration fields the platform panel can manage.
- `debug.agent_servers.example.json` mirrors the Zed ACP `agent_servers` shape for local and cloud debug.
- `rcoder.chat.agent_servers.example.json` is the chat-delivered ACP config shape for an installed rcoder cloud-computer package.
- `cloud-debug.profile.json` defines a cloud-computer debug launch profile.
- `capability-sources.json` maps capabilities to ACP, builtin, env, package, or future sources.
- `sandbox-profiles.json` declares local debug and packaged runtime sandbox/environment profiles.
- `agent.spec.example.json` is the canonical output shape for turning user intent into a scenario Agent.
- `placeholders.json` lists package-time and install-time placeholders.
- `package.config.json` declares packaging targets and replacement rules.
- `lifecycle.json` sketches install, upgrade, and uninstall hooks.
