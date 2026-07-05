#!/usr/bin/env bash
# DeskFlow — Commit, push, validate CI + deploy
# Monitoring is non-blocking: failures are reported but don't break the pipeline
set -euo pipefail

REPO="genilsuarez/deskflow"
WORKFLOW_CI="CI Validate"
WORKFLOW_CD="CD Deploy"
BRANCH="main"
TIMEOUT=180
INTERVAL=10
WARNINGS=()

echo "📦 DeskFlow"

# ─── Commit & Push ──────────────────────────────────────────────────────────────

if [ -n "$(git status --porcelain)" ]; then
  echo "🔄 Committing changes..."
  git add -A
  SUMMARY=$(git diff --cached --stat | tail -1)
  git commit -m "chore: update — $SUMMARY"
  echo "🔄 Pushing to remote..."
  git push
else
  echo "✅ Working directory clean"
  git fetch --quiet origin "$BRANCH"
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "🔄 Pushing unpushed commits..."
    git push
  fi
fi

# ─── Monitor CI/CD (non-blocking) ──────────────────────────────────────────────

COMMIT_SHA=$(git rev-parse HEAD)

wait_workflow() {
  local WORKFLOW_NAME="$1"
  local ELAPSED=0

  echo "🔍 Waiting for $WORKFLOW_NAME..."
  sleep 5

  while [ $ELAPSED -lt $TIMEOUT ]; do
    RUN=$(gh run list --repo "$REPO" --workflow "$WORKFLOW_NAME" --branch "$BRANCH" --limit 5 --json databaseId,status,conclusion,headSha \
      --jq "[.[] | select(.headSha == \"$COMMIT_SHA\")] | .[0]" 2>/dev/null || echo "")

    if [ -n "$RUN" ] && [ "$RUN" != "null" ]; then
      STATUS=$(echo "$RUN" | jq -r '.status')
      CONCLUSION=$(echo "$RUN" | jq -r '.conclusion')
      RUN_ID=$(echo "$RUN" | jq -r '.databaseId')

      if [ "$STATUS" = "completed" ]; then
        if [ "$CONCLUSION" = "success" ]; then
          echo "✅ $WORKFLOW_NAME passed"
          return 0
        else
          echo "⚠️  $WORKFLOW_NAME failed (conclusion: $CONCLUSION)"
          echo "   → gh run view $RUN_ID --repo $REPO --web"
          return 1
        fi
      fi
    fi

    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    printf "   [%3ds] waiting...\n" "$ELAPSED"
  done

  echo "⚠️  $WORKFLOW_NAME — timeout after ${TIMEOUT}s"
  return 1
}

if ! wait_workflow "$WORKFLOW_CI"; then
  WARNINGS+=("$WORKFLOW_CI")
fi

if ! wait_workflow "$WORKFLOW_CD"; then
  WARNINGS+=("$WORKFLOW_CD")
fi

# ─── Report ─────────────────────────────────────────────────────────────────────

echo ""
if [ ${#WARNINGS[@]} -eq 0 ]; then
  echo "✅ DeskFlow — OK"
else
  echo "✅ DeskFlow — deployed (with warnings)"
  for w in "${WARNINGS[@]}"; do
    echo "   ⚠️  $w"
  done
fi
