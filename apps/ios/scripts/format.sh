#!/usr/bin/env bash
# Formats the app's Swift with the SwiftFormat pinned in ../tools.env and the rules in ../.swiftformat.
# `scripts/format.sh --lint` only reports (file:line: rule), as the CI's ios-client job does.
set -euo pipefail
ios=$(cd "$(dirname "$0")/.." && pwd)
"$("$ios/scripts/tool.sh" swiftformat)" "$@" "$ios"
