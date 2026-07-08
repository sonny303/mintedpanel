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

_None._

## Resolved

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
