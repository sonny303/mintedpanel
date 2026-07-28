# 05 — Use cases

Ten end-to-end walkthroughs. Each names the trigger, the steps, what the system does, and what it must never do. These are the acceptance scenarios for doc 08.

You can run 1, 2, 3, 5, 6 and 8 in `9 - Workbench Prototype.dc.html` — the dark card there is the demo script.

---

## UC-1 — The happy path: pick up, fill, record

**Actor:** coordinator, panel open, no case in hand.

1. Panel shows the queue. Coordinator picks **Jim Apple · Banner Health Plans**.
2. The duplicate warning fires immediately — a PNM enrollment was logged on this case 6 days ago. Coordinator reads it and chooses **Continue anyway**.
3. Context card offers **Open Banner PNM** — the next step needs that portal.
4. On the form, the offer reads **Fill 17 of 18 fields**, with the sub-line naming Group NPI as the one that will be skipped and why.
5. Coordinator runs the fill, verifies the page, and taps **Mark form step done**.
6. Progress: ticks the remaining steps, types the confirmation number, taps **Record submission**.
7. Case moves to **Submitted**. Case Detail's touchlog gains a green Workbench entry with the reference and the fill counts; the timeline records `workbench touch` as evidence.

**Must never:** report a bare count without naming what was skipped · rewrite the fill report after the fact · require re-entering the reference in the app.

---

## UC-2 — Launched from the app

**Actor:** coordinator working in Case Detail.

1. Coordinator opens a case in the web app and uses the launch action.
2. Context crosses (C1): org, provider, location, case, portal key.
3. The panel opens — or, if the gesture doesn't forward, the portal opens and the panel picks up context on its next focus.
4. The case is already in hand. **Zero dropdowns.**

**Must never:** make the coordinator re-select org → provider → location → case after arriving from a case they just had open. That round trip is the single loudest complaint in the current product.

---

## UC-3 — Portal first, case second

**Actor:** coordinator who opened Banner PNM directly, no case in hand.

1. Panel reads the tab. Context card names the portal and states that cases in the queue fill from this page.
2. The list heading changes to **Cases that use this page**; the matching case sorts first with a `THIS PAGE` chip.
3. Coordinator picks it and continues as UC-1 from step 4.

**Why it matters:** this is how a coordinator actually works — the portal is often already open. If the panel ignores the tab, every session starts with a search.

---

## UC-4 — Wrong case for the page

**Actor:** coordinator holding the BCBS Kansas case, who navigates to Banner PNM.

1. Panel detects the portal maps to a different case.
2. The fill offer is **suppressed** — no offer to fill Banner with the BCBS case's context.
3. A quiet card names the case this page belongs to and offers **Switch to that case**.
4. Switching carries the duplicate check with it.

**Must never:** offer a confident fill using the wrong case's data. A wrong submission to a payer is far more expensive than a missed shortcut.

---

## UC-5 — Missing value, fixed at the source, then refilled

**Actor:** coordinator who just saw "17 filled · 1 skipped — Group NPI".

1. Details shows Group NPI as **Not on file**, with the group footnote suggesting CAQH or the provider record.
2. Coordinator switches to CAQH ProView with the same case in hand.
3. Panel offers to update CAQH from our record and record the attestation; beneath it, the exception strip: **Only CAQH has this — Group NPI 9876543210**.
4. Coordinator taps **Pull into our record**. The field is written and stamped verified.
5. Details now shows Group NPI in green. Back on Banner, the offer reads **Fill 18 of 18 fields**.

**This is the compounding loop made concrete:** a gap found during one submission is closed at the source, and the next fill is complete. Note the direction — the primary CAQH action is *push*; the pull is the exception.

---

## UC-6 — A payer we've never set up

**Actor:** coordinator on an unrecognized credentialing form.

1. Context card: **We don't know this form yet.**
2. Panel proposes: **We recognise 14 of 19 fields.** Each match names our field and its evidence — "seen on 9 payers".
3. One field, "Svc Loc Effective Dt", has no match. Coordinator assigns it from the suggestion.
4. Submit enables: **Send 19 proposed mappings**.
5. Sent state offers **Approve all 19** right there — the same person captured and approves — with the Template Editor as the whole-form alternative.
6. Once approved, the form is set up for both users, and the assignment feeds the label-learning store so the next payer with a similar label arrives pre-matched.

**Must never:** present a blank grid and ask someone to figure out what a payer's field names mean. That is the complaint this whole seam exists to answer.

---

## UC-7 — The form changed under us

**Actor:** coordinator filling a form that used to work.

1. Fill reports fields skipped that previously filled.
2. The panel reports the dead selectors on its own (C5) — the coordinator is **not** asked to diagnose anything.
3. Payer Setup's `Drift detected` KPI counts it; the drift banner names the source: "reported by a Workbench fill on Jul 24".
4. The banner deep-links into Template Editor repair mode with the broken rows flagged.
5. Repairing marks those fields known-fragile, so the next coverage check watches them first.

**Must never:** silently skip a field that used to fill. Silent degradation is how a coordinator learns to stop trusting autofill.

---

## UC-8 — Keeping CAQH current

**Actor:** coordinator doing routine attestation.

1. On CAQH with a case in hand, the offer reads **Update CAQH — 12 fields**, naming the last attested date.
2. Fill runs from our record. Coordinator reviews on the page and completes CAQH's own attestation flow.
3. Back in the panel: **Record attestation**.
4. `caqh_last_attested_date` is set, and every field the fill carried is stamped `verified_at`.

**Consequence:** freshness becomes a real state instead of a guess, without anyone running a data cleanup project.

---

## UC-9 — The panel restarts mid-work

**Actor:** coordinator whose MV3 worker was evicted between actions.

1. Panel reopens. Case identity, tab context, field labels and counts are restored.
2. **No values are restored** — they were only ever in memory.
3. The panel says what came back rather than rendering a half-empty card that looks like data loss.
4. Progress ticks that were already written are intact; anything unsent is clearly marked unsent.

**Must never:** persist PHI to survive a restart, or imply that unsent work was saved.

---

## UC-10 — Recording fails

**Actor:** coordinator who taps Record submission while offline.

1. Local ticks and the typed reference are retained.
2. An explicit failure state says nothing has been recorded yet, with a retry.
3. Copy still works — values are in memory, which is genuinely useful offline.
4. Nothing about the case changes app-side until the write succeeds.

**Must never:** show a success confirmation for a write that didn't happen. Every other trust problem in this product is recoverable; this one isn't.
