#!/bin/bash
# fix-sentry-errors.sh
# Fetches unresolved Sentry errors and runs Claude Code to create fix PRs.
# Uses your Claude Max subscription (local CLI).
#
# Uses git worktrees — your working directory is NEVER touched.
# Each fix runs in an isolated copy under .sentry-worktrees/
#
# Setup:
#   1. Generate a Sentry API token: https://sentry.io/settings/account/api/auth-tokens/
#      - Scopes needed: project:read, event:read, event:admin
#   2. Add SENTRY_API_TOKEN=sntryu_... to .env
#   3. Make executable: chmod +x scripts/fix-sentry-errors.sh
#   4. Optional cron: crontab -e → 0 8 * * * /path/to/fix-sentry-errors.sh

set -euo pipefail

SENTRY_ORG="score-26"
SENTRY_PROJECT="app"
SENTRY_API_BASE="https://de.sentry.io/api/0"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_DIR="$REPO_DIR/.sentry-worktrees"

# Load token from .env if not already in environment
if [ -z "${SENTRY_API_TOKEN:-}" ] && [ -f "$REPO_DIR/.env" ]; then
  SENTRY_API_TOKEN=$(grep '^SENTRY_API_TOKEN=' "$REPO_DIR/.env" | cut -d= -f2-)
fi

if [ -z "${SENTRY_API_TOKEN:-}" ]; then
  echo "Error: SENTRY_API_TOKEN is not set."
  echo "Add it to .env or export it in your shell."
  exit 1
fi

echo "Fetching unresolved Sentry errors..."

ISSUES=$(curl -s \
  -H "Authorization: Bearer $SENTRY_API_TOKEN" \
  "$SENTRY_API_BASE/projects/$SENTRY_ORG/$SENTRY_PROJECT/issues/?query=is:unresolved&limit=5&sort=date")

ISSUE_COUNT=$(echo "$ISSUES" | jq 'length')

if [ "$ISSUE_COUNT" = "0" ] || [ "$ISSUE_COUNT" = "null" ]; then
  echo "No unresolved errors. Nothing to fix."
  exit 0
fi

echo "Found $ISSUE_COUNT unresolved error(s)."

# Fetch latest main without touching the working tree
git -C "$REPO_DIR" fetch origin main --quiet 2>/dev/null || true

mkdir -p "$WORKTREE_DIR"

