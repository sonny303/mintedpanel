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

## [e0.1 + e0.2] One party model for owner + CRM contacts — OPEN

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
- **Decision:** _pending PM._

## [e0.2] seed-universe.md lacks customer-contact fixtures — OPEN

- **Issue:** E0.2 FR-5 requires demo/test contacts "per seed mapping", and its
  UX notes name examples (Coach Eric Taylor, Kitty Forman), but
  `seed-universe.md` has no per-org customer-contact table (names, emails,
  phones, split addresses) and no Zeb Loewenstine entry.
- **Impact:** E0.2's seed + Playwright verification has no fixture source.
- **Options:** ChatPRD extends `seed-universe.md` with a customer-contact
  fixture table + Zeb's contact row (recommended); or Devin derives fixtures
  and ChatPRD ratifies.
- **Decision:** _pending._

## Resolved

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
