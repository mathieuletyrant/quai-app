#!/usr/bin/env bash
# Model-checks LiveActivityPushes.tla with TLC, one invariant at a time, and compares each result
# with what it is expected to be today. Exits 1 when a result changes.
# Needs Java 11+. TLA2TOOLS_JAR: a local tla2tools.jar; otherwise it is downloaded once.
set -euo pipefail
cd "$(dirname "$0")"

version=v1.7.4
sha256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
jar=${TLA2TOOLS_JAR:-${XDG_CACHE_HOME:-$HOME/.cache}/quai/tla2tools-$version.jar}
if [ -z "${TLA2TOOLS_JAR:-}" ]; then
  if [ ! -f "$jar" ]; then
    mkdir -p "$(dirname "$jar")"
    curl -sfL -o "$jar.part" "https://github.com/tlaplus/tlaplus/releases/download/$version/tla2tools.jar"
    mv "$jar.part" "$jar"
  fi
  echo "$sha256  $jar" | sha256sum -c --quiet - || { rm -f "$jar"; echo "tla2tools.jar doesn't match $version's checksum"; exit 2; }
fi

# design (SendUnderLock) | max engine runs | invariant | expected
checks=(
  "TRUE 7 OneActivity pass"
  "TRUE 7 ActivityWhileRunning pass"
  "TRUE 7 LatestShown pass"
  "FALSE 5 OneActivity pass"
  "FALSE 5 ActivityWhileRunning fail"
  "FALSE 5 LatestShown fail"
)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# TLC writes its trace files next to the spec: it runs on a copy, in the temporary folder.
cp LiveActivityPushes.tla "$work/"
changed=0
for check in "${checks[@]}"; do
  read -r underLock runs invariant expected <<< "$check"
  design=$([ "$underLock" = TRUE ] && echo "code as it is" || echo "sent after the lock")
  printf 'SPECIFICATION Spec\nCONSTANTS\n    MaxRuns = %s\n    SendUnderLock = %s\nINVARIANTS\n    TypeOK\n    %s\n' \
    "$runs" "$underLock" "$invariant" > "$work/check.cfg"
  log="$work/$underLock-$invariant.log"
  (cd "$work" && java -XX:+UseParallelGC -jar "$jar" -deadlock -workers auto -metadir "$work/states" \
    -config check.cfg LiveActivityPushes.tla) > "$log" 2>&1 || true
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
