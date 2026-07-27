# Payer & Cases — design handoff

**For:** Devin (review) → Claude Code (build)
**Scope:** six screens. Payer Setup, Add/Edit Payer, Payer Detail, Template Editor, Case Close & IDs, Case Detail.
**Not in scope:** the Minted extension (deliberately deferred — all extension copy has been swept out of these screens), the Cases list and Provider Detail (already shipped; frozen bundle in `design_handoff_cases/`).

---

## How to read this package

The `.dc.html` files are **design references** — prototypes of intended look and behavior, not production code. Rebuild with the app's existing components and tokens. Open `Index - All Screens.dc.html` first: it lists every screen and every state with how to reach it.

Most states are reachable in the prototype via a **Tweaks** prop or a URL fragment; both are named in the state tables below.

**Because this is a large change set, each screen below has a `Change vs. today` line.** That is the actual delta to implement — read those first to scope the work.

---

## Contents

| File | Screen |
| --- | --- |
| `1 - Payer Setup.dc.html` | The payer list |
| `2 - Add or Edit Payer.dc.html` | Create / edit a payer |
| `3 - Payer Detail.dc.html` | One payer, six tabs |
| `4 - Template Editor.dc.html` | Author a template + its portal form |
| `5 - Case Close and IDs.dc.html` | Close dialogs + where captured IDs display |
| `6 - Case Detail.dc.html` | Work one case |
| `Index - All Screens.dc.html` | Every screen and state, plus open questions |
| `Index - Journeys.dc.html` | Seven journeys with start/end conditions |
| `github.md` | Schema research receipts and approved divergences |
| `support.js` | Prototype runtime — **not for production** |

---

# 1 — Payer Setup

**Route:** `/admin/payer-admin/catalog` (segment is stale — see open items)
**Job:** which payers we work with, and how close each is to usable.

**Change vs. today:** the seeded 137-payer catalog and the SOPs tab are both **removed**. The page becomes a single list with no tabs. Payers now enter the system only through "+ Set up payer".

### Layout
Header (title + live count) → divider → 4 KPI cards → toolbar (search · State · Kind · Show archived · **+ Set up payer**) → table → default-template card → footer (rows-per-page + pagination).

### KPI cards — each is a filter toggle
| Card | Counts |
| --- | --- |
| All payers | every non-archived payer |
| Needs template | no published template names this payer |
| Form not proven | template exists, portal form not yet registered/mapped/proven |
| Drift detected | a previously-working form has broken mappings |

### Table
`Payer · State(s) · Kind · Template status`. Payer name is the only link. Template status is **Published** or **Needs template** — one badge, no Partial.

### States
| State | How to reach | Notes |
| --- | --- | --- |
| Populated list | default | 10 rows/page; 5/10/25/50/100 |
| Zero payers | `emptyOrg` tweak | Three-step orientation → "Add your first payer" |
| Filtered to none | filter to no match | "Clear filters" — **not** "add a payer" |
| Archived rows | Show archived | Archived badge + Reactivate |
| Default template card | always | Payerless fallback; edit-only, no create path |

### Deliberately removed — do not re-add
Next-step CTA column · drift alert banner · drafts-in-progress strip · meta subtitle under the payer name · membership KPIs and the `+N more` state disclosure (went with the catalog).

---

# 2 — Add or Edit Payer

**Route:** `/admin/payers/new` · `/admin/payers/$id/edit`
**Job:** create a payer deliberately, or edit its catalog facts.

**Change vs. today:** in-app payer creation **does not exist**. This is a new surface and needs the payer-create API.

### Flow
**Step 1 — Name + near-match.** Type the name; existing payers surface before any other field. This is the guardrail against duplicate payer records. Either use the match, or continue creating.

**Step 2 — Details.** Kind · states (searchable multi-select, all 50 + DC) · aliases · ID expectations · delegation note.

### ID expectations — the part that drives screen 5
Two rows, each a checkbox plus the payer's own name for that ID:

| Row | Scope | Feeds |
| --- | --- | --- |
| Group-level ID | One per group | `payer_network_targets.payer_issued_id` |
| Provider-level ID | One per provider | `enrollment_facts.payer_issued_id` |

Copy on the section: *"If this payer issues a group-level or provider-level ID, tick it below and name it the way the payer does."*

### States
| State | Fragment |
| --- | --- |
| Name + near match | `#name` |
| Details — new | `#create` |
| Edit payer | `#edit` |
| Edit — payer issues no IDs | `#editnone` |

### Removed
Merged-payer redirect, and the status/merge read-only cards. Merge lives on Payer Detail → Manage.

---

# 3 — Payer Detail

**Route:** `/admin/payer-admin/catalog_/$payerId`
**Job:** everything about one payer, and the place to act on it.

**Change vs. today:** production is a flat, read-only section list. This is **tabbed and editable**, and adds Enrollments, Scorecard, and Manage.

