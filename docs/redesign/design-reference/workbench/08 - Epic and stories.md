# 08 — Epic and stories

A proposed breakdown for Claude Code to review, sharpen, and write into the tracker. Sized so each story is independently verifiable.

**Repos:** `EXT` = `minted-extension` · `APP` = `mintedpanel`

Acceptance criteria are written to be testable. Where a criterion says "at 320px", that is a real gate — the panel floor is 320 and most defects live there.

---

## Epic: Minted Panel Workbench — one loop across two products

**Outcome:** a coordinator picks up work, sees what the page needs, does it, and it records itself — with no re-entry in the web app, and with the two products finally looking like one.

**Six phases.** E1 has no dependencies and no open decisions. Everything else sequences behind either a spike, a confirm, or the portal registry.

---

## Phase 1 — Brand and tech debt · `EXT`

*No dependencies. Start here. This is also the phase stakeholders can see.*

### S1.1 — Declare extension icons
Copy `assets/icons/*` to `public/icons/`; add `icons` and `action.default_icon` blocks.

- [ ] All four sizes declared in both blocks, from a single variant
- [ ] Side-panel header shows the mark, not a generated letter tile
- [ ] Toolbar button shows the mark on both light and dark Chrome themes
- [ ] chrome://extensions shows the 48/128 mark

Ref: doc 07 E1.1 · `assets/icons/README.md`

### S1.2 — Apply design-system tokens
Replace the `:root` block; keep legacy aliases.

- [ ] Every value in doc 07 E1.2's table matches the target column
- [ ] No `shadow-sm` on any control
- [ ] Status pills are radius 4, not 999px
- [ ] Focus ring is 1px primary + 2px soft ring
- [ ] No selector broke — legacy aliases resolve
- [ ] Visual diff against `7 - Workbench Panel.dc.html` right-hand panel

Ref: doc 07 E1.2 · doc 09

### S1.3 — Self-host Geist
Swap four `@font-face` blocks; ship woff2 400/500/600/700 to `/fonts`.

- [ ] No Google Fonts `<link>` or `@import` anywhere
- [ ] No CSP violation in the console on panel open
- [ ] All four weights render; no synthetic bolding

Ref: doc 07 E1.2 step 3

### S1.4 — Remove the second header
Delete the panel's own green bar.

- [ ] Panel content starts at the account row
- [ ] Reclaimed vertical space goes to content, not padding
- [ ] Brand still reads via Chrome's header + icon (requires S1.1)

Ref: doc 07 E1.6 · doc 02 §2.1

### S1.5 — Account row and sign-out
Replace the email + green link with the avatar menu.

- [ ] Avatar is a 26px `#1B4D3E` circle with a white 11px/600 initial
- [ ] Menu contains the email and Sign out
- [ ] No text on the dark header below `#A7B5AD` contrast
- [ ] Works at 320px without truncating the org name to nothing

Ref: doc 02 §2.1 · doc 07 E1.4

### S1.6 — Fix the doubled credential suffix
- [ ] "Jim Apple, PT" — suffix appears once
- [ ] Fixed in the projection, not patched at render

Ref: doc 07 E1.3

### S1.7 — Terminology rename
- [ ] No user-facing "SOP" in the extension
- [ ] `extension_fill` → `Auto-fill` in copy; internal identifiers may lag if renaming them is risky
- [ ] No behavior change

Ref: doc 07 E1.5

---

## Phase 2 — The field catalog · `EXT` + `APP`

*Depends on: nothing (the catalog decision is made). Delivers the MVP value on its own.*

### S2.1 — Reconcile the catalog to 127 fields
- [ ] `quickCards.ts` and the extension README describe the 127-field catalog
- [ ] The "up to 3 extras" cap is removed
- [ ] `SSN last 4` present and selectable
- [ ] Group counts match doc 01: 45 / 39 / 23 / 9 / 3 / 6 / 2

Ref: doc 07 §4 · doc 01

### S2.2 — Rebuild the field picker
Search over collapsible groups, per-group counts, reachable Save/Cancel.

- [ ] Search filters all 127; matching groups auto-expand; empty groups hide
- [ ] Per-group count reads "3 of 45" in primary when any picked, else "of 45" in subtle
- [ ] Checkbox sits **in** the row; label is left-aligned; row widths are uniform
- [ ] Save and Cancel reachable without scrolling past content
- [ ] **Usable at 320px** — no clipping, no horizontal scroll
- [ ] No-results state renders the query back

Ref: doc 02 §2.7 · doc 04 §4.9

### S2.3 — Details card with grouped sections
- [ ] Section header per catalog group
- [ ] Row wraps rather than truncating long values
- [ ] Click copies; copied rows stay marked for the session
- [ ] Absent values read "Not on file" with an amber icon, are not clickable, and the group shows the fix footnote
- [ ] Clipboard-blocked fallback exists and says so
- [ ] Selection persists per user (existing layout PUT)

