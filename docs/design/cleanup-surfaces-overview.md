# Cleanup surfaces — design package overview

Three connected in-app surfaces for the cleanup side of Minted Panel:

| # | Surface | Route(s) | Spec | PR |
|---|---------|----------|------|----|
| 1 | Fix-it queue | `/home` section + `/fix-it` | `fix-it-queue-spec.md` | C |
| 2 | Mapping review | `/portals/$portalKey/train` | `mapping-review-spec.md` | B |
| 3 | Portals admin | `/admin/portals` | `portals-admin-spec.md` | A |

High-fidelity mockups (all states, annotated): `docs/design/mockups/cleanup-surfaces.html`
— self-contained, open in any browser. Published copy:
https://claude.ai/code/artifact/d27eff52-687e-44e9-845b-8dfcde631785

**Build order is A → B → C** (portals schema first, training second, queue
last), the reverse of the surfaces' numbering. Each PR is independently
shippable and leaves the app consistent.

## Product principle (locked)

The browser extension is where users **do** tasks; the app is where they
**find and kick off** cleanup. These surfaces never fill forms and never
submit anything — they repair the data that makes fills work.

Non-negotiables carried through all three specs:

- **No timers, no speed mechanics, ever.** No elapsed-time display, no
  cards-per-minute, no streaks, no countdowns.
- **Corrections are celebrated, never penalized.** Saying "No" to a wrong
  guess or overriding a suggestion increments a **good catch** count and is
  thanked in copy. Nothing red, nothing lost.
- **Impact order, never ease.** The Fix-it queue sorts by soonest blocked
  fill; there is no "quick wins" ordering anywhere.

## Shared concepts

### Coverage

For a provider × portal: `auto-fill coverage = resolvable fields / mapped fields`.

- *Mapped fields* = `portal_field_maps` rows for the portal (global + org
  override, `status = 'approved'`).
- *Resolvable* = `source = 'hardcoded'`, or `source = 'token'` and the token
  resolves to a non-empty value for that provider (client-side resolution over
  the same families the SOP resolver reads; v1 scope in the Fix-it spec).
- `source = 'manual'` rows are **counted out of** the denominator's
  "auto-fills" figure and shown as "N stay manual" — visible, never hidden.

Copy pattern everywhere: **"46 of 52 fields auto-fill"**.

### Dictionary

Org-scoped label → token memory (`field_dictionary`, new table). Rows are
`suggested` (created/bumped by mapping decisions), `confirmed` (a human said
"yes, always"), or `rejected` (a human said "no, keep asking" — never guessed
again, and never re-asked).

- A `suggested` row with `seen_count >= 2` produces a **dictionary confirm
  card** in the Fix-it queue.
- A `confirmed` rule makes future matches of that label **high-confidence**
  in mapping review (batched).
- Labels are compared via `normalizeFieldLabel` (new, in
  `src/lib/tokenFormat.ts`): lowercase, trim, collapse inner whitespace,
  strip trailing `:` and `*`.

### Confidence

Per proposed field-map row, resolved client-side at training time:

1. **High** — a `confirmed` dictionary rule matches the normalized label, OR
   the stored `confidence` column ≥ 80.
2. **Medium** — a token suggestion exists (stored `confidence` 40–79, or a
   `suggested` dictionary row matches).
3. **Low** — suggestion below 40 or no suggestion (card opens with the picker).

High-confidence rows batch into one "Confirm all N" screen; medium/low go one
card at a time. The tiers map to badges `High` (green), `Medium` (amber),
`Low` (gray) — pill styling per `src/components/StatusPill.tsx` colors.

## Data model (all additive; repo-first migration + MCP `apply_migration`)

Rides the existing lifecycle — **no changes** to these:

- `portal_field_maps.status`: `proposed → approved → retired`; `source`:
  `token | manual | hardcoded`. Training is the machine that turns `proposed`
  into `approved`.
- `fill_sessions` — last-fill results derive from the latest org row per
  `portal_key`; nothing stored on portals.
- `tasks` — Fix-it "Skip" creates an ordinary task on the blocking case via
  `createTasksForCase`.

New (defined in the PR-A migration, spec has full SQL):

- `portals` — org-scoped registry: `portal_key`, `name`, `payer_id`,
  `form_url`, `is_verified`, `last_verified_at`, `url_changed_at`.
  Unique `(org_id, portal_key)`.
- `field_dictionary` — `label_normalized`, `token`, `status
  (suggested|confirmed|rejected)`, `seen_count`. Unique
  `(org_id, label_normalized)`.
- Additive columns on `portal_field_maps`: `field_label text`,
  `form_section text`, `confidence smallint` (0–100, set on proposed rows by
  whatever captured them).
- RLS so the **browser** can read `portal_field_maps` (global + own org) and
  write **org rows only** — global rows stay read-only in the app per locked
  decision 6 (shared catalog; promotion to global remains an ops action).
  fill_sessions gets a member SELECT policy if the live DB lacks one.

None of this touches `/api/*` or `guard.ts`; the service-role path bypasses
RLS, so the isolation gate is unaffected. Extension-side capture (writing
`proposed` rows with labels/sections/confidence) is a separate consumer-pulled
API chunk, out of scope for these PRs — until it lands, proposed rows are
seeded via MCP for UAT.

## Conventions all three PRs follow

- Layering: component → hook (`queryKeys`, org-scoped) → service (only
  Supabase caller, `requireActiveOrg()`, `writeAudit`, `camelizeRow`).
- `supabase.rpc` calls **bound** (`supabase.rpc.bind(supabase)`).
- New domain types appended to `src/types/index.ts` (additive only).
- Buttons `bg-[#1B4D3E] hover:bg-[#163E32]`; amber note boxes
  `border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]`; red error boxes
  `text-[#B91C1C] border-[#FCA5A5] bg-[#FEF2F2]`; dates via `fmtDate`;
  toasts via `sonner`; `EmptyState` for empties; no shadows, 1px borders.
- Fix-it + training surfaces use `var(--mp-*)` tokens (work surfaces);
  `/admin/portals` uses hex-token classes (admin surface) — matching the
  file-generation split already in the codebase.
- Sidebar additions (`Sidebar.tsx` is protected — these one-line nav entries
  are explicitly sanctioned by this package): `Fix-it` in main nav (writers
  only, live count badge), `Portals` in the Admin group.
