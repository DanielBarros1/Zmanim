#!/bin/bash
# Pre-push deployment validation — mirrors exactly what Docker does in CI.
# Runs automatically before every `git push` via PreToolUse hook.
#
# Steps (same order as Dockerfile):
#   1. npm run build --workspace=shared  (tsc on shared types)
#   2. cd client && npx tsc -b           (strict project-references check)
#   3. cd server && npx tsc --noEmit     (server type check)
#
# Outputs a deny JSON to stdout on failure so Claude Code blocks the push.
# Build output goes to stderr so it's visible but doesn't confuse the JSON parser.

fail() {
  local msg="$1"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$msg"
  exit 1
}

echo "🔍 Pre-push check 1/3: building shared..." >&2
npm run build --workspace=shared 1>&2 \
  || fail "shared build failed — fix before pushing (npm run build --workspace=shared)"

echo "🔍 Pre-push check 2/3: client tsc -b..." >&2
(cd client && npx tsc -b 1>&2) \
  || fail "client TypeScript error — fix before pushing (cd client && npx tsc -b)"

echo "🔍 Pre-push check 3/3: server tsc..." >&2
(cd server && npx tsc --noEmit 1>&2) \
  || fail "server TypeScript error — fix before pushing (cd server && npx tsc --noEmit)"

echo "✅ All pre-push checks passed." >&2
