#!/bin/bash
# SessionStart hook — runs the checked-in session bootstrap (efficiency audit
# 2026-07-16, P2.1) in Claude Code on the web sessions only. Local sessions
# opt in by hand: node scripts/bootstrap-session.mjs
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

node "$CLAUDE_PROJECT_DIR/scripts/bootstrap-session.mjs"
