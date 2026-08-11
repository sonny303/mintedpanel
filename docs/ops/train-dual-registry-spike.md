# TRAIN-DUAL spike — Train vs Work portal pointer

**Status:** D-TD.1–D-TD.5 **locked** (PM review 2026-08-10) — **no product
code in this PR**. Build is queued **after** daily provider→cases loop work
(see Cadence).  
**Branch / PR:** `cursor/train-dual-spike-7953` / #281  
**Lane:** post–Slice 3 residual lean. Skill: `.cursor/skills/minted-3m-audit/`  
**Base:** `main` after #280 (All-states + D3.3-G).  
**PM pick:** **B TRAIN-DUAL** (interview 2026-08-10).

Companion: [`repo-workflow.md`](./repo-workflow.md) ·
[`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md) (D6.4 filter) ·
skill `references/known-debt-map.md` **TRAIN-DUAL**.

---

## Next-agent packet (paste-ready)

```
Mandate: TRAIN-DUAL BUILD — only after daily provider→cases loop bites land
(or PM re-orders). Bind: .cursor/skills/minted-3m-audit/ (do not paste audit).

Locked (do not reopen):
- Ready = checklist SOP; attach defaults only; keep org_payer_assignments
- No DELETE without #275 second sign-off; Slice 5 out
- D3.3-G pickTemplate ranks stay (do not resurrect E4.2 org-wall)
- Train never sends x-org-id; shared propose stays org_id NULL
- Capture stays shape-only (no values)
- D-TD.1 C (amended): URL is capture binding truth; selection sticky for
  nav/messaging only; never auto-bind capture to a key the tab contradicts;
  optional override only via explicit "capture this page as <selected form>"
- D-TD.2 keep two APIs (visibility semantics differ)
- D-TD.3 C1 — mismatch copy, not "New form … Form 2"
- D-TD.4 now (sibling bite): browser listPortals → usePortals pickers lack D6.4
- Reject B and D as automatic bind (shared-tier write risk)

Build: extension-first. Extract Train recognition/pointer rule into a pure
helper under src/shared/ (main.ts has zero tests — AC requires extract).
Panel listPortals D6.4 can be a parallel XS/S sibling.

Verify:
- Unit: helper pins capture never sends portalKey disagreeing with active tab URL
- Unit: mismatch copy / sticky selection (C1)
- TE-10 train slices
- if /api touched → isolation gate 22/22b/23
- hosted row check only with signed Supabase access

Stop: draft build PR mapped to US/AC; never self-merge.
```

---

## Cadence

Training is a **once-per-payer** job. This bite is real (trust failure on login
walls / redirects), but it ranks **below the daily provider→cases loop**, where
a silent gate costs something every day. Lock the D's while the analysis is
fresh; **schedule the build after daily-loop work** unless PM re-orders.

---

## Problem (code-verified; framing amended)

Train and Work share **one matcher** (`matchPortalByUrl`) over **two
registries**. Train’s dropdown and capture pointer have **two jobs by design**:

| Control | Job |
| ------- | --- |
| `trainPortal` dropdown | Navigate — opens `formUrl` only |
| `portal` pointer | Capture bind — set only from URL recognition |

Happy path works: land on the registered URL → prefix match → capture enables.
That is **not** redundant chrome.

**Genuine failure (narrower):** login walls, SSO redirects, and multi-step
wizards whose later paths do **not** prefix-match the registered `formUrl`.
There `refreshTrainRecognition` sets `portal = null` and shows *"New form —
nothing matches this page yet. It will be registered as 'X Form 2'"* while the
dropdown still shows the selected form. That copy is **false** — you are on a
login/redirect page, not a new form. Trust failure, not dual-architecture.

| Evidence | Path |
| -------- | ---- |
| Train loads `LIST_SHARED_PORTALS` → `sharedPortalRows` | extension `sidepanel/main.ts` `loadSharedRegistry` |
| Work loads `LIST_PORTALS` → `portalRows` | extension `sidepanel/main.ts` `detectPortal` |
| `recognizeForm` = `matchPortalByUrl` over passed rows | extension `shared/trainForms.ts` |
| `payerName` arg used **only** for `candidateName` on `new` — does **not** scope match | `recognizeForm` / `candidatePortalName` |
| `matchPortalByUrl` = longest prefix on `origin+pathname`; **ignores query/hash** | extension `shared/portals.ts` (+ tests) |
| Train recognition on non-`existing` sets `portal = null` | `refreshTrainRecognition` (~3466) |
| Dropdown change opens tab only — does not set `portal` (**design**) | `trainPortal` change (~3504) |
| Capture gated on `portal == null` | START_CAPTURE path (~3232) |
| Mismatch copy claims “New form … Form 2” | recognition status string (~3490) |
| Train → no `x-org-id` | `shared/panelMode.ts` `shouldSendOrgHeader` |
| Shared list = global only + D6.4 | panel `listSharedPortals` |
| Work list = own-org ∪ global (D6.4 on global leg) | panel `listPortalsForApi` |
| Browser `listPortals()` = RLS own+global, **no D6.4** | panel `services/portals.ts` |
| Shared propose → `org_id` NULL; idempotent on `(portal_key, selector)` | `POST /api/shared-field-maps` (gate 23) |

**Matcher note:** session tokens in query/hash already do not break matching.
The redirect / login-path case is the real gap.

**Irreversible risk if capture auto-binds the dropdown key:** Train writes the
**shared** tier (`org_id NULL`); every org inherits; `propose_shared_field_map`
is idempotent on `(portal_key, selector)` — wrong-key fields become
permanent-looking library rows. That is why **B** and **D** (automatic) are
rejected.

---

## Two layers (do not conflate)

| Layer | What it is | Train | Work |
| ----- | ---------- | ----- | ---- |
| **Registry (API)** | Which portal rows exist | `GET /api/shared-portals` (global, D6.4) | `GET /api/portals` (own-org + global, D6.4 on global) |
| **Capture bind** | Which `portal_key` capture/propose uses | URL match only (locked) | URL match on `portalRows` |
| **Selection (Train)** | Nav + messaging sticky intent | Dropdown / payer filter | n/a |

Dual **registries** stay (different visibility). Dual Train controls stay
(nav vs bind). Defect = **false “new form” messaging + wipe** on non-matching
transient URLs — not “dropdown must set the pointer.”

---

## Locked decisions (PM 2026-08-10)

### D-TD.1 — Pointer rule → **C amended** (reject B and D as automatic)

| Role | Rule |
| ---- | ---- |
| **URL / recognition** | Sole automatic capture bind. Capture must **never** send a `portalKey` the active tab URL contradicts. |
| **Selection** | Sticky for navigation and messaging only. Does not set capture bind on change. |
| **Mismatch** | Keep selection; disable capture; honest copy (see D-TD.3). |
| **Override (optional)** | Only via explicit confirmation: “capture this page as **&lt;selected form&gt;**” — deliberate, attributable; never automatic. |

Earlier draft C said “clears only when consistent with selected payer” — that
check **does not exist** (`payerName` is candidate-name only). Do not invent a
payer-scoped match in this bite unless PM asks; sticky selection + honest
mismatch is enough.

**Rejected:** B (selection wins) and D (wire key = dropdown) as automatic bind —
shared-library poison risk.

### D-TD.2 — Registries → **keep two APIs**

Shared = global only + D6.4; Work = own-org ∪ global with D6.4 on the global
leg. Collapsing client-side would re-implement server visibility — the rule
D6.4 centralized. Pointer/messaging fix only.

### D-TD.3 — Mismatch → **C1** (highest-return change)

When a form is selected and the URL does not match:

- Keep selection.
- **Disable** capture.
- Copy like: *“This page doesn’t match &lt;form&gt; — finish login or open the
  registered form URL”* — **not** *“New form … will be registered as 'X Form 2'.”*

Most of the bite’s value is this copy-and-condition fix (~few lines + extract
for testability), not architecture.

### D-TD.4 — Browser `listPortals` D6.4 → **now** (sibling bite)

Grep (2026-08-10): `listPortals()` is only defined in `services/portals.ts` and
consumed via `usePortals` by panel pickers / registries, including:

- `PortalsRegistry.tsx`
- `PortalStepLink.tsx`
- `TemplateWizard.tsx` / `FormStepPanel.tsx`
- readiness / scorecard panels (`usePayerReadiness*`, `PayerScorecardPanel`, …)

Ghost (retired/merged/archived/payerless global) portals are therefore
**selectable in the webapp**, even though extension fill already uses filtered
`/api/portals`. Flip from “later” → **now as a parallel XS/S sibling** (panel),
not a blocker for the Train messaging extract, but not deferred indefinitely.

### D-TD.5 — Verification bar → **yes, plus**

1. **UI** — sticky selection; no false “new form” on mismatch; capture disabled
   until URL matches (or explicit override if built).
2. **Invariant (required unit)** — capture never sends a `portalKey` that
   disagrees with the active tab URL (protects shared library).
3. **Extract (required)** — pointer/mismatch rule lives in a **pure helper under
   `src/shared/`**; `main.ts` has **zero** tests (godfile). Mirror
   `trainForms.ts` extraction or AC1.4 cannot be met.
4. **Client → API** — Train: shared routes, no `x-org-id`; Work unchanged.
5. **API → DB** — shared propose `org_id IS NULL`; idempotent re-capture keeps
   decision; PHI = labels/selectors only.
6. **Harness** — TE-10 train slices; if `/api` touched → gate 22/22b/23.
7. **Hosted** — optional; signed Supabase / ops only.

---

## User stories + AC (build targets)

### US-1 — Honest Train bind + messaging

**As** a trainer, **I want** login/redirect pages not to look like a new form,
and capture only under a URL-matched key, **so that** I trust Train and never
poison the shared library.

| AC | Check |
| -- | ----- |
| AC1.1 | Dropdown still navigates via `formUrl`; does not auto-set capture bind. |
| AC1.2 | URL mismatch keeps selection; capture disabled; copy is D-TD.3 C1 (not “New form … Form 2”). |
| AC1.3 | Capture enabled only when recognition matches (or after explicit override if shipped). |
| AC1.4 | Pure helper under `src/shared/` + unit tests for mismatch + portalKey↔URL invariant. |
| AC1.5 | Optional override (if in bite): confirmation names the selected form; attributable; never silent. |

### US-2 — Work fill unchanged

**As** a case worker, **I want** Work recognition to keep using `/api/portals`
+ `matchPortalByUrl`, **so that** fill does not regress.

| AC | Check |
| -- | ----- |
| AC2.1 | Work still loads `LIST_PORTALS` / `portalRows`. |
| AC2.2 | Fill click re-matches URL against Work registry. |
| AC2.3 | Existing portals / fill harness tests stay green. |

### US-3 — Shared propose persistence

**As** platform, **I want** Train capture to keep writing shared maps only under
the URL-matched key, **so that** every org inherits without wrong-key pollution.

| AC | Check |
| -- | ----- |
| AC3.1 | Train propose still hits `POST /api/shared-field-maps` with no org header. |
| AC3.2 | Stored row `org_id` null (gate assert 23). |
| AC3.3 | Re-capture same `(portal_key, selector)` does not reset an existing decision. |
| AC3.4 | PHI: capture payload remains labels/selectors only (no values). |
| AC3.5 | No automatic propose under dropdown key when URL does not match that row. |

### US-4 — Clear Train chrome

**As** a trainer, **I want** selection and recognition messaging to agree on
intent vs page match, **so that** I know whether to finish login or open the
registered URL.

| AC | Check |
| -- | ----- |
| AC4.1 | Recognition line names the selected form on mismatch (or explains no selection). |
| AC4.2 | No second automatic capture identity beyond the URL-matched portal. |

### US-5 — Panel ghost portals (D-TD.4 sibling)

**As** an admin linking SOP steps / portals, **I want** retired or dead-payer
globals hidden from browser `listPortals` pickers, **so that** I cannot select
a ghost the extension would never list.

| AC | Check |
| -- | ----- |
| AC5.1 | `listPortals()` applies the same D6.4 listability rules as the API global leg (or documented equivalent). |
| AC5.2 | Unit coverage on visibility / list filtering. |

---

## Bite map

| Bite | Repo | Change | Verify | When |
| ---- | ---- | ------ | ------ | ---- |
| **0** | panel | This spike (docs) | CI format/docs | now |
| **1** | extension | C1 copy + sticky selection; extract pure helper; portalKey↔URL invariant tests | unit + TE-10 train | after daily-loop |
| **2** | extension | Optional explicit “capture as &lt;selected&gt;” confirm (only if PM wants override in same PR) | unit | with or after 1 |
| **3** | panel | D-TD.4 `listPortals` + D6.4 for `usePortals` consumers | unit `portalVisibility` / portals | parallel XS/S OK |
| **+** | extension #39 | Skill twin merge/sync | pack identical | ops/docs |

---

## Hot files (build)

1. `minted-extension/src/sidepanel/main.ts` (wire only — logic leaves)
2. `minted-extension/src/shared/trainForms.ts` (and/or new pure helper beside it)
3. `minted-extension/src/shared/portals.ts` (matcher unchanged unless asked)
4. `minted-extension/src/shared/*.test.ts` (required — main.ts untested)
5. `minted-extension/src/harness/workbench.test.ts` (TE-10)
6. `mintedpanel/src/services/portals.ts` (`listPortals` D6.4 — bite 3)
7. `mintedpanel/src/lib/portalVisibility.ts`
8. Panel `/api` / isolation gate — **only if** contract moves (not expected)

---

## Out of scope

- Slice 5 / full sidepanel godfile rewrite (extract for this rule only)
- Ready / attach / `org_payer_assignments` / E4.2 org-wall
- #275 catalog DELETE hosted apply (needs second PM sign-off)
- Form mapper / FieldRegistry product changes
- Auto-register portals from capture (still human register in webapp)
- Collapsing Train and Work into one mode
- Payer-scoped `matchPortalByUrl` (payerName stays candidate-name only unless PM asks)

---

## Locked reply (PM 2026-08-10)

```
D-TD.1 pointer: C amended — URL bind truth; selection sticky nav/messaging only;
  reject B/D automatic; optional explicit "capture as <selected>" only
D-TD.2 registries: keep two APIs
D-TD.3 mismatch: C1
D-TD.4 browser listPortals D6.4: now (sibling) — usePortals pickers confirmed
D-TD.5 verification bar: yes + portalKey↔URL invariant test + shared/ extract
Cadence: build after daily provider→cases loop unless re-ordered
Also: ext #39 / #275 / Slice6 SOP-read — still open for separate ack
```
