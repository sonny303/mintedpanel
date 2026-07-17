# End-to-End Workflow Through R6

PM reference (2026-07-14). Not an epic — a map of how the shipped stages
(R0–R5) and the R6 epics compose into one operating workflow, plus the
step-by-step payer & SOP setup flow. Cited features link to their epics.

## The full workflow (R0 → R6)

```mermaid
flowchart TB
  subgraph S0["Stage 0 — Account & portfolio (R0/R1)"]
    A1["Create organization<br/>(owner + customer contact + sales rep)"]
    A2["Capture link / inbound leads<br/>(prospect intake)"]
    A3["Portfolio & Reporting Center<br/>(cross-org view)"]
    A2 --> A1 --> A3
  end

  subgraph S1["Scope (R2/R5)"]
    B1["Groups, locations, providers<br/>(manual forms)"]
    B2["CSV imports — org/location/provider<br/>(E3.0/E3.1/E3.3: front gate, preview,<br/>dedupe, staged commit)"]
    B2 --> B1
  end

  subgraph S2["Payer & SOP setup — upstream config (R3 + E4.2)"]
    C1["Attach payers per org/state<br/>(payer catalog + network targets)"]
    C2["Configure payer specifics:<br/>resolution-ID label (Provider PIN / ID),<br/>reason codes, contact info"]
    C3["Author/publish SOP templates<br/>(versioned, match keys,<br/>execution types, profile gates)"]
    C4["Readiness signal:<br/>Ready / Needs SOP per payer × state<br/>(links to payer scorecard)"]
    C1 --> C2 --> C3 --> C4
  end

  subgraph S3["Case generation (R4 + E4.2)"]
    D1["Generation preview<br/>(candidates, dedupe, exclusions,<br/>profile-gate blocks + outreach tasks)"]
    D2["Release configuration:<br/>all / none / filtered subset<br/>(staggered SLA-safe rollout)"]
    D3["Cases created with full SOP task<br/>checklists + stamped execution types<br/>(run traceability)"]
    D1 --> D2 --> D3
  end

  subgraph S4["Execution (R4/R6 core)"]
    E1["Next-best-action queue<br/>(derived; org-configured ranking —<br/>E4.2 F4.2.5, consumed by E4.1)"]
    E2["Structured touches (E4.1):<br/>7 types, outcome, recipient,<br/>follow-up carry-forward, bulk log"]
    E3["Payer pipeline (E4.0):<br/>Not Started → … → In Review ↔ RFI →<br/>Closed (Approved/Denied), tracking ID"]
    E4["Action Bridge (E4.1 F4.1.8):<br/>pipeline transition optionally<br/>logs a touch in one confirm"]
    E5["RFI → internal task bridge (E4.0):<br/>Action Required prompts a task"]
    E1 --> E2
    E2 --> E3
    E3 --> E4
    E3 --> E5
    E5 --> E1
  end

  subgraph S5["Supporting surfaces (R6)"]
    F1["Extension workbench handoff (E4.3):<br/>read-only fill payloads,<br/>extension-logged touches"]
    F2["Sensitive Identifiers Vault (E4.4):<br/>full SSN, audited reveal"]
    F3["Document storage (E4.5):<br/>provider/group docs, versions,<br/>expiration tracking, touch artifacts"]
  end

  subgraph S6["Resolution & outcomes"]
    G1["Approved: effective date +<br/>individual & group provider IDs<br/>(payer-specific labels)"]
    G2["Denied: structured reason code /<br/>OON terminal outcome"]
    G3["Audit trail: append-only pipeline<br/>history, touches, audit log<br/>(≥7y retention, CSV export)"]
    G1 --> G3
    G2 --> G3
  end

  S0 --> S1 --> S2 --> S3 --> S4 --> S6
  F1 -.-> E2
  F2 -.-> S3
  F3 -.-> E2
  F3 -.-> S3
```

Key structural rules the diagram encodes:

- **Upstream determinism (A0):** payer & SOP setup happens BEFORE cases
  exist; generated cases arrive fully specified — specialists execute, never
  investigate.
