#!/usr/bin/env bash
# Publishes the ios job's screenshots: commits them to the ios-screenshots branch (so a PR comment
# can show them), writes them in the job summary, and keeps one comment on the PR up to date.
# Needs GH_TOKEN (contents and pull-requests: write), GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA.
# Usage: ios-screenshots.sh <folder of PNGs> [PR number]
set -euo pipefail

[ -d "$1" ] || { echo "No screenshots: $1 doesn't exist" | tee -a "$GITHUB_STEP_SUMMARY"; exit 0; }
shots=$(cd "$1" && pwd)
pr=${2:-}
branch=ios-screenshots
folder="runs/$GITHUB_RUN_ID"
marker="<!-- quai-ios-screenshots -->"

if ! ls "$shots"/*.png > /dev/null 2>&1; then
  echo "No screenshots in $shots" | tee -a "$GITHUB_STEP_SUMMARY"
  exit 0
fi

work=$(mktemp -d)
git -C "$work" init -q
git -C "$work" remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
for attempt in 1 2 3; do
  if git -C "$work" fetch -q --depth 1 origin "$branch" 2>/dev/null; then
    git -C "$work" checkout -q -B "$branch" FETCH_HEAD
  else
    git -C "$work" checkout -q --orphan "$branch"
  fi
  mkdir -p "$work/$folder"
  cp "$shots"/*.png "$work/$folder/"
  git -C "$work" add "$folder"
  git -C "$work" -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "Screenshots of run $GITHUB_RUN_ID (${GITHUB_SHA:0:7})"
  if git -C "$work" push -q origin "HEAD:refs/heads/$branch"; then break; fi
  [ "$attempt" = 3 ] && { echo "Couldn't push the screenshots"; exit 1; }
  sleep $((attempt * 5))
done

raw="https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${branch}/${folder}"
run="https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
{
  echo "$marker"
  echo "### 📱 iOS screenshots"
  echo
  echo "The app on the simulator, paired to the preview server (Quai Cloud + a fake Quai Home on the recorded fixtures), at ${GITHUB_SHA:0:7} · [run]($run)"
  echo
  cells=""
  heads=""
  count=0
  for png in "$shots"/*.png; do
    name=$(basename "$png" .png)
    heads+="| ${name#*-} "
    cells+="| <img src=\"$raw/$name.png\" width=\"220\"> "
    count=$((count + 1))
    if [ $((count % 3)) = 0 ]; then
      echo "$heads|"; echo "$(printf '|---%.0s' $(seq 3))|"; echo "$cells|"; echo
      heads=""; cells=""
    fi
  done
  if [ -n "$cells" ]; then
    n=$((count % 3))
    echo "$heads|"; echo "$(printf '|---%.0s' $(seq "$n"))|"; echo "$cells|"
  fi
} > "$work/comment.md"

cat "$work/comment.md" >> "$GITHUB_STEP_SUMMARY"

if [ -z "$pr" ]; then
  pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "${GITHUB_REF_NAME}" --state open --json number --jq '.[0].number // empty' || true)
fi
[ -z "$pr" ] && { echo "No open PR: screenshots in the job summary only."; exit 0; }

existing=$(gh api "repos/${GITHUB_REPOSITORY}/issues/$pr/comments" --paginate \
  --jq "[.[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\")))][0].id // empty")
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/$existing" -F body=@"$work/comment.md" > /dev/null
else
  gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/$pr/comments" -F body=@"$work/comment.md" > /dev/null
fi
echo "Screenshots posted on #$pr"
