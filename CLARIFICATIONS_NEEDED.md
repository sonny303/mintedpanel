# Clarifications Needed

Open roadblocks found during epic review that require a PM decision. The
reviewing agent adds entries here instead of guessing; resolved entries move to
the Resolved section with the decision recorded.

Format per entry:

```
## [eX.X] <short title> — OPEN | RESOLVED (YYYY-MM-DD)
- **Issue:** what is contradictory or missing
- **Impact:** what is blocked
- **Options:** (optional) proposed resolutions
- **Decision:** (when resolved)
```

## Open

## [e0.5] BD-1 — Unauthenticated recipient access model — OPEN (default recommended)

- **Issue:** E0.5's premise is an external recipient submitting data with NO
  account. Every data path today requires an authenticated session under
  org-scoped RLS. This is the first Stage 0 surface to cross the trust boundary.
- **Impact:** Forks the enabler design (TE-3). Blocks E0.5 build until chosen.
- **Options:** (a) RECOMMENDED: public token-validated route `/capture/:token`
  backed by `SECURITY DEFINER` RPCs that hash-validate the token and read/write
  only the single authorized party — no anonymous GoTrue session, no login
  (consistent with the E0.0 "no login" default). (b) mint an anonymous Supabase
  session per link (heavier; not recommended for Stage 0).
- **Decision:** pending PM.

## Resolved

## [e0.5] BD-2 — Email delivery in Stage 0 — RESOLVED (2026-07-09)

- **Issue:** Nothing in the stack sends application email (GoTrue = auth mail
  only; no transactional provider). AGENTS.md forbids new deps without
  justification. The epic's Dependencies say "email delivery service … not
  stub," conflicting with the Stage 0 no-new-infra posture.
- **Impact:** F0.5.4 delivery mechanism. Does NOT block the rest of E0.5.
- **Options:** (a) RECOMMENDED: generate the link + render the exact email copy
  for P1 to copy/send — no send infra; F0.5.4 content is testable as rendered
  template text. (b) integrate a transactional provider (Resend/Postmark/SES) +
  domain verification — a new external dependency.
- **Decision:** (a) — PM confirmed. Stage 0 renders copy-able email text only;
  no send infra. Real transactional sending is a separate future decision.

## [e0.4] "Flag orgs as inactive" vs the e0.0 locked no-lifecycle-label rule — RESOLVED (2026-07-09)

- **Issue:** E0.4 F0.4.2 requires the all-inactive Portfolio fallback to show
  "all orgs visible/flagged" as inactive. E0.0's locked decision says the
  lifecycle state is "never surfaced to the Credentialing Manager as a status
  label."
- **Impact:** None if the default holds; E0.4 builds on it.
- **Options:** (a) DEFAULT, assumed: in the all-inactive fallback state ONLY,
  inactive orgs render under an **"Inactive" group heading** — the same grouping
  mechanism as the existing "Prospects"/"In motion" Portfolio sections, which is
  already user-visible lifecycle grouping. No per-org status pill/label anywhere;
  the E0.0 rule holds everywhere else. (b) Per-org "Inactive" pills — rejected
  as written: directly violates the locked decision. (c) No labeling at all,
  just an empty-state message + create CTA — loses "all orgs visible."
- **Decision:** PM confirmed option (a) on 2026-07-09. In the all-inactive
  fallback only, inactive orgs render under an "Inactive" group heading — the
  same grouping mechanism as the existing "Prospects"/"In motion" Portfolio
  sections. No per-org status pill/label anywhere; the E0.0 no-label rule holds
  everywhere else.

## [e0.3] Cross-org parties are an exception to the org-RLS convention — RESOLVED (2026-07-09)

- **Issue:** F0.3.4 requires one Party record reusable across orgs, so `parties`
  cannot carry a single `org_id` — an exception to the repo-wide "every table
  org-scoped by RLS" convention (AGENTS.md).
- **Impact:** None if the default holds; build proceeds on it.
- **Options:** (a) DEFAULT, assumed: `parties` has no `org_id`; RLS grants
  access where the caller has a membership in an org the party is assigned to
  (via `party_role_assignments`, which IS org-scoped as usual) or the caller
  created the party. (b) Org-scoped parties with duplication per org — rejected:
  defeats the entire purpose of E0.3.