- **Two parallel state tracks:** internal credentialing status (existing,
  untouched) and the payer-facing pipeline (E4.0). Touches (effort) and
  pipeline history (status) are decoupled events, joined at the UI by the
  Action Bridge.
- **Everything downstream is derived:** readiness, queue ranking, overdue
  follow-ups, document status — no stored flags; append-only history is the
  source of truth.

## Payer & SOP setup — workflow steps (E4.2 module)

1. **Open the admin module** (P4 Ops Lead / P1 admin; role-gated route
   subtree, machine-enforced isolation from specialist code).
2. **Attach the payer** to the org for each operating state (payer catalog →
   attachment / network targets). Template tier is visible: global/shared
   payer templates apply unless an org-specific override exists.
3. **Configure payer specifics:**
   - resolution-identifier label + expectedness (e.g. Aetna "Provider PIN",
     BCBS "Provider ID"; generic "Payer-issued ID" fallback);
   - denial/return reason codes (seeded defaults + org codes; deactivate,
     never delete).
4. **Author the SOP** for payer × state × specialty (or adopt/override the
   global template): ordered task checklist with per-task **execution type**
   (`manual` default / `extension_fill` / `auto_verify` / `document_attach`)
   and **required provider-profile attributes** (the F4.2.6 generation gate),
   then publish — an immutable version (E1.7b); edits produce new versions;
   in-flight cases stay on their version.
5. **Drive readiness to 100%:** the Ready / Needs-SOP list per attached
   payer × state links straight into SOP creation with the match key
   prefilled; the payer scorecard shows the same readiness beside
   performance indicators.
6. **Set queue behavior** (org-level NBA settings, F4.2.5): ranking-input
   order/enablement with shipped default and reset; stale-case nudge
   threshold (default 14 days).
7. **Generate cases** from the payer/contract context: preview (profile-gated
   providers surface with missing attributes → spawn outreach tasks) →
   choose release scope (all / none / filtered) → confirm; the run is
   recorded with its scope.
8. **Maintain:** new contract or state → step 2; payer changes its process →
   new SOP version; new reason codes as encountered; readiness and scorecard
   watch for drift.

## SOP buildout — what a template actually contains, and where each task executes

An SOP template is not just a checklist; it is the configuration that makes a
generated case fully specified. Each published version carries:

- **Match key** — payer × state × specialty (resolver precedence: exact →
  payer+state → global fallback; global rows shared across orgs unless an
  org-specific override exists).
- **Ordered task list**, each task carrying:
  - **execution type** — the entry point where the task is performed
    (`manual` / `extension_fill` / `auto_verify` / `document_attach`);
  - due-date offsets / assignment defaults (existing E1.7b behavior).
- **Required provider-profile attributes** (F4.2.6 gate) — checked at
  generation, before a case ever exists.
- **Version lineage** — published versions are immutable; in-flight cases
  keep theirs.

The same task list therefore fans out to four different entry points at
execution time — and the `extension_fill` path is the secret-sauce loop:
the form's fields are collected, mapped to provider-profile tokens, filled
by the Chrome extension, and every field that CANNOT be resolved comes back
to the user through the **Fix-It queue** (shipped feature: `/fix-it`,
`fixitQueue.ts`) instead of silently failing.

