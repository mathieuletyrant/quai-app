#!/usr/bin/env bash
# Generates the app's client (Quai/Generated) from openapi.json and openapi-generator-config.yaml.
# Run after `pnpm gen:openapi`; the CI fails while the committed client differs.
set -euo pipefail
ios=$(cd "$(dirname "$0")/.." && pwd)
swift build --package-path "$ios/Tools" -c release --product swift-openapi-generator > /dev/null
"$(swift build --package-path "$ios/Tools" -c release --show-bin-path)/swift-openapi-generator" generate \
  --config "$ios/Quai/openapi-generator-config.yaml" \
  --output-directory "$ios/Quai/Generated" \
  "$ios/Quai/openapi.json"
