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
# Reads layout from .nuwax-agent/distribution.json. Honors env overrides:
#   NUWAX_S3_ENDPOINT, NUWAX_S3_REGION, NUWAX_S3_BUCKET
#   NUWAX_S3_ACCESS_KEY_ID, NUWAX_S3_SECRET_ACCESS_KEY, NUWAX_S3_NO_VERIFY_SSL
#
# Requires: aws cli, jq, node.
set -euo pipefail

S3_FETCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S3_FETCH_PKG_DIR="$(dirname "$S3_FETCH_DIR")"
S3_FETCH_DIST_CONFIG="$S3_FETCH_PKG_DIR/.nuwax-agent/distribution.json"

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

# Read the bucket + prefix from distribution.json with env-var precedence.
s3_endpoint_args() {
  local endpoint region
  endpoint=${NUWAX_S3_ENDPOINT:-$(node -p "require('$S3_FETCH_DIST_CONFIG').endpoint.url")}
  region=${NUWAX_S3_REGION:-$(node -p "require('$S3_FETCH_DIST_CONFIG').endpoint.region")}
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
  printf '%s' "${NUWAX_S3_BUCKET:-$(node -p "require('$S3_FETCH_DIST_CONFIG').bucket")}"
}

s3_prefix() {
  node -p "require('$S3_FETCH_DIST_CONFIG').prefix"
}

s3_engine_id() {
  node -p "require('$S3_FETCH_DIST_CONFIG').engineId"
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
  aws s3 cp "s3://${bucket}/${prefix}/versions/${version}/metadata/package-checksums.json" \
    "$dest_dir/package-checksums.json" $(s3_endpoint_args)
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

  local suffix
  case "$kind" in
    nuwax-zip) suffix="nuwax.zip" ;;
    nuwax-tar) suffix="nuwax.tar.gz" ;;
    npm-tgz)   suffix="tgz" ;;
    *) echo "Unknown artifact kind: $kind" >&2; return 1 ;;
  esac

  local file="deepagents-dev-templates-${version}-${suffix}"
  mkdir -p "$dest_dir"
  local dest="$dest_dir/$file"

  echo "→ fetching s3://${bucket}/${prefix}/versions/${version}/artifacts/${file}"
  aws s3 cp "s3://${bucket}/${prefix}/versions/${version}/artifacts/${file}" "$dest" $(s3_endpoint_args)

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
  aws s3 cp "s3://${bucket}/${prefix}/versions/${version}/scripts/${name}" "$dest" $(s3_endpoint_args)
  chmod +x "$dest" 2>/dev/null || true
  printf '%s' "$dest"
}
