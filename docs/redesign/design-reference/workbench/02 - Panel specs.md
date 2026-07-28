# 02 — Panel specs

Primary reference: `9 - Workbench Prototype.dc.html`. Visual diff for the token work: `7 - Workbench Panel.dc.html`.

All values here are final. Colors are named against doc 09 tokens; literal hex is given so this document stands alone.

---

## 2.1 Shell

```
Chrome header (not ours — ~38px: icon + "Minted Panel Workbench" + ✕)
├─ Account row        44px   org switcher · spacer · search · avatar
├─ Case card          auto   provider · payer, sub-line, status pill, release ✕
├─ Contextual offer   auto   changes with the active tab (2.4)
├─ Segmented tabs     30px   Details | Progress
└─ Body               fill   Details / Progress / Fields on the card
```

Body background `#FDFDFC`. Horizontal padding `14px` throughout. Vertical rhythm between blocks `11–13px`.

Every sibling group uses flex or grid with `gap` — never margin-spaced inline siblings.

### Account row

- Org switcher: name 13.5px/400 `#1F2937`, 13px chevron `#6B7280`, inside a 28px hit area, `margin-left:-8px` so the text optically aligns with content below. Hover `#F5F4F1`, radius 4.
- Spacer flexes.
- Search: 26px button, radius 4, 16px magnifier stroke `#6B7280`, hover `#F5F4F1`.
- Account: 26px circle, `#1B4D3E` fill, white 11px/600 initial. Menu holds email and Sign out.

**Replaces** the current header's raw email plus a green "Sign out" link, which is unreadable on the forest bar. If a text treatment is kept anywhere on dark, use `#A7B5AD`.

### Case card

White, `1px solid #E8E5E0`, radius 6, padding `9px 11px`.

- Title 13.5px/600 `#1F2937`, single line, ellipsis.
- Sub-line 12px `#6B7280`, single line, ellipsis. Pattern: `location · state`.
- Status pill: 19px tall, radius 4, 10.5px/600, padding `0 7px`, flex-none, no wrap.
- Release ✕: 22px button `#9CA3AF`, tooltip "Put back — pick another case". Returns to the queue.

**Status pill colors** — internal case status only:

| Status | Background | Ink |
| --- | --- | --- |
| Not Started | `#F5F4F1` | `#6B7280` |
| In Progress | `#E8EEFD` | `#1D4ED8` |
| Action Required | `#FEF3C7` | `#92400E` |
| Submitted / Approved | `#E7F5EF` | `#047857` |
| Denied | `#FEF2F2` | `#B91C1C` |
| Not Pursuing | `#F5F4F1` | `#9CA3AF` |

### Segmented tabs

Height 30, padding `0 13px`, 12.5px/500, transparent background, radius `4px 4px 0 0`.
Active: `#1B4D3E` ink plus `box-shadow: inset 0 -2px 0 #1B4D3E`. Inactive: `#9CA3AF`.
A `1px #E8E5E0` rule runs beneath, inset by the panel padding.

Two tabs only. The field picker is not a tab — it is a push view reached from the Details gear, with a back chevron.

---

## 2.2 Queue (no case in hand)

The panel opens here when nothing is in hand. It **also reads the active tab**.

**Context card** (top): padding `10px 11px`, radius 6, with a 7px status dot. Title 13px/600, sub 12px `#6B7280`.

| Active tab | Dot | Background | Border | Title | Sub |
| --- | --- | --- | --- | --- | --- |
| Unrecognized | `#9CA3AF` | `#F5F4F1` | `#E8E5E0` | No page to work from | Pick a case, then open the payer's portal — or open a portal first and the panel will surface the cases that use it. |
| Known payer form | `#1B4D3E` | `#F7FAF8` | `#C8DBD4` | *Portal name* | Proven form. *N* cases in your queue fill from this page. |
| CAQH | `#1D4ED8` | `#F6F8FE` | `#CBD9F7` | CAQH ProView | Pick a case and the panel fills CAQH from our record, then records the attestation. |
| Unknown form | `#C69A3F` | `#FCFBF7` | `#EADFC4` | We don't know this form yet | Pick a case and the panel proposes matches for its fields from labels seen on other payers. |