### Tabs
| Tab | Contents |
| --- | --- |
| **Overview** | Identity & enrollment ID (editable) · aliases (add/remove inline) · delegation note (editable) · state coverage · contacts |
| **Enrollments** | Providers credentialed with this payer — ID under the payer's own label, effective date, source case. Read-only. Awaiting-ID rows flagged. |
| **Cases** | Open cases by **payer pipeline stage** (the external machine — see Two status machines) |
| **Templates** | Template list with state coverage in the header; empty state carries "+ Author template" |
| **Scorecard** | Mapping coverage · first-pass rate · avg time in bucket. Admin & billing. |
| **Manage** | Archive payer · Merge payer |

### Contacts
purpose · email · phone · notes, with one marked **Default** — that is the contact a template's Draft-email step addresses. Inline add form; per-row Make default / Remove.

### Manage — the two lifecycle actions
- **Archive** — leaves the list, reversible, nothing deleted, no new cases. **Blocked while open cases exist** (dialog says how many and links to them).
- **Merge** — pick the surviving payer; templates, IDs, and open cases move; this payer's name becomes an alias on the survivor. Cannot be undone from the app.

> "Remove from network" was collapsed into Archive. With the catalog gone the payer list *is* the org's network, so both actions produced the same user-visible outcome.

### States
`payer` tweak switches **Banner Health Plans** (no template, empty enrollments — the fresh case) and **Aetna (CVS Health)** (fully configured). `defaultTab` opens any tab.

