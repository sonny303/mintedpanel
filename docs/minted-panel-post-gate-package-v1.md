# Minted Panel — Post-Gate Package v1.1

Date: 2026-07-04 (v1.1 same day: implementation considerations + testing matrix folded in; Prompt 3 corrected after live-DB verification)
Context: Org-isolation gate is green on production (run #7). This package covers the next three Claude Code prompts, one MCP-side seed, two doc updates, and the validation plan.
Execution: Claude Code (prompts 1-3), chat Claude + Supabase MCP (seed step), SS (doc placement, watching runs).

---

## ⚠️ Staleness rule — read before every prompt

Prompts are written against `main` sha `617fb9b` (PR #23). They are sequenced. **Each merged PR can invalidate the prompts after it.**

- After Prompt 1 merges, re-check Prompts 2 and 3 against what landed before using them.
- If a prompt no longer matches the code, do not patch it from memory. Bring the merged PR summary back to chat for a regen.
- Read prompts verbatim from this file at time of use. Never reconstruct.
- Branch protocol: PRs are squash-merged. Before each prompt:
  `git fetch origin main && git checkout -B claude/phase-0-api-audit-yk345v origin/main`
  then force-with-lease push.

---

## Verified against the live DB (2026-07-04)

These facts are load-bearing for Prompt 3. Do not re-derive from memory.

1. `get_sop_field_tokens()` takes **no arguments**, is **SECURITY DEFINER**, returns **jsonb**. It is the token **catalog** (132 tokens across 9 tables: which fields exist and where they live), not per-provider values. Value resolution is the server's job.
2. `portal_field_maps` has **24 rows, all with `org_id = NULL`**. Interpretation: NULL = shared catalog (portal selectors are portal-specific, not org-specific). Org-scoped rows are overrides. Neither KFP nor South Park has org-specific rows today.
3. `portal_field_maps` columns: `org_id, portal_key, url_pattern, page_step, map_type, selector, selector_fallbacks (jsonb), source, token, hardcoded_value, transform, field_type, notes, status, created_at, updated_at`.
4. `fill_sessions` columns: `org_id, case_id, provider_id, portal_key, fill_mode, started_at, completed_at, fields_filled (int), fields_skipped (jsonb), docs_attached (jsonb), performed_by`. Currently 0 rows.
5. `touches.source` check constraint already includes `'extension'`. No migration needed.
6. Provider counts: KFP 6 (all active), South Park 4 (3 active, 1 onboarding). The gate's count fixtures match the DB.

---

## Prompt 1 — Stop masking config failures as 401 (small PR, do first)

Why: the missing `SUPABASE_SERVICE_ROLE_KEY` surfaced as `401 Unauthorized` on every authenticated route and cost a full debugging cycle. Server misconfig must scream, not impersonate an auth failure.

```
Small fix, one root cause. In src/server/api.ts, the catch block returns
fail(401, "Unauthorized") for any thrown error. That masked a server
misconfiguration (getServiceClient() throwing on missing
SUPABASE_SERVICE_ROLE_KEY) as an auth failure.

1. In the catch: if the error is a GuardError, keep current behavior
   (status + message from the error). If it is NOT a GuardError, return
   fail(500, "Internal server error") and log the real error message and
   stack server-side (console.error is fine on nitro/Vercel).
2. Never leak internal error details in the response body. Envelope stays
   { data, error, meta }.
3. Add/extend a unit test: a handler that throws a plain Error returns 500,
   a handler that throws GuardError(403) returns 403.
No other changes. PR it. Stop when CI is green.
```

---

## Prompt 2 — Promote the gate to run after every production deploy

Why: the gate should fire automatically on every prod deploy, and Claude Code cannot dispatch workflows. Once this lands, Prompt 3's merge triggers its own real-world verification with zero clicks. A `deployment_status` job cannot be a PR required check; its job is post-deploy verification, not PR gating. Keep manual dispatch too.

```
Update .github/workflows/verify-org-isolation.yml:

1. Add an on: deployment_status trigger alongside the existing
   workflow_dispatch. Guard the job: only run when
   github.event.deployment_status.state == 'success' AND the deployment
   environment is production. Verify the actual environment name Vercel
   reports from a past deployment event on this repo rather than guessing.
2. For deployment_status runs, keep hitting API_BASE from repo secrets
   (the production alias), not the event's deployment URL — preview URLs
   sit behind SSO.
3. workflow_dispatch behavior unchanged.
4. Update the workflow's comment block: triggers, what a red run means
   (stop-ship until read), where preflight/DIAGNOSIS output lives.
PR it. Stop when CI is green. After merge, confirm the resulting
production deploy triggered a run automatically.
```

---

## MCP-side seed — REQUIRED BEFORE PROMPT 3's gate assertions. DO NOT EXECUTE IN CLAUDE CODE. Reference only.

Chat Claude runs via Supabase MCP (`execute_sql`): insert **one** South Park-scoped `portal_field_maps` row (dummy portal_key like `sp_test_portal`, benign selector, status inactive/test). Purpose: the "Kansas cannot read South Park field maps" assertion is vacuous while South Park has zero org-scoped rows. Record the new row's id in the workflow's expected-values comment. This row is test fixture data, same standing as the South Park org itself.

---

## Prompt 3 — Chunk 4: extension-facing endpoints (corrected for verified RPC + field-map reality)

```
Read CLAUDE.md, src/server/guard.ts, api.ts, serviceClient.ts, and the
migration/definition of the get_sop_field_tokens() function first. Build
three endpoints on the guard/envelope pattern from the providers pilot.
All require a Bearer JWT, resolve org via guard.ts, and set org scoping
server-side — never trust org_id or performed_by from the request body.

1. GET /api/providers/:id/profile
   Purpose: everything the fill engine needs for one provider, resolved
   server-side. Known facts: get_sop_field_tokens() takes NO arguments,
   is SECURITY DEFINER, returns a jsonb token CATALOG (token -> source
   location metadata), not values. So:
   a. Verify the provider belongs to the caller's resolved org (404 if
      not — same contract the isolation gate proved).
   b. Load the token catalog via the RPC.
   c. Resolve each token's VALUE for this provider by querying the
      catalog's source tables, org-scoped, explicit columns only.
   d. Response: { data: { provider, tokens: [{ token, value }] }, error,
      meta }. Set Cache-Control: no-store. Never log the response body —
      this is the most PHI-dense endpoint in the system (SSN, DOB,
      address, unmasked by design for form fill).
   If the catalog's metadata is insufficient to resolve values
   mechanically, STOP and report what's missing instead of improvising a
   mapping. That goes back to chat for a spec decision.

2. GET /api/portal-field-maps?portal_key=...
   Shared-catalog pattern: return rows WHERE org_id IS NULL (global
   catalog) OR org_id = caller's org (org overrides). Optional portal_key
   filter. Explicit column list. Another org's org-scoped rows must never
   appear.

3. POST /api/fill-events
   Writes one row to fill_sessions. Accepts: case_id, provider_id,
   portal_key, fill_mode, started_at, completed_at, fields_filled,
   fields_skipped, docs_attached, and a client-generated idempotency id
   (use it as the row's primary key or a unique column; duplicate POSTs
   return the existing row, not a second insert). Server sets org_id from
   the resolved org and performed_by from the JWT user id. Validate
   case_id and provider_id belong to the caller's org before insert (404
   on mismatch). Optional task_id: mark that task complete, org-checked,
   through the same service + audit pattern the app uses (audit row
   required, writeAudit throws on failure).

4. CORS on /api/*: env allowlist API_CORS_ORIGINS (comma-separated,
   default empty = no CORS headers), and answer OPTIONS preflights
   (Authorization header always triggers one). Document in CLAUDE.md.

5. Extend scripts/verify-org-isolation.mjs with assertions:
   a. testkansas GET /api/portal-field-maps: response contains the global
      (NULL-org) rows and does NOT contain the seeded South Park test row
      (id provided in the workflow comment).
   b. testkansas GET /api/providers/{south park id}/profile -> 404.
   c. testkansas POST /api/fill-events with a South Park provider_id ->
      rejected (404), and assert via a follow-up that nothing was written
      (the reject must happen before insert).
   Keep the read-only-where-possible discipline: the only POST uses a
   payload the server must reject.

6. Extend the local mock harness (mock-and-run pattern) to serve all
   three endpoints with pass and leak modes, so the changes are
   validated in-sandbox before merge. The real gate fires automatically
   on the production deploy after merge (deployment_status, Prompt 2).

7. Contract + integration tests per endpoint, targeted files only.
PR it. Stop when CI is green.
```

---

## Implementation considerations (beyond the prompts)

1. **Profile endpoint audit decision (SS):** reads aren't audited today. This endpoint returns full PHI. Decide before extension M1: log profile reads (lightweight audit row) or rely on fill_sessions as the access record. Default if undecided: log reads.
2. **Extension architecture note for M0 (goes in spec v1.2, already added):** all API calls from the background service worker with `host_permissions` for the API domain. Content scripts never hold tokens. This makes CORS mostly moot for the extension itself; the allowlist still protects against random web pages.
3. **JWT lifetime:** Supabase access tokens expire (~1h). Extension M0 must use supabase-js session handling for refresh, storing the session in `chrome.storage.session` (memory-backed), not `local`.
4. **Field-map design decision (made, revisit if wrong):** NULL org = shared catalog, org rows = overrides. Alternative was backfilling all 24 rows to KFP; rejected because selectors are portal-truths, not org-truths, and customer 2 would need duplicates.
5. **deployment_status ordering is load-bearing:** Prompt 2 before Prompt 3, so Chunk 4's merge triggers its own real verification. Claude Code cannot dispatch runs.
6. **Gate stays (nearly) read-only:** the one POST assertion is a must-reject payload. Nothing the gate does writes to production data.

## Testing & validation matrix

| Prompt | In-sandbox proof (Claude Code)                                                      | Real-world proof                                                                                                                                                                                        | Who watches                  |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1      | Unit tests: plain Error -> 500, GuardError -> its status                            | Post-merge deploy stays green on the gate; /api/health 200                                                                                                                                              | SS reads the auto/manual run |
| 2      | CI green on the workflow edit                                                       | The merge's own production deploy fires the gate with no clicks; confirm no run fires for preview deploys                                                                                               | SS checks Actions once       |
| Seed   | n/a (MCP)                                                                           | SELECT confirms 1 South Park row; id recorded in workflow comment                                                                                                                                       | chat Claude                  |
| 3      | Extended mock harness: pass mode all green, each leak mode goes red; contract tests | Auto-fired gate run: all prior assertions + 3 new ones green. Then one manual curl-with-JWT spot check of /profile for a KFP provider (SS or chat Claude reads values for sanity against the SOP guide) | SS + chat Claude             |

**What a legit red looks like after Prompt 3:** a 500 on /profile (likely value-resolution gap -> regen the resolver spec), or the field-maps assertion failing because the seeded row id in the workflow comment is stale. **What a real leak looks like:** South Park values in any Kansas response body. Stop-ship, no exceptions.

---

## Doc A — Extension build spec: v1.2 delta

Apply as a delta on top of spec v1.1. v1.1 sections referencing direct Supabase access are superseded.

### What changes

| v1.1 said                                               | v1.2 says                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Extension calls `get_sop_field_tokens()` RPC directly   | Extension calls `GET /api/providers/:id/profile`; the server resolves token values                 |
| Extension reads `portal_field_maps` via Supabase client | Extension calls `GET /api/portal-field-maps?portal_key=...` (global catalog + org overrides)       |
| Extension writes `fill_sessions` via Supabase client    | Extension calls `POST /api/fill-events` with an idempotency id                                     |
| Shared Supabase session for data access                 | Supabase auth ONLY mints the JWT. All data flows through `/api` with `Authorization: Bearer <jwt>` |

### What stays

- Milestones: M0 shell/auth -> M1 BCBS KS fill -> M2 attachments -> M2.5 PDF fill -> M3 CAQH -> M4 generalization.
- Token model, `portal_field_maps` schema, `fill_sessions` logging model. Only the transport changes.

### New rules

1. Extension ships with Supabase URL + anon key for sign-in only. Never the service key. Never queries tables.
2. All API calls from the background service worker (`host_permissions` for the API domain). Content scripts receive fill values via messaging; tokens never touch page context.
3. Session in `chrome.storage.session`; supabase-js handles refresh.
4. Org resolution is server-side via guard.ts. Single-org users send no `x-org-id`; multi-org users send it and the guard verifies membership (CI-tested spoof path).
5. `API_CORS_ORIGINS` must include `chrome-extension://<id>` once the id exists.
6. `touches.source = 'extension'` already permitted (verified 2026-07-04). Use it if M1 logs touches.
7. **M1 prerequisite:** BCBS KS rows must exist in `portal_field_maps` (global, org_id NULL) before M1 can fill anything. Verify presence as M1 step zero.

---

## Doc B — Release plan + CLAUDE.md updates (locked decisions)

Append to `minted-panel-release-plan.md`; mirror Locked Decisions into CLAUDE.md.

### Locked decisions (2026-07-04)

1. **Three products, one backend.** API core, Chrome extension, and a future workflow UI are separate products. The current app UI keeps running on direct Supabase + RLS. Do not migrate current screens to the API.
2. **Consumer-pulled API surface.** Routes get built only when a real consumer pulls them. The extension pulls three. Cases/tasks/payers routes wait for their consumer.
3. **R1 exit criteria revised.** "Zero direct Supabase calls in frontend" and RLS lockout deferred to the workflow-UI product. Dual data paths accepted deliberately: current UI guarded by RLS, API guarded by guard.ts + the gate. Old Chunks 5-9 parked, not deleted.
4. **The gate is the wall.** The service key bypasses RLS on API paths; guard.ts is the only isolation enforcement there. Every new resource route adds gate assertions before merge. Red gate = stop-ship.
5. **Server misconfig returns 500, never 401.** (Prompt 1.)
6. **Portal field maps are a shared catalog.** `org_id NULL` = global, org rows = overrides. Endpoint contract reflects this.

### Sequencing after this package

Gate green (done) -> Prompt 1 -> Prompt 2 -> MCP seed -> Prompt 3 -> extension M0-M1 from spec v1.2. The extension filling one real BCBS KS application is the next demo-able milestone and the API's first true contract test.

---

## SS housekeeping (nothing blocks the prompts)

- [x] Decide: audit profile reads, or rely on fill_sessions (default: audit them). — Decided by SS 2026-07-05: rely on fill_sessions; profile reads not separately audited. Recorded in `docs/minted-panel-release-plan.md`.
- [ ] Rotate `testsouthpark@minted.com`'s password (`Orange81` sat in chat history); update `SOUTHPARK_USER_PASSWORD` secret after.
- [ ] Branch protection on `main`: require PR review + checks `build`, `Migration dry-run`, `Playwright smoke`.
- [ ] Push this file to repo `docs/` so prompts are read verbatim at time of use.
- [ ] Brand kit rename (OpenPanel -> Minted Panel) still on the backlog.
