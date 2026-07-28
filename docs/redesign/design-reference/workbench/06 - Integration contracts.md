# 06 — Integration contracts

Six seams. Drawn visually in `11 - Handoff Map.dc.html`.

Payload shapes below are the **design intent**, not final API schemas — they name what has to cross and why. Confirm field names against the repos.

---

## C1 — Launch (app → panel)

**Purpose:** work arrives already resolved. Kills the four-dropdown session start.

```
{ org_id, provider_id, location_id, case_id, portal_key }
```

**Origin:** Case Detail's launch action. Also the queue, which is the same contract self-served — ranked by the **case workflow** (task due dates, overdue state), never by panel-side logic.

**Destination:** the panel opens with the case in hand.

**Status:** UI plumbing, but see the platform constraint below.

> **⚠ Spike this before building either end.** A web page cannot open a Chrome side panel. The only route is `externally_connectable` → `chrome.runtime.sendMessage` → the service worker calling `chrome.sidePanel.open()`. Since Chrome 116 that call requires a user gesture, and a gesture originating on a *web page* may not satisfy it.
>
> **If it works:** the flow is one click shorter.
> **If it doesn't:** the app opens the portal URL only, and the panel picks up context on its next focus. The design still works — but the copy must not promise the launch. The Template Editor's capture card is already worded "Open form" for this reason.

---

## C2 — Submission (panel → app)

**Purpose:** the work records itself. This is the seam that removes re-entry.

```
POST portal_submission touch
{
  case_id,
  task_id?,                 // absent in v1 — see below
  payer_reference,
  fill_report: { filled, skipped, skipped_fields[] },
  url
}
```

**Server behavior:** bump status (In Progress → Submitted), close the linked task when `task_id` is present, append the touch with the fill report attached.

**Destination, three places:**
- Case Detail touchlog — green `Workbench` entry naming the fill result and reference
- Status timeline — `workbench touch` as the transition's evidence
- The linked task — closed

**Status:** endpoints largely exist. `task_id` plumbing exists server-side (the server closes a linked task and records a `task_update` when supplied), but the panel has no task source, so **v1 sends none** and task completion stays in the app. Giving the panel a task source closes this (E4.3).

---

## C3 — Confirmation → Case Close

**Purpose:** stop the coordinator retyping a number they captured weeks earlier.

No new endpoint. The `payer_reference` stored by C2 pre-fills the approval dialog, shown with provenance and overridable.

**Destination:** Case Close approval dialog, provenance strip.

**Status:** app-side only.

---

## C4 — Capture (panel → app) — **new write path**

**Purpose:** a form we don't know becomes a form we do, without anyone reading a blank grid.

```
POST portal_field_maps[]
{
  portal_key,
  field_label,              // the payer's label, verbatim
  selector,
  suggested_source?,        // our field, when matched
  evidence: { payer_count },
  status: "proposed"
}
```

**Invariant:** a `proposed` row **never fills**. Approval flips `proposed → approved`.

**Approval happens in two places, deliberately ordered:**
1. **In the panel** — primary. The same two people capture and approve; sending them to the app to approve their own capture is a detour that violates "keep them on cases."
2. **Template Editor** — secondary, for reviewing a whole form at once. Reached via "Check for captured fields".

**This crosses a boundary that is currently locked.** `src/shared/fixit.ts` states the extension never writes mappings (R6 read-only). That boundary moving is a deliberate decision, already made — the panel stays *propose-only* and never writes an approved row.

**Also needs a capture session handshake** (E5.2): how a capture binds to a template step and portal key, and whether it survives an MV3 worker restart.

---

## C5 — Drift (panel → app)

**Purpose:** the system notices its own decay instead of waiting for a coordinator to report it.

```
{ portal_key, field, last_working_at }
```

**Origin:** a fill that hits a dead selector. The coordinator is never asked to diagnose it.

**Destination:** Payer Setup's `Drift detected` KPI and drift banner (with provenance); the banner deep-links to Template Editor repair mode with broken rows flagged.

**Status:** `formDrift.ts` exists and already lights the KPI and repair mode. **Confirm what writes to it today** before making repair depend on panel reports (E5.3).

---

## C6 — Attestation (panel → provider record) — **new write path**

**Purpose:** freshness becomes a real state, stamped by work the coordinator was doing anyway.

```
// on Record attestation
{ caqh_last_attested_date, verified_at[]: fields the fill carried }

// on Pull into our record (the exception)
PATCH provider.<field> + verified_at
```

**Direction is push.** Coordinators update CAQH and attest. **Do not build bidirectional sync.** Pulling exists only for a field CAQH holds that we have blank, and is expected to be rare.

**Needs:** read access to the full 127-field projection, plus these two writes.

---

## Three additions beyond what's already in motion

| # | Addition | Why it matters |
| --- | --- | --- |
| 1 | **Label-learning store** — a mapping made on one payer is proposed on another, with payer count as evidence | This is the mechanism that makes payer 60 cheaper than payer 6. Without it, C4 is a nicer blank grid. |
| 2 | **Per-field `verified_at`** | Turns freshness from an inference into a state. Required for the stale treatment in Details and for C6's stamping. |
| 3 | **Attestation write** — `caqh_last_attested_date` plus per-field stamps from one event | Without it, UC-8 has nowhere to land. |

---

## Sequencing summary

| Seam | Backend needed | Blocked on |
| --- | --- | --- |
| C1 | none (plumbing) | the side-panel gesture spike |
| C2 | mostly exists | a task source for `task_id` |
| C3 | none | C2 |
| C4 | new write path + handshake | the read-only boundary (decided), portal registry |
| C5 | confirm ingestion | what writes `formDrift` today |
| C6 | new write path + `verified_at` | scoping with the consolidation |
