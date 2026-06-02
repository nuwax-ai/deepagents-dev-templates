#!/usr/bin/env bash
# Package script for distribution
set -euo pipefail

VERSION=${1:-$(node -p "require('./agent-package.json').version")}
NAME=$(node -p "require('./agent-package.json').name")
TARBALL="${NAME}-${VERSION}.tgz"
NPM_CACHE=${NPM_CONFIG_CACHE:-${TMPDIR:-/tmp}/deepagents-dev-templates-npm-cache}

echo "📦 Packaging ${NAME} v${VERSION}..."

# Build first
bash scripts/build.sh

# Run tests
echo ""
echo "🧪 Running tests..."
npm test
echo "  ✅ All tests passed"

# Create tarball
echo ""
echo "📋 Creating distribution package..."
npm --cache "$NPM_CACHE" pack --pack-destination .
ACTUAL_TARBALL=$(ls -t *.tgz 2>/dev/null | head -1)

if [ -z "$ACTUAL_TARBALL" ]; then
  echo "  ❌ Failed to create tarball"
  exit 1
fi

# Compute checksum
CHECKSUM=$(shasum -a 256 "$ACTUAL_TARBALL" | cut -d' ' -f1)
echo "  ✅ Created: $ACTUAL_TARBALL"
echo "  ✅ SHA256:  $CHECKSUM"

# Write a release manifest next to the tarball. The source manifest remains
# stable in git; the release manifest carries the tarball checksum.
node -e "
  const pkg = require('./agent-package.json');
  pkg.checksum.value = '$CHECKSUM';
  pkg.version = '$VERSION';
  pkg.source = {
    type: 'tgz',
    path: './$ACTUAL_TARBALL',
    version: '$VERSION'
  };
  require('fs').writeFileSync('./agent-package.release.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "  ✅ Wrote agent-package.release.json"

echo ""
echo "✅ Package ready: $ACTUAL_TARBALL"
echo ""
echo "Distribution options:"
echo "  npm:  npm publish $ACTUAL_TARBALL"
echo "  tgz:  Share $ACTUAL_TARBALL directly"
echo "  git:  git tag v$VERSION && git push --tags"