Ref: doc 02 §2.5 · doc 04 §4.8

---

## Phase 3 — Context and pickup · `EXT` + `APP`

*Depends on: S3.1 spike, and the portal registry for anything beyond one payer.*

### S3.1 — SPIKE: can the app open the side panel?
Timebox it. Test `externally_connectable` → `sendMessage` → `sidePanel.open()` with a gesture originating on a page, across target Chrome versions.

- [ ] Documented answer, with versions tested
- [ ] If no: C1 copy and the Template Editor capture card stay as specified ("Open form")
- [ ] If yes: one follow-up story to shorten both flows

Ref: doc 06 C1 · doc 07 E3.1

### S3.2 — DB-driven portal registry
- [ ] Portals load from the DB, not `portals.ts`
- [ ] Banner PNM exists as a portal
- [ ] `url_pattern` matching drives page recognition
- [ ] Adding a portal needs no extension release

Ref: doc 07 E3.3

### S3.3 — Case pickup queue
- [ ] Panel opens to the queue when nothing is in hand
- [ ] Order and the per-case reason line come from the **case workflow** — no panel-side ranking
- [ ] Loading, empty, failed, and long-queue states per doc 04 §4.4
- [ ] Release returns to the queue without a confirmation

Ref: doc 02 §2.2 · doc 04 §4.4

### S3.4 — Tab-aware context
- [ ] Context card reflects the active tab across all four cases in doc 02 §2.2's table
- [ ] On a recognized payer form, the heading becomes "Cases that use this page", the matching case sorts first and shows `THIS PAGE`
- [ ] Case-mismatch state **suppresses** the fill offer
- [ ] Two tabs on the same portal do not produce two competing offers

Ref: doc 02 §2.2–2.3 · doc 04 §4.5 · UC-3, UC-4

### S3.5 — C1 launch payload
- [ ] Case Detail's launch carries `{org, provider, location, case, portal_key}`
- [ ] Panel opens (or picks up on focus) with the case in hand and zero dropdowns
- [ ] Copy does not promise to open the panel unless S3.1 proved it

Ref: doc 06 C1 · UC-2

---

## Phase 4 — Fill and record · `EXT` + `APP`

*Depends on: Phase 3 (registry, context). S4.3 depends on a task source.*

### S4.1 — Fill on a proven form
- [ ] Dark offer card; count and skip reason stated **before** the run
- [ ] `PROVEN` chip only on proven forms; unproven forms get a secondary button and a note
- [ ] Drifted forms show a warning strip with the broken count
- [ ] Report **snapshots** at run time and never recomputes
- [ ] Partial fills name the skipped field and why
- [ ] Failure modes per doc 04 §4.6 — no silent skips, no blaming the user

Ref: doc 02 §2.4A · doc 04 §4.6 · UC-1

### S4.2 — Duplicate-work guard
- [ ] Fires **on pickup**, not at submit
- [ ] Never blocks; "Continue anyway" dismisses
- [ ] "See the touchlog" opens the case
- [ ] Survives a case switch (UC-4 step 4)

Ref: doc 02 §2.3 · UC-1, UC-4

### S4.3 — Progress tab with step completion
**Blocked on a task source (doc 07 E3.5).** If that can't land, cut this tab rather than shipping a read-only duplicate of Case Detail.

- [ ] Steps scoped to the case's tasks for the portal in hand
- [ ] Current-page step carries `THIS PAGE` and a row tint
- [ ] Ticking a step writes; failure state is explicit and never shows false success
- [ ] Reference input pre-fills from the case; "Latest wins" note present
- [ ] All-done reveals "Record submission"

Ref: doc 02 §2.6 · doc 04 §4.7 · doc 07 E3.5

### S4.4 — C2 submission
- [ ] One `portal_submission` touch with reference and fill report
- [ ] Status bumps In Progress → Submitted
- [ ] Linked task closes when `task_id` is present
- [ ] Case Detail shows a green `Workbench` touchlog entry naming the result and reference
- [ ] Status timeline records `workbench touch` as evidence
- [ ] Offline: local state retained, explicit unsent state, retry

Ref: doc 06 C2 · doc 03 §3.1 · UC-1, UC-10

### S4.5 — C3 reference pre-fill · `APP`
- [ ] Case Close approval dialog shows the provenance strip
- [ ] Reference pre-filled and overridable
- [ ] Nothing else in the dialog changes

Ref: doc 06 C3 · doc 03 §3.3

---

## Phase 5 — Capture and approve · `EXT` + `APP`

*Depends on: the propose-only write path, the handshake, and the registry.*

