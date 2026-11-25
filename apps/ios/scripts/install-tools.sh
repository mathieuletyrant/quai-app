#!/usr/bin/env bash
# Installs SwiftFormat and SwiftLint at the versions in ../tools.env, as their static Linux binaries: no Swift
# toolchain needed. Skips a tool already there at its version. Used by the CI's ios-client job, by format.sh and
# lint.sh, and by an agent environment's setup script.
# Usage: install-tools.sh [directory]   (default: apps/ios/.tools/bin)
set -euo pipefail
ios=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=../tools.env
. "$ios/tools.env"
bin=${1:-$ios/.tools/bin}
mkdir -p "$bin"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ "$("$bin/swiftformat" --version 2>/dev/null || true)" != "$SWIFTFORMAT_VERSION" ]; then
  curl -fsSL -o "$work/swiftformat.zip" \
    "https://github.com/nicklockwood/SwiftFormat/releases/download/$SWIFTFORMAT_VERSION/swiftformat_linux.zip"
  unzip -oq "$work/swiftformat.zip" swiftformat_linux -d "$work"
  install -m 755 "$work/swiftformat_linux" "$bin/swiftformat"
fi

# The static build: the dynamic one needs SourceKit from a Swift toolchain, which none of the rules use.
if [ "$("$bin/swiftlint" version 2>/dev/null || true)" != "$SWIFTLINT_VERSION" ]; then
  curl -fsSL -o "$work/swiftlint.zip" \
    "https://github.com/realm/SwiftLint/releases/download/$SWIFTLINT_VERSION/swiftlint_linux_amd64.zip"
  unzip -oq "$work/swiftlint.zip" swiftlint-static -d "$work"
  install -m 755 "$work/swiftlint-static" "$bin/swiftlint"
fi
