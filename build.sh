#!/usr/bin/env bash
# DeskFlow — Commit, push, validate CI + deploy
set -euo pipefail

REPO="genilsuarez/deskflow"
WORKFLOW_CI="CI Validate"
WORKFLOW_CD="CD Deploy"
BRANCH="main"
TIMEOUT=300
INTERVAL=10

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
  # Check if local is ahead of remote
  git fetch --quiet origin "$BRANCH"
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "🔄 Pushing unpushed commits..."
    git push
  fi
fi

# ─── Wait for CI Validate ───────────────────────────────────────────────────────

echo "🔍 Waiting for CI Validate..."
COMMIT_SHA=$(git rev-parse HEAD)
ELAPSED=0

# Give GitHub a moment to register the run
sleep 5

while [ $ELAPSED -lt $TIMEOUT ]; do
  RUN=$(gh run list --repo "$REPO" --workflow "$WORKFLOW_CI" --branch "$BRANCH" --limit 5 --json databaseId,status,conclusion,headSha \
    --jq "[.[] | select(.headSha == \"$COMMIT_SHA\")] | .[0]")

  if [ -n "$RUN" ] && [ "$RUN" != "null" ]; then
    STATUS=$(echo "$RUN" | jq -r '.status')
    CONCLUSION=$(echo "$RUN" | jq -r '.conclusion')
    RUN_ID=$(echo "$RUN" | jq -r '.databaseId')

    if [ "$STATUS" = "completed" ]; then
      if [ "$CONCLUSION" = "success" ]; then
        echo "✅ CI Validate passed"
        break
      else
        echo "❌ CI Validate failed (conclusion: $CONCLUSION)"
        echo "   → gh run view $RUN_ID --repo $REPO --web"
        exit 1
      fi
    fi
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  printf "   [%3ds] waiting...\n" "$ELAPSED"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "❌ CI Validate — TIMEOUT after ${TIMEOUT}s"
  exit 1
fi

# ─── Wait for CD Deploy ─────────────────────────────────────────────────────────

echo "🔍 Waiting for CD Deploy..."
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
  RUN=$(gh run list --repo "$REPO" --workflow "$WORKFLOW_CD" --branch "$BRANCH" --limit 5 --json databaseId,status,conclusion,headSha \
    --jq "[.[] | select(.headSha == \"$COMMIT_SHA\")] | .[0]")

  if [ -n "$RUN" ] && [ "$RUN" != "null" ]; then
    STATUS=$(echo "$RUN" | jq -r '.status')
    CONCLUSION=$(echo "$RUN" | jq -r '.conclusion')
    RUN_ID=$(echo "$RUN" | jq -r '.databaseId')

    if [ "$STATUS" = "completed" ]; then
      if [ "$CONCLUSION" = "success" ]; then
        echo "✅ CD Deploy passed"
        echo ""
        echo "✅ DeskFlow — OK"
        exit 0
      else
        echo "❌ CD Deploy failed (conclusion: $CONCLUSION)"
        echo "   → gh run view $RUN_ID --repo $REPO --web"
        exit 1
      fi
    fi
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  printf "   [%3ds] waiting...\n" "$ELAPSED"
done

echo "❌ CD Deploy — TIMEOUT after ${TIMEOUT}s"
exit 1
