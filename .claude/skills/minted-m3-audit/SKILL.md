---
name: minted-m3-audit
description: "Lean 3M audit for Minted Panel: review a current-state feature against Muda (waste), Mura (unevenness), Muri (overburden), and score Sowmya's end-user workflow efficiency. Use on audit, M3, 3M, lean review, muda, mura, muri, review feature, current state."
---

# Minted M3 Audit: Lean Review of a Current-State Feature

Invoke when auditing an existing (already-built) feature in Minted Panel. Not for debugging — this is a health check. Scores the feature and Sowmya's workflow against Lean's three wastes: Muda, Mura, Muri.

## Scope

**Input:** One current-state feature (e.g., "the Cigna PT case submission flow" or "the touchlog review screen").

**Output:** A 3M score with specific findings, ranked by impact, plus a short list of what to fix first.

This is not a comparison against a proposal. It's a health check on what's live today.

## The Three Lenses

```
MUDA — Waste (steps, clicks, data, code that add no value)
MURA — Unevenness (inconsistent behavior across payers/states/screens)
MURI — Overburden (too much load on Sowmya or the system at once)
```

Work through all three. A feature can pass one lens and fail another.

## Lens 1: Muda (Waste)

**Question: What does this feature do that adds no value?**

Check for:

- **Redundant steps:** Does Sowmya enter the same data twice? (e.g., NPI typed in one screen, re-typed in another)
- **Dead UI:** Buttons, fields, or screens nobody uses
- **Duplicate data:** Same fact stored in two places that can drift out of sync
- **Unnecessary waiting:** Spinners or confirmations for actions that don't need one
- **Over-processing:** Validation or confidence checks running more than once on the same data
- **Unused output:** Reports, exports, or logs nobody reads

**Diagnostic steps:**

1. Walk the feature start to finish as Sowmya would.
2. At each step, ask: "If this step disappeared, would anything break?"
3. If no — it's Muda. Flag it.

**Output: List of waste found, one line each, with the step/screen/field named.**

Example: "Facility name is typed manually on the case form even though it's already selectable from the NPPES lookup two steps earlier. Muda — redundant entry."

## Lens 2: Mura (Unevenness)

**Question: Does this feature behave consistently across payers, states, and users?**

Check for:

- **Inconsistent UI patterns:** Does the same action (e.g., "confirm case") look/work differently on different screens?
- **Payer-specific exceptions:** Does Cigna's flow work differently from Aetna's for no real reason?
- **Uneven pacing:** Does the workflow have a rushed step right after a slow one? (e.g., instant validation, then a 10-second save)
- **Data quality gaps:** Does confidence scoring behave differently depending on which state or payer the data came from?
- **Load spikes:** Does one screen do all the heavy lifting while others are idle? (e.g., all validation happens on submit, nothing checked earlier)

**Diagnostic steps:**

1. Compare the same feature across 2–3 payers or states.
2. Note every place behavior differs without a clear reason.
3. Ask: "Would Sowmya be surprised switching from one payer to another?"

**Output: List of inconsistencies, with the two things being compared.**

Example: "South Park cases skip facility match confidence; KFP cases require it. No documented reason. Mura — inconsistent validation."

## Lens 3: Muri (Overburden)

**Question: Is this feature asking too much of Sowmya or the system at once?**

Check for:

- **Cognitive overload:** Too many fields, decisions, or warnings on one screen
- **Manual work that should be automatic:** Anything Sowmya does by hand that a rule could handle
- **System strain:** Slow queries, large payloads, or anything that stresses the system under normal use
- **Error-prone steps:** Steps with a high chance of mistake because they demand too much attention at once
- **No recovery path:** If Sowmya makes a mistake here, is there an easy way to fix it, or does she have to start over?

**Diagnostic steps:**

1. Count the decisions/fields Sowmya must handle in this feature, per screen.
2. Ask: "Could a rule, default, or automation remove this decision?"
3. Check system load: does this feature run slow, time out, or need a page reload under normal use?

**Output: List of overburden points, ranked by how often Sowmya hits them.**

Example: "Case submission screen has 14 required fields with no defaults, no save-and-resume. Muri — high cognitive load, no recovery path if she has to step away."

## Workflow: Start to Done

1. **Name the feature to audit.** (e.g., "audit the touchlog review screen")
2. **I walk it through Muda first.** Findings listed.
3. **Then Mura.** Comparison across payers/states.
4. **Then Muri.** Load and recovery check.
5. **I rank all findings by impact** — what's costing Sowmya the most time or causing the most errors.
6. **You pick what to fix first.**

## Output Format

```
M3 Audit: [Feature Name]

Muda (Waste)
- [finding] — [step/screen]
- [finding] — [step/screen]

Mura (Unevenness)
- [finding] — [comparison]
- [finding] — [comparison]

Muri (Overburden)
- [finding] — [frequency/impact]
- [finding] — [frequency/impact]

Top 3 to Fix First
1. [highest impact]
2. [second]
3. [third]
```

## When to Call This

- Feature has been live a while and something feels clunky, but nothing's "broken"
- Sowmya reports a feature is slow, confusing, or repetitive
- Before adding new functionality to an existing screen — audit first, build on a clean base
- Quarterly health check on core workflows (case submission, touchlog review, confidence display)
- Onboarding a new payer/state and want to confirm the existing pattern is worth replicating