```mermaid
flowchart TB
  SOP["Published SOP version<br/>(match key + ordered tasks<br/>+ execution types + profile gates)"]
  GEN["Case generated<br/>(tasks stamped with execution types)"]
  SOP --> GEN

  GEN --> M["manual<br/>Specialist works the task<br/>(NBA queue → touch logged)"]
  GEN --> AV["auto_verify<br/>System checks internal data<br/>(active dates, license status)<br/>— engine R7"]
  GEN --> DA["document_attach<br/>System pulls the named doc<br/>from storage (E4.5)"]
  GEN --> EF["extension_fill<br/>Form-fill handoff (E4.3)"]

  subgraph LOOP["The form-data loop (extension_fill + Fix-It)"]
    direction TB
    FM["Portal field maps + field dictionary<br/>(portal form fields ⇄ provider tokens;<br/>learned via form training)"]
    FILL["Chrome extension fill session<br/>(read-only payload; fills the payer<br/>portal form from mapped tokens)"]
    GAP{"Every field<br/>resolved?"}
    DONE["Task complete —<br/>extension-logged touch,<br/>fill session recorded"]
    FIX["Fix-It queue (/fix-it)<br/>impact-ordered cards:<br/>• provider data gap → inline fix or task<br/>• unconfirmed dictionary mapping → confirm<br/>• untrained/broken form → train"]
    UPD["Provider profile / dictionary /<br/>field maps updated"]
    EF2["Refill: coverage now higher"]

    FM --> FILL --> GAP
    GAP -- yes --> DONE
    GAP -- "no (unmapped or empty fields)" --> FIX --> UPD --> EF2 --> FILL
  end

  EF --> FM
  PG["F4.2.6 profile gate at generation:<br/>required attributes missing →<br/>no case; outreach task instead"] -.->|"prevents most gaps upstream"| GAP
```

How the pieces relate across releases:

| Piece                                               | Where it lives                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Portal field maps, field dictionary, form training  | Shipped (main + redesign): `portalFieldMaps`, `fieldDictionary`, portal training route                        |
| Fill sessions + extension read-only API             | Shipped; E4.3 formalizes the workbench handoff surface                                                        |
| Fix-It queue (gap cards, dictionary confirm, train) | Shipped: `/fix-it`, `src/lib/fixitQueue.ts` — the feedback path for unresolved fields                         |
| Execution type on SOP tasks                         | E4.2 (captured + stamped); engines ride E4.3 (`extension_fill`), E4.5 (`document_attach`), R7 (`auto_verify`) |
| Profile gate at generation                          | E4.2 F4.2.6 — moves the Fix-It class of gaps upstream, before a case exists                                   |

The two gap mechanisms are deliberately complementary: the **F4.2.6 gate**
catches attributes an SOP _declares_ required before generation; the
**Fix-It queue** catches everything discovered _at fill time_ (unmapped
portal fields, empty tokens, untrained forms) and routes each back to the
user as a 30-second decision.

## Measurement: how the workflow feeds the payer scorecard

Yes — the connection is tracked, and it is tighter than a link: the shipped
scorecard's indicators are direct read-outs of the loops above. Every
indicator is a pure derivation over rows the workflow already writes, so the
scorecard is the per-payer measurement dashboard for the whole R6 flow with
no extra instrumentation:

| Workflow loop                                     | Scorecard indicator                   | What it reads                                                                                                  |
| ------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Payer/SOP setup completeness                      | **SOP readiness** (added E4.2 F4.2.2) | Does a payer-specific SOP resolve per attached state, or only the fallback                                     |
| Setup-time form onboarding (training)             | **Mapping coverage**                  | approved ÷ (approved + proposed) field maps on the payer's portals — rises as forms are trained                |
| Fill-time correction burden (Fix-It loop)         | **First-pass rate**                   | Fraction of the payer's cases filled exactly once — every Fix-It bounce forces a re-fill and drops this number |
| Execution throughput (queue → touches → pipeline) | **Avg time-in-bucket**                | Ours / waiting-payer / waiting-provider durations from status history                                          |

## Setup-time form onboarding vs fill-time correction — the alignment

Both paths maintain the **same two artifacts** — portal field maps and the
field dictionary — from opposite ends:

- **Proactive (setup time):** form training on the payer's portal proposes
  field maps; approving them raises mapping coverage BEFORE any case is
  filled. This is part of payer onboarding, alongside SOP authoring.
- **Reactive (fill time):** the Fix-It queue catches what training missed —
  unmapped fields, empty tokens, broken maps — and routes each back as a
  30-second card whose action updates the very same maps/dictionary/profile.

