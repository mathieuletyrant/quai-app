#!/bin/sh
# Before an agent ends its turn: when the code changed since the last green run, `pnpm check` and `pnpm test` run, and
# a failure sends the agent back to work with the output instead of "done". Once per turn (`stop_hook_active`), so a
# failure it can't fix still reaches the user.
input=$(cat)
case "$input" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -d node_modules ] || exit 0
state=$(git rev-parse --git-path quai-last-green)
current=$( (git rev-parse HEAD; git status --porcelain; git diff HEAD) | sha1sum | cut -d' ' -f1)
[ -f "$state" ] && [ "$(cat "$state")" = "$current" ] && exit 0
if output=$(pnpm check 2>&1 && pnpm test 2>&1); then
  echo "$current" > "$state"
  exit 0
fi
echo "pnpm check && pnpm test failed: fix it before finishing (AGENTS.md, \"Before finishing a task\")." >&2
echo "$output" | grep -E "error|Error|FAIL|×|✖|failed" | head -40 >&2
exit 2
