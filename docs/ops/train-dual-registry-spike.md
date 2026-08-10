# TRAIN-DUAL spike — Train vs Work portal pointer

**Status:** spike ready for PM ack (2026-08-10) — **no product code in this PR**.  
**Branch / PR:** `cursor/train-dual-spike-7953`  
**Lane:** post–Slice 3 residual lean. Skill: `.cursor/skills/minted-3m-audit/`  
**Base:** `main` after #280 (All-states + D3.3-G).  
**PM pick:** **B TRAIN-DUAL** (interview 2026-08-10). Verification bar: webapp ↔
extension API/connections, UI without redundant portal state, propose rows
persist as expected.

Companion: [`repo-workflow.md`](./repo-workflow.md) ·
[`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md) (D6.4 filter) ·
skill `references/known-debt-map.md` **TRAIN-DUAL**.

---

## Next-agent packet (paste-ready)

```
Mandate: Post–Slice 3 residual lean — TRAIN-DUAL BUILD after PM ack of this spike.
Bind: .cursor/skills/minted-3m-audit/ (do not paste audit).

Locked until PM flips D-TD.* below:
- Ready = checklist SOP; attach defaults only; keep org_payer_assignments
- No DELETE without #275 second sign-off; Slice 5 out
- D3.3-G pickTemplate ranks stay (do not resurrect E4.2 org-wall)
- Train never sends x-org-id; shared propose stays org_id NULL
- Capture stays shape-only (no values)

Build only after PM replies D-TD.1–D-TD.5 (pointer + registry).
Prefer extension-first behavior PR; panel /api only if contract moves.
Verify: TE-10 harness + unit tests for pointer; if /api touched → isolation
gate 22/22b/23; hosted row check only with signed Supabase access.

Stop: draft build PR mapped to US/AC; never self-merge.
```

---

## Problem (code-verified)

Train and Work already share **one matcher** (`matchPortalByUrl`), but they load
**two registries** into **two arrays** and bind capture to a **single mutable
`portal` pointer** that Train sets **only from URL recognition**. The Train
dropdown never sets that pointer — it only opens `formUrl`. When recognition
returns `new`, Train **wipes** `portal`, which disables capture while the
dropdown can still show a selected form. That is redundant UI state and a
trust failure on the Train path.

| Evidence | Path |
| -------- | ---- |
| Train loads `LIST_SHARED_PORTALS` → `sharedPortalRows` | extension `sidepanel/main.ts` `loadSharedRegistry` |
| Work loads `LIST_PORTALS` → `portalRows` | extension `sidepanel/main.ts` `detectPortal` |
| `recognizeForm` = `matchPortalByUrl` over passed rows | extension `shared/trainForms.ts` |
| Train recognition on `new` sets `portal = null` | extension `sidepanel/main.ts` `refreshTrainRecognition` |
| Dropdown change opens tab only — does not set `portal` | extension `sidepanel/main.ts` `trainPortal` change handler |
| Capture uses `activePortal.key`; blocked when `portal == null` | extension `sidepanel/main.ts` START_CAPTURE path |
| Train → no `x-org-id` | extension `shared/panelMode.ts` `shouldSendOrgHeader` |
| Shared list = global only + D6.4 | panel `services/portals.ts` `listSharedPortals` |
| Work list = own-org ∪ global (D6.4 on global leg) | panel `services/portals.ts` `listPortalsForApi` |
| Shared propose → `org_id` NULL | panel `POST /api/shared-field-maps` (gate assert 23) |
| Debt seed | skill `known-debt-map.md` TRAIN-DUAL |

**Intent already stated** (architecture-truth): one portal pointer for capture +
recognition. **Code tension:** CLAUDE/trainForms claim trainer and filler
“never disagree” via shared `matchPortalByUrl` — true for the matcher, false
for the **row set** and for Train’s **dropdown vs URL pointer**.

**Not LISTPORTALS-as-chrome.storage.** Extension fill already uses filtered
`/api/portals`. Remaining asymmetry is panel **browser** `listPortals()` (RLS
own+global, no D6.4) — sibling bite, not this decision.

---

## Two layers (do not conflate)

| Layer | What it is | Train | Work |
| ----- | ---------- | ----- | ---- |
| **Registry (API)** | Which portal rows exist | `GET /api/shared-portals` (global, D6.4) | `GET /api/portals` (own-org + global, D6.4 on global) |
| **Pointer (UI)** | Which portal_key capture/fill binds | Mutable `portal` from URL recognition only | `portal` from URL match on `portalRows` |

Dual **registries** are intentional (shared library vs org Work). Dual
**pointers** inside Train (dropdown selection ≠ capture key) is the defect.

---

## Options — D-decisions for PM

### D-TD.1 — Pointer rule (pick one)

| Option | Behavior | UI redundancy | Risk |
| ------ | -------- | ------------- | ---- |
| **A — URL-only (document status quo)** | Dropdown = navigation aid; capture requires URL match; wipe on miss intentional | Still two controls that can disagree | Lowest code change; weak vs PM “no redundant info” |
| **B — Selection wins** | `trainPortal` change sets `portal` from `sharedPortalRows`; recognition advisory | One explicit form selection | Can capture under wrong key if URL drifted |
| **C — Sticky selection + URL confirm (recommended)** | Selection sets pointer; URL match upgrades/clears only when consistent with selected payer/`formUrl`; never wipe on transient redirect/login | Selection + honest “page matches / doesn’t yet” line | Matches product intent; medium extension edit |
| **D — Capture binds explicit key** | `START_CAPTURE.portalKey` **required** from dropdown in train; recognition display-only | Dropdown is the source of truth | Clear wire story; must block capture until select |

**Spike recommendation: C** (or **D** if PM wants the wire key always equal to
the visible select). Reject silent dual-write of two keys.

### D-TD.2 — Collapse registries? (pick one)

| Option | Behavior | Out of scope note |
| ------ | -------- | ----------------- |
| **Keep two APIs (recommended)** | Train stays shared-portals; Work stays `/api/portals`; only unify **pointer** | Preserves E6.9 / Slice 6 doors |
| **Single client buffer** | One array; train filters `orgId==null` client-side **or** `?tier=shared` | Larger contract; do as later bite if needed |

**Spike recommendation: Keep two APIs.** Pointer fix first.

### D-TD.3 — Recognition wipe policy

When URL does not match the selected form:

- **C1:** Keep selection; show “Open the registered form URL / finish login”
  and **disable** capture until match (pairs with D-TD.1 C/D).
- **C2:** Clear selection + portal (today’s wipe extended to the dropdown) —
  honest but jarring.
- **C3:** Auto-navigate again to `formUrl` (aggressive; avoid unless asked).

**Spike recommendation: C1.**

### D-TD.4 — Sibling LISTPORTALS / browser list

Align panel browser `listPortals()` with D6.4 (or document as Workbench-only
concern). **Not required** to close TRAIN-DUAL pointer. Separate XS/S bite.

### D-TD.5 — Verification bar (locked for build)

Any build that touches Train/Work portal or shared propose must prove:

1. **UI** — one Train portal pointer; no capture when pointer absent; no silent wipe.
2. **Client → API** — Train: shared routes, no `x-org-id`; Work: org portals as today.
3. **API → DB** — shared propose rows `org_id IS NULL`; idempotent re-capture keeps decision.
4. **Harness** — extension TE-10 train slices + new unit for pointer rule; if `/api`
   changes → gate 22/22b/23 (+ `sharedtier` leak).
5. **Hosted** — optional post-merge row check only with authenticated Supabase /
   signed ops (this environment’s Supabase MCP was `needsAuth` at spike time).

---

## User stories + AC (build targets after ack)

### US-1 — One Train portal pointer

**As** a trainer, **I want** the form I select and the form capture binds to
be the same portal_key, **so that** I never lose capture after opening the
right tab.

| AC | Check |
| -- | ----- |
| AC1.1 | Selecting a Train form sets the capture pointer (or binds capture key per D-TD.1 D). |
| AC1.2 | URL mismatch does not silently clear a deliberate selection (per D-TD.3). |
| AC1.3 | Capture disabled with an explicit reason when pointer/key is absent. |
| AC1.4 | Unit test covers dropdown vs URL disagreement (today: no such test). |

### US-2 — Work fill unchanged

**As** a case worker, **I want** Work recognition to keep using `/api/portals`
+ `matchPortalByUrl`, **so that** fill does not regress.

| AC | Check |
| -- | ----- |
| AC2.1 | Work still loads `LIST_PORTALS` / `portalRows`. |
| AC2.2 | Fill click re-matches URL against Work registry. |
| AC2.3 | Existing portals / fill harness tests stay green. |

### US-3 — Shared propose persistence

**As** platform, **I want** Train capture to keep writing shared maps only,
**so that** every org inherits the form without tenant-scoped pollution.

| AC | Check |
| -- | ----- |
| AC3.1 | Train propose still hits `POST /api/shared-field-maps` with no org header. |
| AC3.2 | Stored row `org_id` null (gate assert 23). |
| AC3.3 | Re-capture same `(portal_key, selector)` does not reset an existing decision. |
| AC3.4 | PHI: capture payload remains labels/selectors only (no values). |

### US-4 — No redundant Train chrome

**As** a trainer, **I want** a single clear “current form” signal,
**so that** payer select / form select / recognition line do not contradict.

| AC | Check |
| -- | ----- |
| AC4.1 | Recognition copy names the same portal as the select (or explains mismatch). |
| AC4.2 | No second hidden portal identity in session beyond the chosen pointer. |

---

## Bite map (after PM ack)

| Bite | Repo | Change | Verify |
| ---- | ---- | ------ | ------ |
| **0** | panel | This spike (docs) | CI format/docs |
| **1** | extension | Pointer rule (D-TD.1 + D-TD.3); pure helper extract if needed | unit + TE-10 train |
| **2** | extension (±panel) | Only if D-TD.2 collapses APIs or wire `portalKey` required | harness + gate if API |
| **3** | panel (optional) | D-TD.4 browser `listPortals` D6.4 | unit `portalVisibility` |
| **+** | extension #39 | Skill twin merge/sync (ops/docs) | pack identical to panel |

---

## Hot files (build)

1. `minted-extension/src/sidepanel/main.ts`
2. `minted-extension/src/shared/trainForms.ts`
3. `minted-extension/src/shared/portals.ts`
4. `minted-extension/src/shared/panelMode.ts`
5. `minted-extension/src/background/api.ts` / `index.ts`
6. `minted-extension/src/harness/workbench.test.ts`
7. `mintedpanel/src/services/portals.ts` (only if D-TD.2/4)
8. `mintedpanel/src/server/extensionRoutes.ts` (only if wire)
9. `mintedpanel/scripts/verify-org-isolation.mjs` (if `/api` touched)

---

## Out of scope

- Slice 5 / sidepanel godfile rewrite
- Ready / attach / `org_payer_assignments` / E4.2 org-wall
- #275 catalog DELETE hosted apply (needs second PM sign-off)
- Form mapper / FieldRegistry product changes
- Auto-register portals from capture (still human register in webapp)
- Collapsing Train and Work into one mode

---

## PM reply block (copy)

```
D-TD.1 pointer: A | B | C (recommended) | D
D-TD.2 registries: keep two APIs (recommended) | collapse
D-TD.3 mismatch: C1 (recommended) | C2 | C3
D-TD.4 browser listPortals D6.4: now | later | never
D-TD.5 verification bar: as written (yes/no)
Also: ext #39 skill twin merge?  #275 / Slice6 SOP-read: signed | blocked
```