Every card resolved reactively makes the next payer's setup more proactive
(the dictionary is org-learned). The current gap in alignment: the E4.2
setup workflow surfaces SOP readiness but not **form readiness** — an SOP
with `extension_fill` tasks can be "Ready" while its portal's mapping
coverage is 0%. Recommended tightening (PM decision): the readiness signal
for a payer whose SOP contains `extension_fill` tasks should carry the
portal's mapping-coverage ratio beside Ready/Needs-SOP, so form training
becomes a visible setup step, not a fill-time surprise.

## Testing early for throughput

The design makes this measurable BEFORE scale, because every metric is
derived and the release is staggered:

1. **Train first, measure coverage:** after SOP setup, mapping coverage on
   the scorecard shows form-fill readiness with zero cases generated.
2. **Release a probe subset (F4.2.4):** generate a small filtered batch
   (e.g. one location) instead of all eligible providers.
3. **Watch two numbers on the probe:** first-pass rate (scorecard) and
   Fix-It card volume — together they say exactly whether gaps are
   provider-data (fix profiles / tighten F4.2.6 gates), mapping (train
   more), or process (SOP task order).
4. **Fix upstream, then release the remainder:** profile fixes + confirmed
   dictionary rows + trained forms apply to every subsequent fill, so the
   bulk release lands at a measured, higher first-pass rate instead of
   discovering the same gap 1,000 times.

## Form onboarding inside SOP setup — the detailed workflow (F4.2.7)

PM round-3: "map fields whenever the extension happens to see the form" is
not a workflow. Form onboarding is now an explicit, testable step of payer
setup for any SOP containing `extension_fill` tasks:

1. **Intake/scrape:** open the payer's live form (portal registry row) with
   the extension in capture mode; every observed field lands as an
   org-scoped `proposed` field-map row (selector + label + page step —
   existing contract, no new write path).
2. **Train:** the shipped training deck (`/portals/$key/train`) resolves
   the proposals — high-confidence dictionary suggestions batch into one
   confirm; the rest go card-by-card with Approve / Edit / Manual and undo.
   Coverage rises on the F4.2.2 readiness signal in real time.
3. **Test run (the "dummy provider" pattern, made first-class):** dry-run
   fill against a designated org test provider — the extension fills the
   live form from the test profile while the operator watches; the run
   reports **filled / skipped-unmapped / empty-token per field**. Nothing
   submits; no case is required; the session is marked test and excluded
   from every metric.
4. **Fix and re-run:** unmapped → one click back into training; empty
   token → one click into the test provider's profile; repeat until the
   coverage is acceptable. Bulk release then starts at a measured
   first-pass rate.

### How "not mapped" is indicated — both flows, one vocabulary

| Flow                        | Where an unresolved field shows up                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Setup (training + test run) | `proposed` rows in the deck; test-run per-field results (`skipped-unmapped` / `empty-token`) with one-click fix paths    |
| Real fill (specialist)      | Fill session records skipped fields; Fix-It queue derives the cards (provider gap / dictionary confirm / train / broken) |

Both read the same rows, so a field fixed in either flow disappears from
both. The support ladder for the user, cheapest first: dictionary
auto-suggestion (org-learned) → confidence-batched confirm → per-card
Approve/Edit/Manual with keyboard keys → manual (extension skips it,
counted as intentionally unmapped) → Fix-It card if it still bites at fill
time.

### Schema impact (all additive)

| Change                                                                          | Why                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `fill_sessions` test marker (`is_test` boolean or additive mode value)          | Distinguish dry runs; excluded from first-pass rate/metrics                                       |
| `providers` exclusion flag for the designated test provider                     | Keep it out of queues, generation, scorecards (one predicate)                                     |
| Tighten `fill_sessions.fieldsSkipped` from `unknown` to structured rows         | `{selector, label, reason: "unmapped" \| "empty_token"}[]` — the per-field report both flows read |
| No changes to `portal_field_maps`, `field_dictionary`, or extension write scope | Capture → proposed-row contract and read-only payload unchanged                                   |
