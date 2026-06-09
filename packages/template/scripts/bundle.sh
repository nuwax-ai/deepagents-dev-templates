#!/usr/bin/env bash
# Bundle the runnable agent (entry + all production deps) into a single
# self-contained ESM file via esbuild.
#
# This is the deployable Nuwax artifact's runtime: it replaces shipping the
# whole production node_modules tree. The npm library package keeps its tsc
# output (dist/**, *.d.ts) for `exports['./runtime']` and the inspector — only
# the Nuwax tar/zip ships this bundle.
#
# The `createRequire` banner is required: bundled CJS deps (e.g. dotenv) call
# `require("fs")`, which an ESM bundle otherwise turns into a throwing shim.
set -euo pipefail

OUT="${1:-dist/bundle.mjs}"
ENTRY="${ENTRY:-src/index.ts}"

mkdir -p "$(dirname "$OUT")"

echo "Bundling $ENTRY -> $OUT (esbuild)"
npx --yes esbuild "$ENTRY" \
  --bundle \
  --platform=node \
  --format=esm \
  --target=node20 \
  --outfile="$OUT" \
  --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" \
  --log-level=warning

echo "✅ Bundle written: $OUT ($(du -h "$OUT" | cut -f1))"
