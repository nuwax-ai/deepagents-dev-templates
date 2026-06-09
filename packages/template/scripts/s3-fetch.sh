#!/usr/bin/env bash
# Shared S3 helpers for install.sh / upgrade.sh / install-from-s3.sh.
#
# This script is meant to be sourced, not executed. It exposes:
#   s3_load_env
#   s3_endpoint_args
#   s3_resolve_version <channel>
#   s3_fetch_artifact <channel> <kind> <dest_dir>
#   s3_fetch_script <version> <script_name> <dest>
#
# All S3 coordinates default to the public nuwax-packages bucket; override via env vars:
#   NUWAX_S3_ENDPOINT, NUWAX_S3_REGION, NUWAX_S3_BUCKET, NUWAX_S3_PREFIX, NUWAX_S3_ENGINE_ID
#   NUWAX_S3_ACCESS_KEY_ID, NUWAX_S3_SECRET_ACCESS_KEY, NUWAX_S3_NO_VERIFY_SSL
#
# Requires: aws cli, node.
set -euo pipefail

S3_FETCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S3_FETCH_PKG_DIR="$(dirname "$S3_FETCH_DIR")"

# Map project env vars to AWS_* if AWS_* is not already set (CI takes precedence).
s3_apply_aws_env() {
  if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${NUWAX_S3_ACCESS_KEY_ID:-}" ]]; then
    export AWS_ACCESS_KEY_ID="$NUWAX_S3_ACCESS_KEY_ID"
  fi
  if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" && -n "${NUWAX_S3_SECRET_ACCESS_KEY:-}" ]]; then
    export AWS_SECRET_ACCESS_KEY="$NUWAX_S3_SECRET_ACCESS_KEY"
  fi
}

# Source the local .env so local dev does not have to export manually.
# CI will already have these set, and .env may not exist on cloud computers.
s3_load_env() {
  if [[ -f "$S3_FETCH_PKG_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$S3_FETCH_PKG_DIR/.env"
    set +a
  fi
  s3_apply_aws_env
}

# Build endpoint args using env vars; hardcoded defaults match distribution.json.
s3_endpoint_args() {
  local endpoint region
  endpoint=${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}
  region=${NUWAX_S3_REGION:-us-east-1}
  printf -- '--endpoint-url %s --region %s' "$endpoint" "$region"
  # No-sign-request for public buckets; skip if credentials are set for faster rate limits.
  if [[ -z "${NUWAX_S3_ACCESS_KEY_ID:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
    printf -- ' --no-sign-request'
  fi
  if [[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == "1" ]]; then
    printf -- ' --no-verify-ssl'
  fi
}

s3_bucket() {
  printf '%s' "${NUWAX_S3_BUCKET:-nuwax-packages}"
}

# Central name: all other names derive from this single fallback.
# Override via NUWAX_S3_ENGINE_ID; scripts that run locally read agent-package.json instead.
_S3_ENGINE_ID="${NUWAX_S3_ENGINE_ID:-deepagents-app-ts}"

s3_prefix() {
  printf '%s' "${NUWAX_S3_PREFIX:-agent-engines/${_S3_ENGINE_ID}}"
}

s3_engine_id() {
  printf '%s' "${_S3_ENGINE_ID}"
}

# The agent name used for nuwax artifacts (zip/tar).
# Falls back to engine id when not set explicitly.
s3_agent_name() {
  printf '%s' "${NUWAX_S3_AGENT_NAME:-${_S3_ENGINE_ID}}"
}

# The npm package name used for npm-tgz artifacts.
s3_pkg_name() {
  printf '%s' "${NUWAX_S3_PKG_NAME:-${_S3_ENGINE_ID}}"
}

# Download a public S3 object to a local file.
# Always uses --no-sign-request (artifacts/scripts/checksums are public reads).
# Uses `aws s3 cp` instead of `s3api get-object` for better MinIO compatibility
# (s3api get-object may fail silently on some MinIO versions / macOS).
# $1 = bucket, $2 = key, $3 = dest path
_s3_download() {
  local bucket="$1" key="$2" dest="$3"
  local endpoint region
  endpoint=${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}
  region=${NUWAX_S3_REGION:-us-east-1}
  local args=(--endpoint-url "$endpoint" --region "$region" --no-sign-request)
  if [[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == "1" ]]; then
    args+=(--no-verify-ssl)
  fi
  aws s3 cp "s3://${bucket}/${key}" "$dest" "${args[@]}" >/dev/null
}

# Resolve a channel pointer to a version string. Echoes "<version>".
# Refuses to echo anything on error and exits non-zero.
s3_resolve_version() {
  local channel="${1:-stable}"
  local bucket prefix engine
  bucket=$(s3_bucket)
  prefix=$(s3_prefix)
  engine=$(s3_engine_id)

  local key="${prefix}/channels/${channel}.json"
  local body
  if ! body=$(aws s3 cp "s3://${bucket}/${key}" - $(s3_endpoint_args) 2>/dev/null); then
    echo "Failed to read channel pointer: s3://${bucket}/${key}" >&2
    echo "  - is NUWAX_S3_ENDPOINT / NUWAX_S3_BUCKET correct?" >&2
    echo "  - has the channel '${channel}' been published at least once?" >&2
    return 1
  fi
  local version
  version=$(printf '%s' "$body" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.version||'')}catch(e){process.exit(2)}})")
  if [[ -z "$version" ]]; then
    echo "Channel pointer has no .version field: s3://${bucket}/${key}" >&2
    return 1
  fi
  printf '%s' "$version"
}

# Read package-checksums.json for a version into a local path and print it.
s3_fetch_checksums() {
  local version="$1"
  local dest_dir="$2"
  local bucket prefix
  bucket=$(s3_bucket)
  prefix=$(s3_prefix)
  mkdir -p "$dest_dir"
  _s3_download "$bucket" "${prefix}/versions/${version}/metadata/package-checksums.json" \
    "$dest_dir/package-checksums.json"
  printf '%s/package-checksums.json' "$dest_dir"
}

# Verify a local artifact against package-checksums.json.
# $1 = local artifact path, $2 = package-checksums.json path
s3_verify_checksum() {
  local artifact="$1"
  local checksums="$2"
  local file expected actual
  file=$(basename "$artifact")
  expected=$(node -e "const c=require('$checksums');const a=(c.artifacts||[]).find(x=>x.file==='$file');if(!a){process.stderr.write('Artifact not in checksums: $file\n');process.exit(1)}process.stdout.write(a.sha256)")
  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$artifact" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$artifact" | awk '{print $1}')
  else
    echo "No sha256 tool found (tried: shasum, sha256sum). Install coreutils or perl." >&2
    return 1
  fi
  if [[ "$expected" != "$actual" ]]; then
    echo "SHA256 mismatch for $file" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    return 1
  fi
}

