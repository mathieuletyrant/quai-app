#!/usr/bin/env bash
# Model-checks LiveActivityPushes.tla with TLC, one invariant at a time, and compares each result
# with what it is expected to be today. Exits 1 when a result changes.
# Needs Java 11+. TLA2TOOLS_JAR: a local tla2tools.jar; otherwise it is downloaded once.
set -euo pipefail
cd "$(dirname "$0")"

version=v1.8.0
jar=${TLA2TOOLS_JAR:-${XDG_CACHE_HOME:-$HOME/.cache}/quai/tla2tools-$version.jar}
if [ ! -f "$jar" ]; then
  mkdir -p "$(dirname "$jar")"
  curl -sfL -o "$jar" "https://github.com/tlaplus/tlaplus/releases/download/$version/tla2tools.jar"
fi

# design (SendUnderLock) | max engine runs | invariant | expected
checks=(
  "FALSE 5 OneActivity pass"
  "FALSE 5 ActivityWhileRunning fail"
  "FALSE 5 LatestShown fail"
  "TRUE 7 OneActivity pass"
  "TRUE 7 ActivityWhileRunning pass"
  "TRUE 7 LatestShown pass"
)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
changed=0
for check in "${checks[@]}"; do
  read -r underLock runs invariant expected <<< "$check"
  design=$([ "$underLock" = TRUE ] && echo "sent under the lock" || echo "code as it is")
  printf 'SPECIFICATION Spec\nCONSTANTS\n    MaxRuns = %s\n    SendUnderLock = %s\nINVARIANTS\n    TypeOK\n    %s\n' \
    "$runs" "$underLock" "$invariant" > "$work/check.cfg"
  log="$work/$underLock-$invariant.log"
  java -XX:+UseParallelGC -jar "$jar" -deadlock -workers auto -metadir "$work/states" -noGenerateSpecTE \
    -config "$work/check.cfg" LiveActivityPushes.tla > "$log" 2>&1 || true
  if grep -q "No error has been found" "$log"; then
    result=pass
  elif grep -q "Invariant .* is violated" "$log"; then
    result=fail
  else
    cat "$log"; echo "TLC didn't finish: see above"; exit 2
  fi
  mark=$([ "$result" = "$expected" ] && echo "  " || echo "!!")
  printf '%s %-21s %-21s %s (expected %s)\n' "$mark" "$design" "$invariant" "$result" "$expected"
  if [ "$result" != "$expected" ]; then
    changed=1
    sed -n '/is violated/,/states generated/p' "$log"
  fi
done
exit $changed
