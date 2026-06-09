# Scripts

Build, development, and distribution scripts for the template package.

> **Note**: Script paths are a published S3 distribution contract — do not rename or move files.

## Development

| Script | Description |
|--------|-------------|
| `dev.sh` | Start development server with tsx (hot-reload) |
| `run-repl.sh` | Launch the CLI REPL directly |
| `render-acp-config.sh` | Render ACP configuration from template |

## Build & Package

| Script | Description |
|--------|-------------|
| `build.sh` | Compile TypeScript to `dist/` |
| `bundle.sh` | Create self-contained esbuild bundle (`dist/bundle.mjs`) |
| `package.sh` | Build distribution archives (.tgz, .zip, .tar.gz) |
| `package-platforms.sh` | Build per-platform archives `{agentName}-{os}-{arch}-{version}.{ext}` + `platforms.json` for nuwax-file-server (quiet by default; `-v` for progress) |
| `validate-package.sh` | Validate package contents and structure |
| `local-release.sh` | Create a local release for testing |

## Distribution (S3)

| Script | Description |
|--------|-------------|
| `release.sh` | Full release: tag → build → package → publish |
| `publish-s3.sh` | Upload release artifacts to S3 |
| `s3-fetch.sh` | Download artifacts from S3 |
| `install.sh` | Install agent from distribution (auto-detects bundle) |
| `install-from-s3.sh` | Install agent directly from S3 |
| `uninstall.sh` | Remove installed agent |
| `upgrade.sh` | Upgrade agent to latest version |