- **Decision:** PM confirmed option (a) on 2026-07-09. `parties` carries no
  `org_id`; RLS grants access via assignment membership (org-scoped
  `party_role_assignments`) or `created_by`. The documented, tested exception
  to the org-RLS convention stands as implemented in
  `20260709120000_party_model_foundation.sql`.

## [e0.1 + e0.2] One party model for owner + CRM contacts — RESOLVED (2026-07-08)

- **Issue:** No party/role or org-contact tables exist in the schema. Three
  epics describe person records: E0.1 owner capture ("Full Party model"), E0.2
  customer/sales-rep contacts, E0.3 Full Party model (not yet delivered).
- **Impact:** Blocks the E0.1/E0.2 schema design; build proceeds on the default
  once confirmed.
- **Options:** (a) DEFAULT, assumed: E0.1 introduces a minimal additive
  foundation — `parties` (org-scoped person: name, email; E0.2 adds phone +
  split address) + `org_party_roles` (role check list: `owner`, then
  `customer_contact`, `sales_rep`) — which E0.3 extends rather than replaces.
  (b) Resequence: deliver E0.3 (Full Party model) before E0.1/E0.2. (c) Separate
  throwaway storage per epic (owner columns on `organizations`, a distinct
  `org_contacts` table) — rejected: E0.3 would strand both.
- **Decision:** PM confirmed option (a) on 2026-07-08. Additionally, E0.3
  (Full Party model) is nearly done — builds are queued so E0.1–E0.3 are
  reviewed together before hand-off, letting the party model be validated
  across all three epics up front.

## [e0.2] seed-universe.md lacks customer-contact fixtures — RESOLVED (2026-07-08)

- **Issue:** E0.2 FR-5 requires demo/test contacts "per seed mapping", and its
  UX notes name examples (Coach Eric Taylor, Kitty Forman), but
  `seed-universe.md` has no per-org customer-contact table (names, emails,
  phones, split addresses) and no Zeb Loewenstine entry.
- **Impact:** E0.2's seed + Playwright verification has no fixture source.
- **Decision:** PM directed the reviewer to close the gap directly (2026-07-08).
  Devin added the "CRM contact fixtures (E0.2)" section to `seed-universe.md`
  (Zeb Loewenstine sales-rep row + per-org customer contacts, `.test` emails,
  555 numbers, split addresses).

## [e0.1] Duplicate guard: hard block vs seed-universe "soft warning" — RESOLVED (2026-07-08, reviewer)

- **Issue:** `seed-universe.md` TS-6 says "duplicate soft warning"; E0.1 F0.1.4
  explicitly says hard block, no override.
- **Decision:** E0.1 wins (later, explicitly PM-aligned): hard block on exact
  case-/space-insensitive name match; "similar city/state" matching stays
  optional and is not implemented in Stage 0. The TS-6 fixture pair have
  different normalized names and coexist as seeds; TS-6 is tested by attempting
  to create an org with the same normalized name. `seed-universe.md` reviewer
  notes record the correction.

## [e0.0] "No login" locked decision vs Supabase RLS — RESOLVED (2026-07-08)

- **Issue:** E0.0 locks "No login, no login roles, no default landing … no auth
  ceremony," but every data read/write runs through org-scoped RLS, which
  requires an authenticated Supabase session. Login cannot be literally removed
  without replacing the data layer.
- **Impact:** None if the intended meaning is UX-level; blocks nothing today.
  Build proceeds on the default below.
- **Options:** (a) DEFAULT, assumed: keep the existing session bootstrap
  (`/login`, persisted session) beneath the shell; the redesigned UX simply has
  no login ceremony, role gates, or landing gate. (b) Literal removal — would
  require a shared anon/service data path, a major architecture change out of
  Stage 0 scope.
- **Decision:** PM confirmed option (a) on 2026-07-08. The existing session
  bootstrap stays beneath the shell; the redesigned UX has no login ceremony,
  role gates, or landing gate.

## [e0.0] Shared "not yet available" empty-state component — RESOLVED (2026-07-08)

- **Issue:** OQ-3 — whether one shared composition component (existing
  primitives only) is allowed under the "no new components" hard rule.
- **Decision:** PM confirmed on 2026-07-08: allowed. One shared composition
  component may be built from existing primitives for the reserved-route empty
  state.

## [e0.0] "Get started" sidebar persistence (OQ-2) — RESOLVED (2026-07-08)

- **Decision:** PM confirmed on 2026-07-08: "Get started" is always present.
  Revisit only if the PM reopens it.
