#!/bin/bash
# fix-sentry-errors.sh
# Fetches unresolved Sentry errors and runs Claude Code to fix them locally.
# Fixes are committed to the current branch — no PRs, no worktrees.
#
# Setup:
#   1. Generate a Sentry API token: https://sentry.io/settings/account/api/auth-tokens/
#      - Scopes needed: project:read, event:read, event:admin
#   2. Add SENTRY_API_TOKEN=sntryu_... to .env
#   3. Make executable: chmod +x scripts/fix-sentry-errors.sh

set -euo pipefail

SENTRY_ORG="score-26"
SENTRY_PROJECT="app"
SENTRY_API_BASE="https://de.sentry.io/api/0"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

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

# Save issues to a temp file so we can iterate without pipe stdin issues
ISSUES_FILE=$(mktemp)
echo "$ISSUES" | jq -c '.[]' > "$ISSUES_FILE"

FIXED=0
SKIPPED=0

# Read issues from file (not pipe) so subcommands don't steal stdin
while IFS= read -r ISSUE; do
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

  # Fetch latest event for stack trace (redirect stdin from /dev/null to avoid pipe issues)
  LATEST_EVENT=$(curl -s \
    -H "Authorization: Bearer $SENTRY_API_TOKEN" \
    "$SENTRY_API_BASE/issues/$ISSUE_ID/events/latest/" < /dev/null)

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
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Record commit count before Claude runs
  BEFORE_COUNT=$(git -C "$REPO_DIR" rev-list --count HEAD)

  # Run Claude Code locally (stdin from /dev/null so it doesn't consume the loop's input)
  echo "  Running Claude Code..."
  claude --dangerously-skip-permissions -p "
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
4. Run \`bun run tsc --noEmit\` to verify the fix compiles
5. Create a git commit with message: \"fix: $TITLE\"
6. Do NOT push or create a PR — just commit locally

If you cannot determine a fix with confidence, create a commit that adds a comment explaining the issue and what you investigated.
" < /dev/null || true

  # Check if Claude made any commits
  AFTER_COUNT=$(git -C "$REPO_DIR" rev-list --count HEAD)
  if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
    echo "  Fixed! ($(($AFTER_COUNT - $BEFORE_COUNT)) commit(s))"
    FIXED=$((FIXED + 1))

    # Mark issue as resolved in Sentry
    curl -s -X PUT \
      -H "Authorization: Bearer $SENTRY_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"status": "resolved"}' \
      "$SENTRY_API_BASE/issues/$ISSUE_ID/" < /dev/null > /dev/null

    echo "  Sentry issue resolved"
  else
    echo "  No commits made — Claude could not fix this one"
    SKIPPED=$((SKIPPED + 1))
  fi

done < "$ISSUES_FILE"

# Clean up
rm -f "$ISSUES_FILE"

echo ""
echo "Done. Fixed: $FIXED | Skipped: $SKIPPED"