**List heading** 11px/600 uppercase `.06em` `#9CA3AF`, margin `14px 0 7px`. Reads "Next up", or **"Cases that use this page"** when the tab is a recognized payer form.

**Case rows**: white, `1px solid #E8E5E0`, radius 6, padding `10px 11px`, hover `border-color:#1B4D3E`, gap 8 between rows.
- Title 13.5px/600, ellipsis.
- `THIS PAGE` chip when the case matches the active portal: 19px, radius 4, `#E7F5EF` / `#047857`, 10px/600.
- Status pill right.
- Sub-line 12px `#6B7280`.
- **Reason line** 11.5px `#9CA3AF` — comes from the case workflow: `"Task 2 due Jul 28 · from the case workflow"`, `"Payer asked for a signed W-9 · overdue 2d"`. The panel does not compute its own ranking.

Matching case sorts first. Footnote 11.5px `#9CA3AF`: "Opening a case from the web app lands here too — org, provider, location and case already resolved."

**Why this exists:** today the coordinator resolves org → provider → location → case from four dropdowns every session. That is the "a lot to set up" complaint made visible. The queue and the app launch (C1) both remove it.

---

## 2.3 Guard states

Both render between the case card and the contextual offer.

### Duplicate work
`#FEF3C7` background, `1px solid #FDE68A`, radius 6, padding `9px 11px`, ink `#92400E`, 15px warning triangle.

> **Submitted 6 days ago.** A PNM enrollment was logged on this case on Jul 21.

Two underlined actions, 12.5px: **Continue anyway** (dismisses) and **See the touchlog** (opens the case).

**Fires on pickup**, not at submit — after the work is done is too late to prevent it. Never blocks.

### Case mismatch
White, `1px solid #E8E5E0`, padding `10px 12px`. Body 12.5px `#6B7280` naming the case this page belongs to, with the provider and payer in `#1F2937`/600. One action: **Switch to that case**, 12.5px/500 `#1B4D3E` underlined.

---

## 2.4 Contextual offer

### A. Known payer form — verb: write

Dark card `#0C2A1D`, radius 6, padding `11px 12px`.

- Title 13.5px/600 `#FFFFFF` — `"Fill 18 of 18 fields"`.
- Sub 11.5px `#A7B5AD` — states whether anything will be skipped **and why**: "Every mapped field has a value. Nothing will be skipped." / "Group NPI has no value and will be skipped."
- `PROVEN` chip right: 19px, radius 4, `rgba(255,255,255,.12)` on `#C8DBD4`, 10px/600.
- Button: full width, 34px, `#C8DBD4` background, `#0C2A1D` ink, 13px/600, radius 4 — **"Fill this page"**.

**Unproven form:** same card, no `PROVEN` chip; button styled secondary (`#F5F4F1` / `#9CA3AF`) with a note that the form has not passed a coverage check. Do not offer a confident fill on an unproven form.

**After the run** — card becomes `#F7FAF8`, `1px solid #C8DBD4`:
- Title 13px/600 `#1B4D3E` — `"17 filled · 1 skipped"`.
- Sub 12px `#33463C` naming the skipped field and why.
- One confirmation: **"Mark form step done"** — 30px, `#1B4D3E`, white 12.5px/500 — beside a quiet "Not yet" 12.5px `#6B7280`.
- After confirming: green check plus 12px `#33463C` "Recorded on the case timeline — nothing to re-enter in the app."

> **Critical:** the report must be a **snapshot** taken when the fill ran. It must not recompute. If the coordinator later fixes the missing value, a past report that silently rewrites itself from "17 filled" to "18 filled" is a defect — it rewrites history in front of the user. Only the pre-fill CTA and its sub-line reflect current data.

