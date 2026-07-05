# Profile-Read Audit Decision — SS Runbook

Owner: SS · Deadline: before extension M1 (first real traffic to the profile endpoint)
Source: `docs/R1-GO-LIVE-FINDINGS.md` → "MCP review" item 5 (lane 1, PR #28)

---

## Lane 1 context (where this comes from)

Lane 1 (`claude/r1-golive-verification`, merged as **PR #28** on 2026-07-05) was the
final verification pass before the July 7 customer-2 go-live:

- Build health, all 20 routes rendered (admin + billing) via the mocked-Supabase
  Playwright harness, layout checks at 390/1280/1440px — all green. Zero open P0s.
- UI-layer fixes shipped in the PR (billing deep-link backstops, cache clear on
  event-driven sign-out, silent-mutation toast, error/empty states, date formats,
  pill consolidation, design drift).
- Anything needing service-layer or SQL changes was **deliberately not executed**
  (lane guardrail) and parked in the findings doc's "MCP review" section.
- CI was green on the PR; the post-merge production deploy's org-isolation gate
  ran and passed (run #14 on `main`, job "Provider API org isolation" → success).

This runbook covers the one item that needs an **SS decision** before anyone can
execute: whether reads of `GET /api/providers/:id/profile` get audited.

**Why it matters:** that endpoint is the most PHI-dense response in the system
(SSN last-4, DOB, home address — unmasked by design for the extension's form
fill). Today **nobody records that a read happened.** The post-gate package
flagged the decision and set a default of "log reads" if undecided. The DB's
`audit_log.action_type` check constraint does not currently allow a `READ`
value, so Option A needs a small migration before the code can land.

---

## Step 1 — SS makes the call

- **Option A — audit profile reads** _(the package's default)_.
  Every profile fetch writes one `audit_log` row: who, which provider, when —
  metadata only, never the PHI values. Cost: one insert per fill + the
  check-constraint migration. Pick this if "who looked at provider PHI and
  when" must be answerable during an audit.
- **Option B — rely on `fill_sessions` as the access record.**
  No DB or code change; `POST /api/fill-events` already logs completed fills.
  Gap: a profile can be _read_ without a fill event ever being posted
  (abandoned fill, token misuse, extension bug) and that read leaves no trace.

If **B** → skip to Step 4. If **A** → continue in order. **Order matters:**
the DB change (Step 2) must land before the code (Step 3) deploys — the code
fails closed, so a `READ` audit row rejected by the old constraint would 500
every profile read.

---

## Step 2 — paste into **chat Claude** (claude.ai, Supabase MCP connected)

```
Context: Minted Panel, hosted Supabase project fkvuhfsqcmujywzgczmc ("openpanel").
SS has decided: profile reads on GET /api/providers/:id/profile WILL be audited
(post-gate package decision, default "log reads"). Your job is the hosted DDL
only — a Claude Code lane will mirror it in the repo and write the server code
afterward. audit_log is append-only; this change is additive.

1. Inspect the current check constraint on public.audit_log.action_type:
   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.audit_log'::regclass;
   Note the exact constraint name and the exact existing value list
   (expected: CREATE/UPDATE/DELETE/STATUS_CHANGE/TOUCH_LOGGED/TERMINATION —
   trust what you read, not this list).
2. Via apply_migration (name: add_read_to_audit_action_type), in one
   migration: ALTER TABLE public.audit_log DROP CONSTRAINT <exact name>;
   then ADD CONSTRAINT with the same name and the same value list PLUS 'READ'.
   Preserve every existing value verbatim. No other changes — do not touch
   rows, RLS, or other columns.
3. Verify: re-run the pg_constraint query and confirm 'READ' is in the
   definition; run a SELECT count(*) FROM audit_log to confirm the table is
   untouched.
4. Reply with: the constraint name, the exact final SQL you applied, and the
   verification output. The Claude Code lane needs that SQL verbatim to
   create the matching repo migration file.
```

---

## Step 3 — paste into a **Claude Code** session (new lane), after Step 2 succeeds

Replace the `<PASTE ...>` line with the SQL chat Claude returned in Step 2.

```
Read CLAUDE.md, docs/migration-baseline.md, src/server/guard.ts,
src/server/extensionRoutes.ts, and src/services/providerProfile.ts first.

Context: SS decided profile reads are audited. Chat Claude has ALREADY applied
the check-constraint change to the hosted DB (audit_log.action_type now allows
'READ'). This lane mirrors it in the repo and writes the code.

1. New migration file supabase/migrations/<timestamp>_add_read_to_audit_action_type.sql
   containing exactly this SQL (already live on hosted — do NOT re-apply via MCP):
   <PASTE THE EXACT SQL CHAT CLAUDE RETURNED>
   Never edit the baseline or archived migrations. A constraint change does not
   alter generated types; do not regenerate types.ts.
2. In the GET /api/providers/:id/profile handler path, after the provider is
   resolved and org-verified, write one audit row via the guard ctx's
   writeAudit closure: action_type 'READ', entity type provider, entity id =
   provider id. Payload is metadata ONLY — provider id, requested ?state, and
   nothing from the response body. Never log or store any resolved token
   values (this is the most PHI-dense endpoint in the system).
3. Fail-closed: keep writeAudit's throw-on-failure semantics — if the audit
   insert fails, the profile request fails (500 via the existing non-GuardError
   path). State this in a comment.
4. Tests: extend the handler/service tests (query-shape fake, same pattern as
   src/server/extensionRoutes.test.ts / src/services/providerProfile.di.test.ts):
   a successful profile read writes exactly one READ audit row with no PHI in
   the payload; an audit failure surfaces as 500 and no body is returned.
5. Response contract unchanged ({ data, error, meta }, Cache-Control:
   no-store). No gate changes (no new route, isolation unchanged).
6. Guardrails: no other service changes, no new dependencies. Update
   CLAUDE.md's line saying profile reads are NOT audited. Targeted test files
   only; PR it; stop when CI is green.
```

---

## Step 4 — SS closes the loop (either option)

1. **Option A:** merge the Step 3 PR when CI is green, then glance at Actions —
   the merge's production deploy fires the org-isolation gate automatically;
   **red = stop-ship.** Optionally curl the profile endpoint once with a KFP
   JWT and confirm a `READ` row landed in `audit_log`.
2. **Option B (or after A ships):** record the decision so it stops being
   "pending" — one line in `minted-panel-release-plan.md` and fix the CLAUDE.md
   sentence that says the decision is open. Any Claude session can do it as a
   doc-only PR with this paste:

   ```
   Record the profile-read audit decision as <A/B, one sentence> in
   minted-panel-release-plan.md's decisions, and update CLAUDE.md's
   profile-endpoint note that says the SS decision is pending. Doc-only PR.
   ```

---

## Also on the SS plate (unrelated to this decision, from the post-gate package)

- Rotate `testsouthpark@minted.com`'s password (`Orange81` sat in chat history)
  and update the `SOUTHPARK_USER_PASSWORD` GitHub secret afterward.
- Branch protection on `main`: require PR review + checks `build`,
  `Migration dry-run`, `Playwright smoke`.
