# Payer & Cases UI — design review + Claude Code build handoff

**Bundle:** `docs/redesign/design-reference/payer-and-cases/` (canonical; supersedes the earlier
payer-setup bundle from closed PR #235). Read the bundle's `README.md` and `github.md` first —
they carry the per-screen "Change vs. today" deltas and the schema research receipts.

**Scope:** six internal screens — Payer Setup, Add/Edit Payer, Payer Detail, Template Editor,
Case Close & IDs, Case Detail.

**PM constraints (binding):**

- **Do not change the menu bar / sidebar.** `src/components/layout/*` is untouched. Existing
  routes and nav entries keep working; internal screens only.
- Extension surfaces are deferred; Cases list and Provider Detail are frozen (already shipped).
- No role security at day 0 (two trusted users).

---

## 1 · Prerequisites (backend)

| Prereq                                                                                                                              | Status                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| E6.7 PR 1 (#237): `create_payer`, `update_payer`, ID-expectation split, `payer_contacts`, fallback unlock, service/hook seams       | Open — **merge before UI build starts**     |
| E6.7 PR 2: sync retirement + stale-metadata stop-render (F6.7.4/5)                                                                  | Not yet opened                              |
| **E6.8** (`docs/redesign/E6.8-payer-lifecycle-enabler.md`): archive/reactivate payer, merge payer, Approved "Didn't receive" escape | New — written from this bundle's open items |

Screens 1–3 and 5 depend on E6.7 PR 1. Screen 3's Manage tab and screen 5's escape hatch depend
on E6.8. Screens 4 and 6 have no new backend dependencies.

## 2 · Review findings — conflicts and resolutions

1. **Approved close vs. #237's strict enforcement (the one real conflict).** #237 reissued
   `set_case_status` so Approved _hard-requires_ exactly the IDs the payer expects. The design
   (screen 5) gives every ID field a **"Didn't receive" escape** — approve anyway, enrollment
   reads _Awaiting ID_. The design is the approved product behavior ("a missing ID must never
   block a close"). Resolution: E6.8 F6.8.3 reissues `set_case_status` with per-ID
   acknowledged-missing flags. Do not build the close dialogs against #237's strict rule.
2. **Archive + merge are new backend.** E6.7 deliberately kept merges platform-side and made
   `status` non-editable via `update_payer`. The design's Manage tab (archive blocked by open
   cases; merge moves templates/IDs/cases and leaves an alias) needs E6.8 F6.8.1/F6.8.2.
   "Remove from network" is collapsed into Archive — with the catalog gone the payer list _is_
   the org's network.
3. **`delegation_note` stays.** The bundle's `github.md` audit stripped it from Payer Detail at
   one point, but the final screens 2 and 3 both carry it, matching `create_payer`/`update_payer`.
   No change.
4. **Org template tier retired in authoring UI only.** Templates are scoped payer + group (the
   match key). The resolver (`pickTemplate`) keeps reading any existing org-tier rows; the
   Template Editor simply never creates them. No resolver change.
5. **Stale route segment** `/admin/payer-admin/catalog` — keep the path working (redirects fine),
   rename in the last slice, never break inbound links. The 6 SOPs-tab redirect sources
   (`/admin/portals`, `/admin/templates`, `/fix-it`, portal training, …) must land somewhere
   sensible at every intermediate state.
6. **Two status machines stay separate** — internal `caseStatus.ts` on Cases/Case Detail,
   external `payerPipeline.ts` on Payer Detail → Cases. Never merged into one label.
7. **Deliberate removals — do not re-add:** next-step CTA column, drift banner, drafts strip,
   membership KPIs, catalog fixture, required-documents card, work-in-portal launcher,
   duplicate-tracking-ID warning (backend guardrail stays), the two legacy history ledgers,
   merged-payer redirect on Add/Edit (merge lives on Payer Detail → Manage).
8. **Terminology:** "Template" everywhere in the UI; internal identifiers may keep "sop".
9. **`design_handoff_payer_setup/`** references in the bundle refer to the design tool's own
   project folder, not this repo. Nothing to delete here (#235 was closed unmerged).
10. **Scorecard route already exists** — `admin.payers_.$id.scorecard.tsx` (the Journeys index
    flags it as unaccounted). Slice C's Scorecard tab should fold/redirect it rather than add a
    second scorecard surface.
11. **Payer Detail becomes editable** — the Journeys index notes the production drill-in is
    read-only and "the Edit mode drawn on its Overview needs a decision"; the decision is the
    design itself (editable identity/aliases/delegation via `update_payer` from #237).

### Bundle open-item traceability (nothing dropped)

| Bundle open item (README §Open items / screen index)                                                               | Disposition                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| "No way to create a payer" — payer create/edit API                                                                 | E6.7 PR 1 (#237): `create_payer`/`update_payer` + seams  |
| ID-expectation columns (2 booleans + 2 labels; fixed `GROUP_PROVIDER_ID_LABEL`; unconsumed `resolutionIdExpected`) | E6.7 F6.7.1a (#237)                                      |
| `payer_contacts` table                                                                                             | E6.7 F6.7.2a (#237)                                      |
| Archive flag + merge operation                                                                                     | E6.8 F6.8.1 / F6.8.2                                     |
| "Didn't receive" escape vs production hard-require                                                                 | E6.8 F6.8.3 (approved divergence — build the escape)     |
| Legacy history ledgers not carried over                                                                            | Flagged §2.7 — PM to confirm the old ledgers stay hidden |
| "Template" terminology                                                                                             | §2.8                                                     |
| Versioning-lite                                                                                                    | Slice F scope; production ceremony not rebuilt           |
| Stale `/catalog` route segment + `/sops` fold                                                                      | Slice G                                                  |
| Stale `design_handoff_payer_setup/` bundle                                                                         | Design-tool side (§2.9) — no repo action                 |
| Scorecard route unaccounted                                                                                        | §2.10 → Slice C                                          |
| Payer Detail Edit decision                                                                                         | §2.11 — resolved: editable                               |

## 3 · Build slices (one PR each, in order)

Each slice is an FR-traceable UI epic PR. AGENTS.md binds throughout: components → hooks →
services → Supabase, no `any`, named exports, no rendered mock data, sidebar untouched.

1. **Slice A — Payer Setup page** (screen 1): single view, no tabs; 4 KPI filter cards
   (All / Needs template / Form not proven / Drift detected); search·State·Kind·Show archived
   toolbar; `Payer · State(s) · Kind · Template status` table (Published / Needs template only);
   default-template card (edit-only); empty/filtered/archived states; pagination 5–100.
   Depends on: E6.7 PR 1 merged (+ E6.8 for Show archived/Reactivate — may stub behind it).
2. **Slice B — Add / Edit Payer** (screen 2): `/admin/payers/new` + `/admin/payers/$id/edit`;
   step 1 name + near-match ("use this instead"), step 2 details (kind, 50+DC states
   multi-select, aliases, the two ID-expectation rows with payer-worded labels, delegation
   note). Wires `useCreatePayer`/`useUpdatePayer` + `payerNearMatch` helpers from #237.
3. **Slice C — Payer Detail** (screen 3): tabbed Overview · Enrollments · Cases · Templates ·
   Scorecard · Manage; editable identity/aliases/delegation; contacts card
   (`payer_contacts` seam from #237, one Default per purpose); Cases tab uses the _external_
   pipeline stage. Manage tab (Archive/Merge) depends on E6.8.
4. **Slice D — Case Close & IDs** (screen 5): the three close dialogs (Approved with
   both/one/neither ID variants + "Didn't receive" escape; Denied with governed reason +
   context on Other; Not Pursuing with note); Awaiting-ID display on group payer board +
   provider enrollments, linking back to the capturing case. Depends on E6.8 F6.8.3.
5. **Slice E — Case Detail** (screen 6): two-column layout, unified status control feeding
   slice D's dialogs, single task list + step drawer (wizard retired), full-metadata touchlog
   with status-bump-as-evidence, details/identifiers/provenance column, unified timeline.
6. **Slice F — Template Editor** (screen 4): 3-step wizard (Basics · Tasks & steps · Review),
   tier derived from match key, five inline online-form modes (register/capture/map/repair/
   prove) with derived context banner, versioning-lite (v-chip, History drawer,
   restore-as-new, optional change note), `#edit-default` for the fallback template.
7. **Slice G — route cleanup**: rename the stale `catalog` segment, fold `/sops`, land the six
   redirect sources on their new homes, delete dead components (catalog browser, segmented
   control, wizard tab). Last, after everything else is stable.

## 4 · Verification gates

`npm run lint && npx tsc --noEmit && npm run test` before every PR; Playwright smoke must stay
green. Map every FR to the diff in the PR body. Branch off `main`, target `main`, one slice at
a time, never self-merge.
