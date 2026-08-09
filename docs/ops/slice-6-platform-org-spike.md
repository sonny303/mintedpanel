# Slice 6 spike — platform authoring vs org adoption

**Status:** spike complete (2026-08-09) — ready for build after PM ack of §Locked decisions  
**Branch / PR:** `cursor/3m-slice-6-spike-6f36`  
**Lane:** 3M Lean (this agent). Claude owns Slices 2–3; do not collide.

Companion process: [`repo-workflow.md`](./repo-workflow.md). Product loop context: plan §G (payer → SOP → portal → train → map; org assign later).

---

## Problem (code-verified)

E6.7 locked **creating = adding**: `create_payer` always upserts `org_payer_assignments` for the caller org in the same transaction.

| Evidence | Path |
| --- | --- |
| RPC always assigns | `supabase/migrations/20260727120000_e67_payer_manual_setup.sql` (~310–315) |
| Service always passes `p_org_id` | `src/services/payers.ts` `createPayer` |
| Create UI toast assumes network | `src/routes/admin.payers_.new.tsx` — “added to your network” |
| Setup / funnel gated on assignment | `src/lib/payerSetup.ts` `activeOrgPayers` → `PayerSetupPage`, `usePayerReadinessFunnel` |
| Train list unfiltered | `listSharedPortals` — all global portals; no payer lifecycle filter |

**Desired model:** platform setup (payer → SOP → shared portal → train → map) is independent of org adoption (assign → targets → cases → fill).

---

## Locked decisions (build from these)

### D6.1 — RPC shape: flag on `create_payer`, not a second RPC

**Additive migration only** (`CREATE OR REPLACE` + new arg):

```text
p_assign_to_org boolean DEFAULT true
```

| Value | Behavior |
| --- | --- |
| `true` (default) | Today’s behavior: upsert active `org_payer_assignments` + current audit copy |
| `false` | Insert global payer only; **skip** assignment upsert; audit: “Created global payer …” |

Still requires `p_org_id` for **writer-membership auth** (admin/specialist of that org) — platform authoring does not invent a platform role (E6.7 / D11 posture). Adoption uses existing `addAssignment` / detail “Add to my network”.

**Do not** add `create_global_payer` as a parallel RPC (dup validation / near-match / provenance).

### D6.2 — UX: two intents, one form, default assign = on for Setup entry

| Intent | How |
| --- | --- |
| **Ops: set up for my network** | Existing `/admin/payers/new` from Payer Setup — **`assignToOrg: true`** (default). Toast stays “added to your network”. |
| **Platform: author identity only** | Same form + control **“Also add to my network”** (checkbox, **default checked** for Setup CTA). Unchecked → `assignToOrg: false` → toast “Payer created” → detail shows **Add to my network**. |

Two separate top-level verbs later are optional polish; the checkbox is the smallest ship that matches existing “Add to my network” language on detail (`PayerDetailPage`).

**Do not** invent a third catalog browser. Platform browse stays `list_global_payers` / detail.

### D6.3 — List semantics (platform vs my network)

| List | Source | Role |
| --- | --- | --- |
| **My network** | `activeOrgPayers()` | Payer Setup, readiness funnel, attach shortlist, manual case picker |
| **Platform catalog** | `list_global_payers` | Near-match, detail, author for any global row |
| **Shared portals (Train)** | `listSharedPortals` + **D6.4 filter** | Org-free train picker |

Group attach may still pull from catalog then assign on save (existing path) — out of Slice 6 scope to redesign.

### D6.4 — F24: filter `listSharedPortals` (and global leg of Work registry)

Exclude portals that are not intentional active forms:

```text
portals.org_id IS NULL
AND portals.payer_id IS NOT NULL
AND payers.status = 'active'
AND payers.archived_at IS NULL
```

(`merged_into_id` is covered by `status != 'active'` when merge sets `status='merged'`.)

Apply in:

1. `listSharedPortals` (Train) — **required**
2. Global disjunct of `listPortalsForApi` — **same filter** so Work-case recognition doesn’t surface ghost global portals

Use `payers!inner(...)` (or equivalent) so null `payer_id` drops. Unit-test + org-isolation gate still asserts “no other org’s private rows.”

### D6.5 — Critical follow-on: SOP read-back without assignment