### S5.1 — `portal_field_maps` propose-only write
- [ ] Panel can write rows with `status: "proposed"` and nothing else
- [ ] A proposed row **never** fills — enforced server-side, not just in the UI
- [ ] Approval flips `proposed → approved` and is a user action
- [ ] The read-only boundary comment in `fixit.ts` is updated to describe the new, narrower rule

Ref: doc 06 C4 · doc 07 §2

### S5.2 — Capture session handshake
- [ ] A capture binds to a template step + portal key
- [ ] Survives an MV3 worker restart: labels and counts restore, **values never**
- [ ] Restored state says what came back

Ref: doc 07 E3.2 · doc 04 §4.10, §4.12 · UC-9

### S5.3 — Label-learning store
- [ ] A mapping made on one payer is proposed on another
- [ ] Evidence carries the payer count and is shown to the user
- [ ] A user-assigned gap feeds the store

Ref: doc 07 E5.1 · UC-6

### S5.4 — Capture UI, propose then approve
- [ ] "We recognise N of M" with per-row evidence
- [ ] Gaps are actionable with a suggestion; submit disabled-styled until resolved
- [ ] Sent state offers **Approve all** in the panel, plus a Template Editor link
- [ ] Zero-recognized case still allows sending
- [ ] Re-capture on an existing portal is offered as drift repair, diffed against existing rows
- [ ] Template Editor renders proposed rows distinctly and cannot fill from them

Ref: doc 02 §2.4C · doc 03 §3.2 · doc 04 §4.10 · UC-6

---

## Phase 6 — CAQH and drift · `EXT` + `APP`

### S6.1 — Per-field `verified_at`
- [ ] Column exists and is written by C6
- [ ] Details renders a stale treatment past the freshness window

Ref: doc 07 E5.2 · doc 04 §4.8

### S6.2 — CAQH fill and attestation
- [ ] Offer is **push**: "Update CAQH — N fields" with last-attested date
- [ ] "Record attestation" sets `caqh_last_attested_date` and stamps every field the fill carried
- [ ] Recently-attested state de-emphasizes the offer
- [ ] **No bidirectional sync anywhere**

Ref: doc 02 §2.4B · doc 06 C6 · UC-8

### S6.3 — CAQH gap pull
- [ ] Exception strip appears **only** when CAQH holds a value we have blank
- [ ] Pull writes the field with `verified_at`
- [ ] Details immediately reflects it; the next fill count increases
- [ ] Strip is omitted entirely when there are no gaps

Ref: doc 02 §2.4B · UC-5

### S6.4 — Drift reporting
- [ ] A dead selector during a fill reports `{portal_key, field, last_working_at}`
- [ ] The coordinator is never asked to diagnose
- [ ] Payer Setup's drift banner names the provenance; the KPI counts it
- [ ] Repair marks fields known-fragile for the next coverage check

Ref: doc 06 C5 · doc 03 §3.4 · doc 07 E3.6 · UC-7

---

## Cross-cutting acceptance gates

Apply to every story in Phases 2–6.

- [ ] **320px.** Every surface usable at the panel floor. No clipping, no horizontal scroll.
- [ ] **No fixed dimensions.** No fixed widths, no fixed heights, no viewport units.
- [ ] **PHI.** No value persisted anywhere. Restored views show labels and counts only.
- [ ] **Nothing escapes the panel.** Styled overlays fit inside. Native `<select>` exempt.
- [ ] **No silent failure.** Every write has an explicit failure state. Never a success confirmation for a write that didn't happen.
- [ ] **Two status machines stay separate.** Case status and payer pipeline stage are never derived from one another.
- [ ] **No invented priority.** Ordering comes from the case workflow.

---

## Dependency graph

```
Phase 1 ─────────────────────────────► ship independently

S2.1 ──► S2.2 ──► S2.3 ──────────────► MVP value

S3.1 (spike) ─┐
S3.2 ─────────┼──► S3.3 ──► S3.4 ──► S3.5
              │
              └──► S4.1 ──► S4.2
                     │
                     ├──► S4.3* ──► S4.4 ──► S4.5      *needs a task source
                     │
                     └──► S5.1 ──► S5.2 ──► S5.4
                                     │
                                     └──► S5.3

S6.1 ──► S6.2 ──► S6.3
S6.4 (needs drift-ingestion confirm)
```

## What to cut if the epic is too big

In this order, and for these reasons:

1. **S4.3 Progress** — if no task source, it's a read-only duplicate. The duplicate-work guard (S4.2), which addresses the stated failure of losing track, lives on pickup and survives the cut.
2. **S6.3 gap pull** — the exception, not the flow. S6.2 delivers the value.
3. **S5.3 label learning** — but understand the cost: without it, capture is a nicer blank grid and the system does not get cheaper with use.

**Do not cut Phase 1 or Phase 2.** Phase 1 is the brand promise across both products. Phase 2 is the MVP — the copy-and-customize function that replaces retyping from a spreadsheet, which is the release business would already be happy with.
