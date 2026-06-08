# Rcoder Cloud Debug

This document records the rcoder cloud-computer path for testing the packaged
agent in a real ACP client environment.

## Package

For rcoder, use the Nuwax tar/zip artifacts because they bundle production
`node_modules` and can start without running `npm install` on the cloud
computer.

```bash
bash scripts/package.sh --format all
bash scripts/validate-package.sh --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip --require-node-modules
```

Expected artifact set:

```text
dist-packages/deepagents-dev-templates-<version>-nuwax.tar.gz
dist-packages/deepagents-dev-templates-<version>-nuwax.zip
dist-packages/deepagents-dev-templates-<version>.version.json
dist-packages/deepagents-dev-templates-<version>.platform.json
dist-packages/package-checksums.json
```

## Install

```bash
bash scripts/install.sh \
  --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip \
  --install-root /opt/nuwax/deepagents-template \
  --force
```

When the artifact contains `node_modules`, the installer prints:

```text
Using bundled node_modules; skipping npm install.
```

## Chat-Delivered ACP Config

The chat side should send an `agent_servers` payload equivalent to Zed's ACP
configuration. Use absolute paths after installation and keep OpenAI-compatible
settings as the default model path.

```json
{
  "agent_servers": {
    "deepagents-template": {
      "type": "custom",
      "command": "node",
      "args": [
        "/opt/nuwax/deepagents-template/dist/index.js",
        "--config",
        "/opt/nuwax/deepagents-template/config/app-agent.config.json"
      ],
      "env": {
        "LLM_PROVIDER": "openai",
        "OPENAI_MODEL": "mimo-v2.5-pro",
        "OPENAI_BASE_URL": "https://your-openai-compatible-endpoint/v1",
        "OPENAI_API_KEY": "${SECRET_OPENAI_API_KEY}",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "/opt/nuwax/deepagents-template/logs",
        "DEEPAGENTS_SANDBOX_PROFILE": "workspace-write"
      }
    }
  }
}
```

Template form lives at:

```text
.nuwax-agent/rcoder.chat.agent_servers.example.json
```

Rules:

- Do not send both OpenAI and Anthropic credentials in the same payload.
- Use `LLM_PROVIDER=openai`; `openai-compatible` is a description, not a valid runtime provider value.
- Use installed `dist/index.js` for packaged rcoder runs, not `tsx src/index.ts`.
- Keep API keys in secret placeholders or cloud environment variables, never in repo files.