# Download the artifact for a channel+kind, verify sha256, and print the local path.
# $1 = channel, $2 = kind (nuwax-zip | nuwax-tar | npm-tgz), $3 = dest dir
s3_fetch_artifact() {
  local channel="$1"
  local kind="$2"
  local dest_dir="$3"

  local version
  version=$(s3_resolve_version "$channel") || return 1

  s3_fetch_artifact_at_version "$version" "$kind" "$dest_dir"
}

# Download the artifact for a specific version (skip channel resolution).
# $1 = version, $2 = kind (nuwax-zip | nuwax-tar | npm-tgz), $3 = dest dir
s3_fetch_artifact_at_version() {
  local version="$1"
  local kind="$2"
  local dest_dir="$3"
  local bucket prefix
  bucket=$(s3_bucket)
  prefix=$(s3_prefix)

  local suffix basename
  case "$kind" in
    nuwax-zip) suffix="nuwax.zip" ;;
    nuwax-tar) suffix="nuwax.tar.gz" ;;
    npm-tgz)   suffix="tgz" ;;
    *) echo "Unknown artifact kind: $kind" >&2; return 1 ;;
  esac

  case "$kind" in
    npm-tgz) basename="$(s3_pkg_name)" ;;
    *)       basename="$(s3_agent_name)" ;;
  esac
  local file="${basename}-${version}-${suffix}"
  mkdir -p "$dest_dir"
  local dest="$dest_dir/$file"

  echo "→ fetching s3://${bucket}/${prefix}/versions/${version}/artifacts/${file}" >&2
  _s3_download "$bucket" "${prefix}/versions/${version}/artifacts/${file}" "$dest"

  local checksums
  checksums=$(s3_fetch_checksums "$version" "$dest_dir") || return 1
  s3_verify_checksum "$dest" "$checksums" || return 1

  printf '%s' "$dest"
}

# Download a sibling script (install.sh, upgrade.sh, s3-fetch.sh, etc.) for a given version.
# $1 = version, $2 = script name (e.g. install.sh), $3 = dest path
s3_fetch_script() {
  local version="$1"
  local name="$2"
  local dest="$3"
  local bucket prefix
  bucket=$(s3_bucket)
  prefix=$(s3_prefix)
  mkdir -p "$(dirname "$dest")"
  _s3_download "$bucket" "${prefix}/versions/${version}/scripts/${name}" "$dest"
  chmod +x "$dest" 2>/dev/null || true
  printf '%s' "$dest"
}
