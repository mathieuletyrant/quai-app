#!/usr/bin/env bash
# Prints the path of a pinned Swift tool (swiftformat or swiftlint): the one on PATH when it is at the version in
# ../tools.env (an environment's setup script installed it), else the one install-tools.sh puts in ../.tools/bin.
set -euo pipefail
ios=$(cd "$(dirname "$0")/.." && pwd)
. "$ios/tools.env"
case "$1" in
  swiftformat) want=$SWIFTFORMAT_VERSION; version=(--version) ;;
  swiftlint) want=$SWIFTLINT_VERSION; version=(version) ;;
  *) echo "unknown tool: $1" >&2; exit 2 ;;
esac
if found=$(command -v "$1") && [ "$("$found" "${version[@]}" 2>/dev/null || true)" = "$want" ]; then
  echo "$found"
  exit 0
fi
"$ios/scripts/install-tools.sh" "$ios/.tools/bin" >&2
echo "$ios/.tools/bin/$1"
