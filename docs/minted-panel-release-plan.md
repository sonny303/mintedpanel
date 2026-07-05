# Minted Panel — release plan (decision record)

The full release plan predates the repo and was never checked in (see the
scope note in `docs/phase-0-audit.md`). This file was created 2026-07-05 as
the in-repo home of the release plan's **decisions section** so decisions are
recorded where sessions can read them. `CLAUDE.md` mirrors the locked
decisions — when a decision is added or changed here, update the mirror.

## Decisions

### Locked decisions (2026-07-04)

1. **Three products, one backend.** API core, Chrome extension, and a future
   workflow UI are separate products. The current app UI keeps running on
   direct Supabase + RLS. Do not migrate current screens to the API.
2. **Consumer-pulled API surface.** Routes get built only when a real
   consumer pulls them. The extension pulls three. Cases/tasks/payers routes
   wait for their consumer.
3. **R1 exit criteria revised.** "Zero direct Supabase calls in frontend" and
   RLS lockout deferred to the workflow-UI product. Dual data paths accepted
   deliberately: current UI guarded by RLS, API guarded by guard.ts + the
   gate. Old Chunks 5-9 parked, not deleted.
4. **The gate is the wall.** The service key bypasses RLS on API paths;
   guard.ts is the only isolation enforcement there. Every new resource route
   adds gate assertions before merge. Red gate = stop-ship.
5. **Server misconfig returns 500, never 401.** (PR #24.)
6. **Portal field maps are a shared catalog.** `org_id NULL` = global, org
   rows = overrides. Endpoint contract reflects this.

### Profile-read audit (2026-07-05)

~~Profile reads on `GET /api/providers/:id/profile` are NOT separately audited;
`fill_sessions` (`POST /api/fill-events`) is the access record. Decided by SS
2026-07-05. Revisit if a customer or audit requires read-level PHI access
logs.~~

**Superseded same day** by R2 Workbench locked decision 4 (2026-07-05):
profile reads ARE audited — one `audit_log` row per successful read
(`action_type 'READ'`, actor, provider id, route; never the response body or
any token value). Migration `20260705190000_audit_log_read_action_type.sql`
added `READ` to the `audit_log.action_type` check constraint. `fill_sessions`
remains the fill-attempt record; `audit_log` is now also the read record.
