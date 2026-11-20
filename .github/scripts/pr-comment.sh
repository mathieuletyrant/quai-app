#!/usr/bin/env bash
# Keeps one comment on the PR up to date: the one starting with the marker, else a new one.
# Needs GH_TOKEN (pull-requests: write) and GITHUB_REPOSITORY.
# Usage: pr-comment.sh <marker> <markdown file> [PR number]
# Without a PR number, the open PR of GITHUB_REF_NAME; none: does nothing.
set -euo pipefail

marker=$1
file=$2
pr=${3:-}

if [ -z "$pr" ]; then
  pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "${GITHUB_REF_NAME}" --state open --json number --jq '.[0].number // empty' || true)
fi
[ -z "$pr" ] && { echo "No open PR: nothing posted."; exit 0; }

body=$(mktemp)
{ echo "$marker"; cat "$file"; } > "$body"
existing=$(gh api "repos/${GITHUB_REPOSITORY}/issues/$pr/comments" --paginate \
  --jq "[.[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\")))][0].id // empty")
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/$existing" -F body=@"$body" > /dev/null
else
  gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/$pr/comments" -F body=@"$body" > /dev/null
fi
echo "Posted on #$pr"
