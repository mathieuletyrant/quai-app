#!/bin/sh
# After an agent edits a TypeScript or JavaScript file: format it (dprint through ESLint) and send back what
# ESLint can't fix, so the agent fixes it now rather than at `pnpm check`.
file=$(node -e 'let input = ""; process.stdin.on("data", (chunk) => input += chunk).on("end", () => {
  try { process.stdout.write(JSON.parse(input).tool_input?.file_path ?? "") } catch {}
})')
case "$file" in
  *.ts | *.tsx | *.js | *.mjs) ;;
  *) exit 0 ;;
esac
case "$file" in
  */node_modules/* | */dist/*) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -e node_modules/.bin/eslint ] || exit 0
if ! report=$(node_modules/.bin/eslint --fix --no-warn-ignored "$file" 2>&1); then
  echo "$report" >&2
  exit 2
fi