Today `author_global_sop` / `upsert_global_portal` do **not** require assignment, but **template list RLS** only surfaces global SOPs for assigned payers (see `templates.ts` + SOP RLS). Platform authoring with `assignToOrg: false` will create SOPs the authoring org may not see until adopt.

**Slice 6 build must include one of:**

| Option | Choice |
| --- | --- |
| **A (preferred)** | Widen global SOP/portal **read** RLS (or list RPC) so writers can see global rows they authored / all active global SOPs for a payer when viewing that payer’s detail Templates tab — without requiring assignment |
| **B** | Document “platform author must assign before listing” — **rejected** for this spike (defeats the model) |

Spike locks **Option A** as in-scope for the Slice 6 build PR (or a tight follow-up PR in the same tranche). Exact RLS wording is a build-time spike ≤30 min against `sop_template_versions` / portals policies.

### D6.6 — Inventory SQL (read-only ops)

Ship `docs/ops/global-portal-payer-inventory.sql` (no deletes): counts / rows for null `payer_id`, non-active / archived / merged payers, orphan shared field maps. Human runs in SQL Editor when credentials exist.

### D6.7 — Out of scope (unchanged)

- Extension Train module / `panelMode` (shipped); only API filter above
- FormStepPanel / Field Registry epic wiring
- Destructive seed cleanup
- `/api/payers`
- Slice 2/3 surfaces (Claude)

---

## Supersedes

| Prior | Change |
| --- | --- |
| E6.7 “creating = adding” | Softened: creating **may** add; default still adds |
| TD / plan F23 monitor | Becomes **fix** under Slice 6 build |

---

## Minimal PR map (build)

| # | Change | Files (indicative) |
| --- | --- | --- |
| 1 | Migration: `p_assign_to_org boolean DEFAULT true` | new `supabase/migrations/20260809*_create_payer_assign_flag.sql`; `table-register.md` note |
| 2 | Service + types regen | `payers.ts` `PayerWriteInput.assignToOrg?`; DI test; generated `types.ts` |
| 3 | Create UI | `admin.payers_.new.tsx` checkbox + toast; `useCreatePayer` already invalidates assignments |
| 4 | Shared portal filter | `portals.ts` `listSharedPortals` + `listPortalsForApi`; unit/route tests; isolation script if needed |
| 5 | SOP/portal read for unassigned | RLS/list path per D6.5 Option A |
| 6 | Inventory SQL | `docs/ops/global-portal-payer-inventory.sql` |
| 7 | E2e | `e2e/payer-form.spec.ts` — mock + assert both assign modes; Setup still lands “In my network” when checked |

**Suggested PR split:** (1) RPC + service + create UI + e2e, (2) portal filter + inventory, (3) SOP read-back — or one PR if kept tight.

---

## Claude Code build handoff (after this spike merges)

```
Implements Slice 6 from docs/ops/slice-6-platform-org-spike.md (LOCKED decisions D6.1–D6.7).
Branch: cursor/3m-slice-6-build-6f36 off main (rebase after spike PR merges).
Rules: AGENTS.md; additive migrations only; never self-merge; draft PR.

Must:
- p_assign_to_org boolean DEFAULT true on create_payer
- Create form checkbox "Also add to my network" (default on)
- listSharedPortals + listPortalsForApi global filter (D6.4)
- Fix global SOP/portal read-back without assignment (D6.5 Option A)
- Inventory SQL read-only
- e2e payer-form both modes

Must not: extension Train rewrite, FormStepPanel epic work, destructive deletes, /api/payers,
touch Slice 2/3 open PRs without rebase.

Stop at draft PR + spike criteria checklist in PR body.
```

---

## Verify (build acceptance)

1. Create with checkbox on → assignment row + “In my network”
2. Create with checkbox off → no assignment; detail shows Add CTA; can author global SOP and **see it** on Templates tab
3. Train `GET /api/shared-portals` omits null-payer / archived / merged / retired
4. Existing Setup funnel unchanged for assigned payers
5. CI green; migration dry-run green

---

## Open only if PM overrides

| Topic | Spike default |
| --- | --- |
| Default checkbox on | **On** (preserve ops “create = network”) |
| Apply portal filter to Work `/api/portals` global leg | **Yes** |
| SOP read-back without assign | **In scope (Option A)** |
