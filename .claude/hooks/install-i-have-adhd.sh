#!/bin/bash
# SessionStart hook — installs the i-have-adhd Claude Code plugin
# (https://github.com/ayghri/i-have-adhd) so `/i-have-adhd` is available
# without a manual `claude plugin marketplace add` + `claude plugin install`
# each web session. Separate from session-start.sh (the npm/env bootstrap)
# so the two concerns stay independently readable and removable.
# Remote (web) sessions only. Both commands are idempotent (exit 0, no-op if
# already added/installed); failures are swallowed so a transient network
# issue never blocks the session from starting.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

claude plugin marketplace add ayghri/i-have-adhd >/dev/null 2>&1
claude plugin install i-have-adhd@i-have-adhd >/dev/null 2>&1
exit 0
