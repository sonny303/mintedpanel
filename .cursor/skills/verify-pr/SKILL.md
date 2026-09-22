---
name: verify-pr
description: >-
  Adversarial verify-and-fix workflow for pull request code: restates behavior
  and assumptions, hunts failure modes, writes minimal exposing tests, fixes only
  proven failures, then drafts a careful PR description. Use when the user asks
  to review a PR, review this PR, PR review, review the pull request, verify a
  PR, verify PR, run verify-pr, adversarial review a change, or attach /verify-pr.
---

# Verify PR

Run this skill on the code under review (diff, PR, or named files). Follow the
five steps **in order**. Do not skip ahead. Do not soft-pedal Step 2.

Use the user's wording below **verbatim** as the step prompts. Do not paraphrase,
soften, expand, or add unrequested headings around them.

## Steps

**Step 1:** Before anything else, explain this code back to me as if I did not write the code. What does it do, what does it assume about its inputs and environment, and what does it silently not handle?

**Step 2:** You are now a reviewer who believes this code has a bug and has to find it. List every way it could fail: bad inputs, empty cases, concurrency, error paths, wrong assumptions about the surrounding code. Rank by likelihood. No reassurance.

**Step 3:** For the top three risks in your list, write a minimal test that would expose each one. If a test would pass on the current code, say so and explain why the risk is not real.

**Step 4:** Fix only the failures those tests found. Show the diff, not the whole file, and for each change say which test it satisfies. Do not refactor anything else.

**Step 5:** Write the pull request description a careful reviewer would want: what changed, what the code assumes, what it does not handle by design, and what you would still want a human to check.

## Execution notes

- Scope to the change under review unless the user widens it.
- Prefer the repo's existing test runner and patterns for Step 3 tests.
- If the change has no executable product code, Step 3 tests assert skill/doc contract invariants instead of inventing product tests.
- If the user explicitly asked for Bugbot or security-review, do not let this skill displace that specialty review — run those instead (or after, only if asked).
- If Step 3 finds no real failures, Step 4 is a no-op — say so and still complete Step 5 for the existing change.
- Keep Step 5 honest about residual human checks (PHI, RLS/`guard.ts`, wire contracts, migrations).
