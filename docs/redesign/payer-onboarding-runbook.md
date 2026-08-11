# Payer Onboarding Runbook

A fill-in worksheet the team completes once per payer × state, then encodes
directly into the system. Every section maps 1:1 onto a configuration surface
(noted in brackets), so a completed runbook IS the build plan for that payer.

Owner: the config user (P4/P1). One runbook per payer × state you operate in.

---

## 1. Payer identity & attachment

_[Payer & SOP admin module — payer directory + attachment (E1.6/E1.5)]_

| Field                               | Value |
| ----------------------------------- | ----- |
| Payer (catalog name)                |       |
| State(s) we operate in              |       |
| Attached to which org(s)            |       |
| Network targets / lines of business |       |

The payer's identity metadata (name, aliases, CMS/HIOS ID) comes from the
global payer catalog — do not re-enter it; attach and configure.

## 2. Payer-level configuration

_[Payer config (E4.2 F4.2.1/F4.2.3) — lives on the payer, NOT in the SOP]_

| Field                                                    | Value |
| -------------------------------------------------------- | ----- |
| Payer-issued ID label(s) (e.g. Aetna "Provider PIN")     |       |
| Individual ID expected at approval? (Type 1 NPI-linked)  |       |
| Group/billing ID expected at approval? (Type 2 / Tax ID) |       |
| Denial reason codes seen with this payer                 |       |
| Stale-case nudge threshold (default 14 days)             |       |

## 3. Submission path

Pick the primary path — it decides which step types the SOP uses and whether
form onboarding (section 6) applies.

**Execution type (Template Editor):** author **Manual** or **Auto-fill** only.
Do **not** pick Auto verify or Document attach — those wire values still exist
for legacy stamps but are inert and hidden from new selections
(BITE-SOP-TT-02).

- [ ] **Portal / autofill** → Execution type **Auto-fill** (`extension_fill`) +
      step type **Online form** (`online_form`) + a linked **Portal**. All three
      together are what turns on form setup, readiness, and Workbench fill.
- [ ] **PDF packet** → Execution type **Manual** + `pdf` steps (+ `mail` or
      `fax` to send).
- [ ] **Email** → Execution type **Manual** + `draft_email` steps with a
      prefilled subject/body template.
- [ ] **Fax / phone / mail only** → Execution type **Manual** + `fax` /
      `phone` / `mail` steps with turnaround and cadence day counts.

| Field                                    | Value |
| ---------------------------------------- | ----- |
| Portal URL / portal key (if portal path) |       |
| Login / access notes (never credentials) |       |
| Typical turnaround (days)                |       |
| Follow-up cadence (days)                 |       |

## 4. The SOP itself — actions (tasks and steps)

_[Template wizard: Basics → Actions → Review → Publish
(E1.7b Model A; E4.2 execution types; BITE-SOP-TT-03/04 Action language)]_

Match key: payer = section 1, state = section 1, specialty = ______,
group = ______ (leave "Any" unless a customer-specific override is needed —
global templates are shared across orgs; org-specific ones win automatically).

**Add action presets:** use **Add action → Portal / Auto-fill** (or Draft
email / Phone / Fax / Mail) so each checklist item starts with Mode +
execution already paired — do not begin from an empty Manual shell. Rename
the action; pick the portal on the portal path. Add another step under an
action only when you need a multi-step checklist under the same due date
(D-SOP-4 A).

For each action, list its ordered steps. Step types: `online_form`,
`draft_email`, `pdf`, `fax`, `phone`, `mail`.

| #   | Action name | Execution type (`manual` / Auto-fill=`extension_fill` only) | Steps (type — label — cadence/turnaround) | Due offset / assignee default |
| --- | ----------- | ----------------------------------------------------------- | ----------------------------------------- | ----------------------------- |
| 1   |             |                                                             |                                           |                               |
| 2   |             |                                                             |                                           |                               |
| 3   |             |                                                             |                                           |                               |

Data fields per step: which provider tokens does the step consume
(e.g. `provider.caqhId`, `provider.npi`)? These come from the closed token
catalog — if a needed field has no token, flag it; do not free-text it.

## 5. Required profile attributes (the generation gate)

_[SOP builder — required profile attributes (E4.2 F4.2.6)]_

List every provider-profile field this payer requires that is commonly
missing (e.g. CAQH ID, 10-year work history, malpractice coverage amounts).
Generation preview blocks providers missing these and offers a prefilled
outreach task — so listing them here is what prevents phantom-provider stalls.

| Required attribute | Why the payer needs it |
| ------------------ | ---------------------- |
|                    |                        |

## 6. Form onboarding (portal path only)

_[Portal training + test runner (E4.2 F4.2.7); skip for non-portal payers]_

1. **Capture:** open the live form (the Template Editor's "Open form" opens the
   portal only — it does not capture). On the portal page, open the extension
   side panel; the first time you visit a portal the manifest doesn't statically
   cover (anything other than BCBS KS — e.g. Aetna) the panel shows **"Enable
   form capture & fill"** — click it and approve the one-time site-access prompt
   so the extension can read the form. Then **Capture this form → Send for
   approval**; observed fields land as proposed field maps in Form setup.
2. **Train:** resolve proposals at `/portals/$key/train`
   (batch-confirm high-confidence; Approve/Edit/Manual per card).
3. **Test run:** dry-run fill with the designated test provider; review the
   per-field report (filled / skipped-unmapped / empty-token). Nothing
   submits.
4. **Fix & re-run** until mapping coverage is acceptable.

| Field                           | Value |
| ------------------------------- | ----- |
| Mapping coverage after training |       |
| Test-run result (date, outcome) |       |

## 7. Go-live checklist

- [ ] Payer attached for every operating state (section 1)
- [ ] ID labels + reason codes configured (section 2)
- [ ] SOP published; readiness signal shows **Ready** for this payer × state
- [ ] Required profile attributes declared (section 5)
- [ ] Portal path only: form readiness / mapping coverage acceptable +
      dummy-provider test run passed (section 6)
- [ ] Probe release first (F4.2.4): a small filtered batch (one location or a
      provider cap) → check first-pass rate and Fix-It volume → then release
      the remainder

## Worked examples

- **Portal payer (Aetna NC):** Task 1 "Prepare CAQH" (Manual; `online_form`
  CAQH + `phone` verify) · Task 2 "Submit application" (Auto-fill +
  `online_form` Aetna portal + Portal linked) · Task 3 "Follow up" (Manual;
  `phone`, 14-day cadence). Requires section 6.
- **Paper payer (small Medicaid MCO):** Task 1 "Complete enrollment packet"
  (Manual; `pdf` + `mail`) · Task 2 "Fax W-9 + roster" (Manual; `fax`,
  5-day turnaround) · Task 3 "Confirm receipt" (Manual; `phone`). Section 6
  skipped.
- **Email payer:** Task 1 "Send enrollment request" (Manual; `draft_email`
  with token placeholders) · Task 2 "Follow up" (Manual; `draft_email` +
  `phone`).
