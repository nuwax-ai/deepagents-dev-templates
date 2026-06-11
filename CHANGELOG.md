# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- CI workflow references `packages/template` → `packages/deepagents-app-ts`
- Unified package manager to pnpm (added pnpm-lock.yaml, updated CI)

### Added
- `scripts/pack-template.js` for TS/Python zip packaging
- `AGENTS.md` symlink to `CLAUDE.md` in both templates
- `CONTRIBUTING.md` and `CHANGELOG.md`

## [v0.4.1] - 2025-06-09

### Changed
- TypeScript template version 0.4.1

## [v0.4.0] - 2025-06-03

### Added
- Python template package (`deepagents-app-py`) mirroring TS template
- Python CI workflow with ruff/pyright/pytest
- Python release workflow with package/publish scripts

### Changed
- Renamed `template` → `deepagents-app-ts`
- Renamed `template-python` → `deepagents-app-py`
- Restructured shared skills for TS/Python dual support

## [v0.3.9] - 2025-05-28

### Fixed
- Publish S3 script: define PKG_NAME to fix unbound variable

## [v0.3.8] - 2025-05-28

### Fixed
- Update workspace name in package-lock.json for npm ci compatibility

## [v0.3.7] - 2025-05-27

### Fixed
- Release workflow working-directory for new package path

## [v0.3.6] - 2025-05-27

### Added
- Agent core package lifecycle documentation
- Runtime storage config improvements

## [v0.3.5] - 2025-05-26

### Added
- Compaction and eviction middleware
- Protected paths middleware
- OpenAI-compatible provider support

## [v0.3.4] - 2025-05-25

### Added
- Slash commands system
- Platform client improvements

## [v0.3.3] - 2025-05-24

### Added
- MCP manager improvements
- Variable manager enhancements

## [v0.3.2] - 2025-05-23

### Added
- Inspector package with read-only visualization
- Browser UI for agent orchestration

## [v0.3.1] - 2025-05-22

### Added
- Dev agent configuration and skills
- System prompt templates

## [v0.3.0] - 2025-05-21

### Added
- ACP server implementation
- CLI surfaces (REPL, one-shot)
- Config loader with 6-layer priority chain
- Middleware chain (lifecycle, cost tracking, stuck loop, eviction)

## [v0.2.10] - 2025-05-20

### Added
- Agent package configuration
- Distribution scripts (package, publish S3)
- Platform integration

## [v0.2.9] - 2025-05-19

### Added
- Tools: http_request, platform_api, agent_variable, mcp_bridge
- Skills system with YAML frontmatter

## [v0.2.8] - 2025-05-18

### Added
- Code graph generation
- Template manifest

## [v0.2.7] - 2025-05-17

### Added
- Model provider abstraction (Anthropic, OpenAI, Google)
- Permission modes (ask, yolo, plan)

## [v0.2.6] - 2025-05-16

### Added
- Config schema with Pydantic models
- Environment variable mapping

## [v0.2.5] - 2025-05-15

### Added
- Prompt management system
- System prompt assembly

## [v0.2.4] - 2025-05-14

### Added
- Storage layer (harness lifecycle, approvals)
- Logger with file tee

## [v0.2.3] - 2025-05-13

### Added
- Discovery system (skills, memory, sub-agents)
- Helpers utilities

## [v0.2.2] - 2025-05-12

### Added
- Platform integration (MCP, variables)
- Session management

## [v0.2.1] - 2025-05-11

### Added
- Initial project structure
- Basic agent framework

## [v0.2.0] - 2025-05-10

### Added
- Initial release
- TypeScript template foundation

---

## Python Template Versions

### [python-v0.2.11] - 2025-06-09

#### Changed
- Migrated from pydantic-ai to LangGraph + deepagents
- Ported app tools to LangChain `@tool` decorators
- Rebuilt runtime engine on LangGraph state graphs
- ACP server on deepagents-acp (stdio transport)

#### Removed
- deepagents-acp-py standalone library
- pydantic-ai dependencies

### [python-v0.2.10] - 2025-06-03

#### Added
- Initial Python template package
- CLI surfaces (REPL, one-shot)
- ACP server stub
- Config system with Pydantic models
- Tools: http_request, platform_api, agent_variable, mcp_bridge, json_utils, runtime_info, agent_memory

---

[Unreleased]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.4.1...HEAD
[v0.4.1]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.4.0...v0.4.1
[v0.4.0]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.9...v0.4.0
[v0.3.9]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.8...v0.3.9
[v0.3.8]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.7...v0.3.8
[v0.3.7]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.6...v0.3.7
[v0.3.6]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.5...v0.3.6
[v0.3.5]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.4...v0.3.5
[v0.3.4]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.3...v0.3.4
[v0.3.3]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.2...v0.3.3
[v0.3.2]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.1...v0.3.2
[v0.3.1]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.0...v0.3.1
[v0.3.0]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.10...v0.3.0
[v0.2.10]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.9...v0.2.10
[v0.2.9]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.8...v0.2.9
[v0.2.8]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.7...v0.2.8
[v0.2.7]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.6...v0.2.7
[v0.2.6]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.5...v0.2.6
[v0.2.5]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.4...v0.2.5
[v0.2.4]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.3...v0.2.4
[v0.2.3]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.2...v0.2.3
[v0.2.2]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.1...v0.2.2
[v0.2.1]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/nuwax-ai/deepagents-dev-templates/releases/tag/v0.2.0
[python-v0.2.11]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/python-v0.2.10...python-v0.2.11
[python-v0.2.10]: https://github.com/nuwax-ai/deepagents-dev-templates/releases/tag/python-v0.2.10