# Process each issue
echo "$ISSUES" | jq -c '.[]' | while read -r ISSUE; do
  ISSUE_ID=$(echo "$ISSUE" | jq -r '.id')
  TITLE=$(echo "$ISSUE" | jq -r '.title')
  CULPRIT=$(echo "$ISSUE" | jq -r '.culprit')
  EVENT_COUNT=$(echo "$ISSUE" | jq -r '.count')
  FIRST_SEEN=$(echo "$ISSUE" | jq -r '.firstSeen')
  PERMALINK=$(echo "$ISSUE" | jq -r '.permalink')

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Error: $TITLE"
  echo "Location: $CULPRIT"
  echo "Occurrences: $EVENT_COUNT | First seen: $FIRST_SEEN"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  BRANCH_NAME="fix/sentry-$ISSUE_ID"

  # Skip if branch already exists locally or remotely
  if git -C "$REPO_DIR" rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
    echo "  Skipping: branch $BRANCH_NAME already exists locally"
    continue
  fi
  if git -C "$REPO_DIR" ls-remote --heads origin "$BRANCH_NAME" 2>/dev/null | grep -q "$BRANCH_NAME"; then
    echo "  Skipping: branch $BRANCH_NAME already exists on remote"
    continue
  fi

  # Fetch latest event for stack trace
  LATEST_EVENT=$(curl -s \
    -H "Authorization: Bearer $SENTRY_API_TOKEN" \
    "$SENTRY_API_BASE/issues/$ISSUE_ID/events/latest/")

  STACKTRACE=$(echo "$LATEST_EVENT" | jq -r '
    .entries[]? | select(.type == "exception") |
    .data.values[]? |
    "Exception: \(.type // "unknown"): \(.value // "no message")\n" +
    ([.stacktrace.frames[]? |
      select(.inApp == true) |
      "  \(.filename // "?"):\(.lineNo // "?") in \(.function // "?")\n    \(.context // [] | map(.[1] // "") | join("\n    "))"
    ] | join("\n"))
  ')

  if [ -z "$STACKTRACE" ] || [ "$STACKTRACE" = "null" ]; then
    echo "  Skipping: no actionable stack trace"
    continue
  fi

  # Create worktree — isolated copy of the repo
  WT_PATH="$WORKTREE_DIR/sentry-$ISSUE_ID"
  if [ -d "$WT_PATH" ]; then
    echo "  Cleaning up stale worktree..."
    git -C "$REPO_DIR" worktree remove "$WT_PATH" --force 2>/dev/null || rm -rf "$WT_PATH"
  fi

  echo "  Creating worktree at $WT_PATH..."
  git -C "$REPO_DIR" worktree add -b "$BRANCH_NAME" "$WT_PATH" origin/main --quiet

  # Install deps in worktree
  (cd "$WT_PATH" && bun install --frozen-lockfile --silent 2>/dev/null || true)

  # Run Claude Code in the worktree (cd into it so it's the working directory)
  # --dangerously-skip-permissions: needed for unattended runs (no human to approve tool calls)
  (cd "$WT_PATH" && claude --dangerously-skip-permissions -p "
You are fixing a production error reported by Sentry.

## Error
Title: $TITLE
Location: $CULPRIT
Occurrences: $EVENT_COUNT
Sentry URL: $PERMALINK

## Stack Trace
$STACKTRACE

## Instructions
1. Read the relevant source files from the stack trace
2. Identify the root cause
3. Fix the bug with minimal changes
4. Run \`npx tsc --noEmit\` to verify the fix compiles
5. Run \`bun test\` to verify tests still pass
6. Create a git commit with message: \"fix: $TITLE\"
7. Do NOT push or create a PR — just commit locally

If you cannot determine a fix with confidence, create a commit that adds a comment explaining the issue and what you investigated.
")

  # Push and create PR if Claude made commits
  COMMIT_COUNT=$(git -C "$WT_PATH" log origin/main.."$BRANCH_NAME" --oneline 2>/dev/null | wc -l | tr -d ' ')
  if [ "$COMMIT_COUNT" -gt 0 ]; then
    git -C "$WT_PATH" push -u origin "$BRANCH_NAME"

    PR_URL=$(cd "$WT_PATH" && gh pr create \
      --title "fix: $TITLE" \
      --body "$(cat <<EOF
## Sentry Error

- **Error**: $TITLE
- **Location**: $CULPRIT
- **Occurrences**: $EVENT_COUNT
- **Sentry**: $PERMALINK

## Stack Trace
\`\`\`
$STACKTRACE
\`\`\`

## Auto-generated fix
This PR was automatically generated by Claude Code from a Sentry error report.

Please review carefully before merging.
EOF
)")

    echo "  PR created: $PR_URL"

    # Mark issue as resolved in Sentry
    curl -s -X PUT \
      -H "Authorization: Bearer $SENTRY_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"status": "resolved"}' \
      "$SENTRY_API_BASE/issues/$ISSUE_ID/" > /dev/null

    echo "  Sentry issue resolved"
  else
    echo "  No commits made — Claude could not fix this one"

    # Mark as resolved in Sentry so we don't retry
    # (if the error recurs, Sentry will automatically reopen it)
    curl -s -X PUT \
      -H "Authorization: Bearer $SENTRY_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"status": "resolved"}' \
      "$SENTRY_API_BASE/issues/$ISSUE_ID/" > /dev/null

    echo "  Sentry issue resolved (no fix needed — if it recurs, Sentry will reopen)"
  fi

  # Clean up worktree
  git -C "$REPO_DIR" worktree remove "$WT_PATH" --force 2>/dev/null || rm -rf "$WT_PATH"
  echo "  Worktree cleaned up"

done

# Clean up empty worktree dir
rmdir "$WORKTREE_DIR" 2>/dev/null || true

echo ""
echo "Done."
