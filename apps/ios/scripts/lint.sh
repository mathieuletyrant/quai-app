#!/usr/bin/env bash
# Checks the app's Swift with the SwiftLint pinned in ../tools.env and the rules in ../.swiftlint.yml.
# Extra arguments go to `swiftlint lint`: the CI's ios-client job passes
# `--strict --reporter github-actions-logging`, so each violation fails the job on its line.
set -euo pipefail
ios=$(cd "$(dirname "$0")/.." && pwd)
swiftlint=$("$ios/scripts/tool.sh" swiftlint)
# From the repository's root, so each path it reports is the one GitHub annotates.
cd "$ios/../.."
"$swiftlint" lint --quiet --config "$ios/.swiftlint.yml" "$@" "$ios"
