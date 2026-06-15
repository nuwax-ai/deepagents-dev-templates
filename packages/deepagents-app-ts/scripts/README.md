# Scripts

Build, development, and distribution scripts for the template package.

> **Note**: Script paths are a published S3 distribution contract — do not rename or move files.

## Development

| Script | Description |
|--------|-------------|
| `setup-win-tools.ps1` | Windows: install `rsync` + `zip` via Chocolatey (`pnpm run setup:tools`) |
| `setup-win-tools.mjs` | Cross-platform entry → PowerShell on Windows, tool report elsewhere |
| `check-tools.mjs` | Report `rsync` / `zip` / `gzip` / `tar` availability (`pnpm run check:tools`) |
| `dev.sh` | Start development server with tsx (hot-reload) |
| `run-repl.sh` | Launch the CLI REPL directly |
| `render-acp-config.sh` | Render ACP configuration from template |

## Build & Package

| Script | Description |
|--------|-------------|
| `build.sh` | Compile TypeScript to `dist/` |
| `bundle.sh` | Wrapper → `lib/bundle.mjs` (esbuild bundle, cross-platform) |
| `package.sh` | Wrapper → `package.mjs` (distribution archives, cross-platform) |
| `package-platforms.sh` | Wrapper → `package-platforms.mjs` (per-platform archives + `platforms.json`, cross-platform) |
| `validate-package.sh` | Validate package contents and structure |
| `local-release.sh` | Create a local release for testing |

### Windows packaging tools (optional, recommended)

Packaging scripts are **pure Node** (`package.mjs`, `package-platforms.mjs`) and run in **PowerShell without bash**. For faster, more reliable archives, install native CLI tools once:

```powershell
# Admin not required for choco install if Chocolatey is already set up
pnpm run setup:tools

# Open a NEW terminal, then verify:
pnpm run check:tools
```

This installs via Chocolatey:

| Tool | Chocolatey package | Used for |
|------|-------------------|----------|
| `rsync` | `rsync` | Staging copy (falls back to Node `fs.cp`) |
| `zip` | `zip` | Windows `.zip` archives (falls back to PowerShell `Compress-Archive`) |

macOS / Linux usually ship these tools; run `pnpm run check:tools` to confirm.

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