### Removed
Network & contracts table · submission routing · Activity tab · portals card (portals are authored in the template's form step) · avg decision days · the org-level label override group (that tier was retired app-side 2026-07-20).

---

# 4 — Template Editor

**Route:** `/admin/templates/new` · `/admin/templates/$id`
**Job:** author or edit one template end to end, including its portal form.

**Change vs. today:** three wizard steps, not four — Tasks and "Steps & fields" rendered the same list twice. The standalone form runner is folded in (production already retired it). Tier is **derived from the match key**, not chosen separately.

### Steps
1. **Basics** — template name · **payer (fixed from context, not a dropdown)** · state (incl. "All states") · groups (searchable Org — Group multi-select, scoped to the chosen state) · required provider attributes.
2. **Tasks & steps** — each task holds its own ordered steps. An online-form step owns the whole portal lifecycle inline.
3. **Review** — match key summary, then Publish.

### The online-form step — five inline modes
| Mode | Fragment | What it shows |
| --- | --- | --- |
| Register | `#edit&intent=register` | Portal name, immutable key, optional form URL |
| Capture | `#edit&intent=capture` | Portal registered, no fields captured yet |
| Map | `#edit&intent=train` | Captured fields, each needing a token |
| Repair | `#edit&intent=repair` | Broken-first, repair framing, "Broken only" toggle |
| Prove | `#edit&intent=prove` | Coverage check with a persistent pass/fail result |

A readiness CTA deep-links straight to the mode that is due, and a context banner says why you are there. **The banner is derived from live step state** — it disappears when the work is done.

> **What "check coverage" actually does:** fills the form from a synthetic profile (fake values, no provider data, no PHI) and reports whether every field knows what fills it. Nothing is submitted. A pass proves the form.

### Versioning — deliberately light
v-chip in the header · **History** drawer listing versions with restore-as-new · publish captures one **optional** change note. Cases in flight keep the version they started on. This is intentionally less ceremony than production's versioning.

### Other states
`#draft` resume (hydrates a saved draft, titled "Resume draft") · `#edit-default` (the payerless fallback — no match key, exits to Payer Setup).

### Execution type
Manual · Auto-fill · Auto verify. Only **Auto-fill** changes anything today: it is what makes form setup and readiness apply to this payer. The other values are captured configuration.

---

# 5 — Case Close & IDs

**Job:** capture the IDs a payer issues, and show them where the work happens. **Cases capture; payer pages display.**

### The three close dialogs
| Close as | Required evidence |
| --- | --- |
| **Approved** | Effective date · the IDs this payer expects · contract-executed date (optional) |
| **Denied** | Reason from the governed list; **"Other" also requires one-line context** |
| **Not Pursuing** | A note |

### Approved — both / one / neither
The dialog asks for exactly what the payer issues, using the payer's own wording from screen 2 ("Group PIN", "Provider Number" — not generic "provider ID"). A payer that issues nothing gets effective date only.

**Every ID field has a "Didn't receive" escape.** Ticking it approves anyway and the enrollment reads **Awaiting ID**. Approval letters often arrive late; a missing ID must never block a close.

### Where the IDs land
| Surface | Shows | Storage |
| --- | --- | --- |
| Group payer board | Group ID per payer | `payer_network_targets.payer_issued_id` |
| Provider enrollments | Provider ID per payer | `enrollment_facts.payer_issued_id` |

Both read-only, both linking back to the case that captured the ID.

### States
`screen` tweak: `case-both` · `case-one` · `case-none` · `case-denied` · `case-np` · `board` · `provider`.

---

# 6 — Case Detail

**Route:** `/cases/$id`
**Job:** work one case end to end — the coordinator's home.

### Layout
Header → two columns. Left: Tasks, Touchlog. Right: Details, Status timeline.

### Header
Provider name (links to provider) · payer · state · specialty · group · inline-editable **tracking ID** with copy · the **one** status pill · **Update status** menu · attribution line ("Action Required · 2d ago by Sowmya — evidence: portal touch").

### Update status menu
Forward moves (optional note) → the three close-as entries, which open screen 5's dialogs → **Correct status…** (admin: any direction, note required, appended to history).

### Tasks
One list — the step-at-a-time wizard is retired. Each task shows execution type, due offset, and its ordered steps; the current step opens a **drawer** with the portal chips, the resolved field values for this provider, and Mark step done.

### Touchlog
Seven touch types (Call · Portal Check · Email · Fax · CAQH Update · Provider Outreach · Internal Sync). The composer captures date, type, recipient + contact, optional outcome, context, and next follow-up — *leaving follow-up blank keeps the existing one*. **Entries display all of that metadata**, not just author and time.

Logging a touch that implies progress offers a **status bump**, and the touch is saved as the transition's evidence.

### Right column
**Details** — Case (submitted, expected/confirmed effective, contract executed, days open, coordinator, group, **facility with full address**, forwarding ID) · Identifiers (NPI, CAQH, taxonomy, group NPI/TIN, each copyable) · Provenance (template + version + run + reapply cycle).
**Status timeline** — the unified history, each entry linking to its evidence.

### Removed
Required documents (documents are not a product capability) · Work-in-portal launcher (extension deferred) · duplicate tracking-ID warning (each submission creates a new ID per provider, so a collision is only ever a data-entry error) · the two legacy pre-unification history ledgers.

---

# Two status machines — do not merge

| | Internal | External |
| --- | --- | --- |
| Source | `src/lib/caseStatus.ts` | `src/lib/payerPipeline.ts` |
| Values | 8: Not Started, In Progress, Submitted, In Review, Action Required, Approved, Denied, Not Pursuing | 9: Not Started, Assigned, Drafting, Submitted, In Review, Action Required, Approved, Denied, Out-of-Network |
| Shown on | Cases list, Case Detail (**Case Status**) | Payer Detail → Cases (**Payer pipeline stage**) |

The repo is explicit that these are independent and "never merged into one label." Two different columns by design.

---

# Open items — for Devin

## 1 · Blocks everything
**There is no way to create a payer.** "+ Set up payer" assumes an in-app create path. With the seeded catalog removed this is the *only* way a payer enters the system, so it moved onto the critical path. Needs the payer-create API-enabler.

## 2 · Backend in flight
| Need | Blocks | Notes |
| --- | --- | --- |
| **ID-expectation columns** on the payer record | Screen 5 entirely | Two booleans + two labels. Also fixes two production limits: the group/billing label is a hardcoded constant (`GROUP_PROVIDER_ID_LABEL`), and `resolutionIdExpected` has **no consumer** — ApprovedDialog requires the individual ID even when expected=false. |
| **`payer_contacts` table** | Contacts card on screen 3 | `payer_id, purpose, email, phone, note, is_default`. `payers` has no contact columns today. |
| **Archive flag + merge operation** | Manage tab on screen 3 | Archive is reversible and blocked by open cases; merge moves templates/IDs/cases and leaves an alias. |

## 3 · Flag on review — approved divergences, not misses
- **IDs are skippable on close.** Production hard-requires the individual ID (`ready = effectiveDate && individualId`). Ours makes them conditional on payer expectations with a "Didn't receive" escape — required IDs would slow closes. Build the escape; don't "fix" it back.
- **The two legacy history ledgers are not carried over.** The unified timeline is the one history surface. Flag if business still wants the old ledgers visible.
- **Terminology is "Template" everywhere.** Production mixes "SOP" and "Template". Internal identifiers can stay as they are.
- **Versioning is lighter than production's** — one optional change note instead of the full ceremony.

## 4 · Cleanup
- **`/admin/payer-admin/catalog` is a stale route segment** — named for a catalog tab that no longer exists, with `/sops` folded in. Rename when this ships.
- **`design_handoff_payer_setup/`** predates the file rename and is superseded by this package. Delete it.

## 5 · Resolved during design — recorded so they don't get re-litigated
- Templates are scoped **payer + group**, never org-tier. "Org override" is retired.
- The **default template is editable** — no lock, no role security at day 0.
- **"Readiness" was deflated** — the composite score became plain counts and a single next step.
- The default-template card on Payer Setup is the intended place to define/edit it at any point. Edit-only is correct.

---

*Full schema research, source citations, and the reasoning behind each divergence are in `github.md`.*