### B. CAQH — verb: write

Coordinators **push to** CAQH and attest. CAQH is a destination, not a source.

Same dark fill card, with `ATTEST` instead of `PROVEN`:
- Title `"Update CAQH — 12 fields"`.
- Sub `"Fills from our record, then attest. Last attested Mar 14, 2026."`
- Button "Fill this page".

After the fill: `#F7FAF8` / `#C8DBD4` report, then one action **"Record attestation"** (30px `#1B4D3E`). Confirmed state: green check, "CAQH last attested date set to today on the provider record."

**Exception strip** beneath, white `1px solid #E8E5E0`, radius 6, padding `10px 11px`:
- Eyebrow 11px/600 uppercase `#9CA3AF` — "Only CAQH has this"
- Row: label 12.5px `#6B7280` · value mono 12.5px `#1F2937` · **"Pull into our record"** 11.5px/500 `#1B4D3E` underlined
- Footnote 11.5px `#9CA3AF`: "Rare — only surfaces when CAQH holds a value we have blank."

Pulling stamps `verified_at` and immediately upgrades the next payer fill (17/18 → 18/18). Keep this strip small — pulling is the exception; the flow is push.

### C. Unknown form — verb: record

White card, `1px solid #C8DBD4`, radius 6, padding `11px 12px`.

- Title 13.5px/600 `"We recognise 14 of 19 fields"`, `NEW` chip (`#FBF0E1` / `#B45309`).
- Sub 12px `#6B7280`: "Matched from labels seen on other payers. Confirm and this form is set up for everyone."

Rows, divided `1px #F5F4F1`, padding `8px 10px`:
- Their label 12px `#1F2937`
- Then either the match — 11.5px/500 `#047857` plus evidence 10.5px `#9CA3AF` (`"· seen on 9 payers"`) — or an actionable gap, 11.5px/500 `#B45309` underlined (`"No match — assign Effective date (Location)"`)
- Overflow row 11.5px `#9CA3AF`: "+ 10 more matched with high confidence"

Submit button is **disabled-styled** (`#F5F4F1` / `#9CA3AF`, cursor default) reading "Send 18 — assign the gap first" until every gap is assigned, then `#1B4D3E` white "Send 19 proposed mappings".

**Sent state:** `#F7FAF8` / `#C8DBD4`. Title "19 proposed mappings sent for review". Body: nothing fills from a proposed row; approve here, or in the Template Editor to review the whole form at once; each approval teaches the next payer. Actions: **"Approve all 19"** (30px `#1B4D3E`) and a link "Open in Template Editor →".

**Never a blank grid.** It proposes, and says why. That is the answer to "manually translating and hoping it goes well."

---

## 2.5 Details tab

**Header row:** status line 11px/600 uppercase `.06em` `#9CA3AF` — "Tap a value to copy it" → "3 of 9 copied". Then "Reset" 11.5px `#1B4D3E` underlined, and a **26px gear** (white, `1px #E8E5E0`, radius 4, hover `#F5F4F1`, 14px stroke `#6B7280`) opening the picker.

**Grouping:** section header per catalog group, 10px/600 uppercase `.07em` `#9CA3AF`, margin-bottom 5. Each group is a white card, `1px solid #E8E5E0`, radius 6, rows divided `1px #F5F4F1`. Groups spaced 14.

Grouping by section is what lets the card carry any number of fields — length stops mattering.

**Row:** min-height 34px, padding `6px 11px`, `flex-wrap: wrap` so long values reflow instead of truncating. Label 12.5px `#6B7280` flexes, min-width 88. Value mono 13px `#1F2937`, `word-break: break-word`. Trailing 15px icon slot.

