#!/usr/bin/env bash
# Formats the app's Swift with the SwiftFormat pinned in Tools/ and the rules in ../.swiftformat.
# `scripts/format.sh --lint` only reports (file:line: rule), as the CI's ios-client job does.
set -euo pipefail
ios=$(cd "$(dirname "$0")/.." && pwd)
swift build --package-path "$ios/Tools" -c release --product swiftformat > /dev/null
"$(swift build --package-path "$ios/Tools" -c release --show-bin-path)/swiftformat" "$@" "$ios"