- Click copies to clipboard. Hover `#F7FAF8`.
- **Copied:** row background `#F7FAF8`, icon becomes a `#1B4D3E` check, and it **stays marked**. That memory is what a spreadsheet cannot do — a coordinator working down a long form can see what they already pulled.
- **Just verified** (pulled from CAQH this session): value renders `#047857`.
- **Absent:** value reads "Not on file" in `#9CA3AF`, icon is an amber `#B45309` info circle, row is not clickable (cursor default). The group shows a footnote in `#F5F4F1` at 12px `#6B7280`: "Group NPI has no value on this provider — check CAQH or open the provider record."

Absent is a **state**, not a blank. Never render an empty cell.

---

## 2.6 Progress tab

Scoped to the case's tasks and steps for the portal in hand — not a second copy of everything on Case Detail.

- Title 14px/600, count 12px `#6B7280` ("2 of 4 done").
- Progress bar: 4px, radius 2, track `#E8E5E0`, fill `#1B4D3E`.
- Step list: white card, `1px solid #E8E5E0`, radius 6, rows divided `1px #F5F4F1`, padding `11px 12px`.

**Step row:** 16px checkbox (radius 4; done = `#1B4D3E` fill with a white 13px check; not done = white with `1px #C9C5BE`), label 13px, meta 11.5px `#9CA3AF`. Done rows go `#9CA3AF` with `line-through`.

- The step matching the current tab carries a `THIS PAGE` chip (17px, radius 3, `#E7F5EF` / `#047857`, 10px/600) and a `#FBFDFC` row tint.
- After a fill, that step's meta reads "Online form · filled 17 of 18 just now" — **from the snapshot**, not recomputed.

**Payer reference:** white card, eyebrow 11px/600 uppercase, input 32px `1px #E8E5E0` radius 4, note 11.5px `#9CA3AF`: "Overwrites the case's current reference. Latest wins."

**All steps done** → one full-width 36px `#1B4D3E` button: **"Record submission — case to Submitted"**. After firing: `#F7FAF8` / `#C8DBD4` card, title 13px/500 `#1B4D3E` naming the reference, body 12.5px `#33463C`: "Touch logged, task closed, fill report attached. Nothing is re-recorded in the web app."

> If step completion cannot write (C2 / E4.3), Progress is a read-only duplicate of Case Detail and should not ship as a tab. Completion is the point.

---

## 2.7 Fields on the card (the picker)

Replaces the Customize view, which is broken as shipped: labels right-align outside their rows, the checkbox floats over the row instead of sitting in it, row widths are inconsistent, and the list runs past the fold with no reachable Save or Cancel.

**Header:** back chevron (24px, hover `#F5F4F1`), title 14px/600 "Fields on the card", count 11.5px `#6B7280` right ("11 of 127").

**Search:** 32px, white, `1px #E8E5E0`, radius 4, 14px magnifier `#9CA3AF`, placeholder "Search 127 fields…". Filters across all 127; typing auto-expands matching groups and hides empty ones. Clear ✕ appears when non-empty.

**Groups** (collapsible): header 34px, `#FDFDFC`, bottom border `1px #E8E5E0`, hover `#F5F4F1`. Caret 11px `#6B7280` in an 11px slot. Name 12.5px/600, ellipsis. Count right, 11px/500 — `"3 of 45"` in `#1B4D3E` when any picked, else `"of 45"` in `#9CA3AF`.

**Field row:** min-height 32px, padding `5px 12px 5px 32px`, divided `1px #F5F4F1`, hover `#F5F4F1`. 15px checkbox (radius 3; on = `#1B4D3E` + white check; off = white + `1px #C9C5BE`). Label 12.5px, `word-break: break-word`, `#1F2937` when on, `#6B7280` when off.

**No results:** white card, 12.5px `#6B7280` — `Nothing matches "xyz".`

**Footer:** **Save layout** 32px `#1B4D3E` white 13px/500, beside Cancel 13px `#6B7280`. Both always reachable.

**Why not tabs:** seven group tabs truncate below ~400px. Search plus collapse holds at 320px. Verify at 320 before shipping.

**PHI note:** `SSN last 4` is in the catalog and selectable. It must obey the same in-memory-only rule as every other value — never persisted, never in a restored view.
