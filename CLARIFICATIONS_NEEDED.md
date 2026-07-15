# Clarifications Needed

Open roadblocks found during epic review that require a PM decision. The
reviewing agent adds entries here instead of guessing; resolved entries move to
the Resolved section with the decision recorded.

Format per entry:

```
## [eX.X] <short title> — OPEN | RESOLVED (YYYY-MM-DD)
- **Issue:** what is contradictory or missing
- **Impact:** what is blocked
- **Options:** (optional) proposed resolutions
- **Decision:** (when resolved)
```

## Open

## Resolved

## [e4.4] Full-SSN vault conflicts with the binding data/security rule — RESOLVED (2026-07-14)

- **Issue:** E4.4 requires Minted Panel to accept, encrypt, store, reveal, and
  release a full SSN to the extension. The binding repository rule in
  `AGENTS.md` says providers store `ssn_last4` only and the system must never
  store or accept a full SSN. The existing extension build specification also
  marks the full SSN as manual-only and recommends it stay manual forever.
  A later PM discovery decision intends to supersede that behavior, but the
  binding rule and approved trust boundary/key-custody design have not been
  updated. “Encrypted at rest” alone does not decide who holds decrypt
  authority, whether the vault is reachable through PostgREST, how a
  one-time fill release reaches the portal without exposing the value to
  ordinary extension/UI code, or how retention/deletion is governed.
- **Impact:** Reviewing E4.4 would authorize implementation directly contrary
  to `AGENTS.md` and could place a full SSN in an unapproved browser,
  extension, logging, backup, or database access path. The vault schema,
  ingress endpoint, admin reveal, extension release, RLS/grants, audit
  contract, and security tests are all blocked pending an explicit security
  architecture and rule change.
- **Options:**
  1. Explicitly supersede the no-full-SSN rule and approve a **server-only
     vault** not exposed to PostgREST, with managed key custody/rotation,
     narrowly scoped decrypt functions, one-time no-store fill release,
     extension/content-script threat controls, immutable audit, and defined
     retention/deletion. Update `AGENTS.md` and the extension specification
     before build.
  2. Keep the current rule: store only last four, remove vault/reveal/release
     from R6, and require the specialist to enter the full SSN manually from an
     approved external source.
  3. Use an approved external tokenization/vault provider: Minted Panel stores
     only a token + last four, while a narrowly authorized one-time fill
     exchange supplies the portal field. Security must still approve the
     extension/browser release boundary.
- **Decision:** PM selected **option 1** (2026-07-14): explicitly supersede the
  no-full-SSN rule and approve a **server-only vault** — full security design
  first. Applied: `AGENTS.md` and `SCHEMA.md` now carry the controlled
  supersession (full SSN exists ONLY in the separated vault table with no
  client SELECT grant, encrypted at rest, audited SECURITY DEFINER RPC access
  only — fill-only `no-store` release, admin reveal with justification,
  audited ingress; last-4-only still binds everywhere else). Two build-gating
  sub-decisions remain with the PM before `reviewed: true`/handoff: (a)
  key management — TE-2 Option A (in-DB pgcrypto symmetric, key from server
  secret; reviewer-recommended, Option-B-ready schema) vs Option B (app-layer
  envelope + external KMS); (b) internal `store_ssn` modal ingress role —
  writer roles (`specialist|admin`, reviewer default) vs admin-only. The
  extension specification update (fill-only token category, masked UI) ships
  with the E4.3/E4.4 build per TE-5.
- **2026-07-14 (re-review):** the current `redesign` branch still binds both
  `AGENTS.md` and `SCHEMA.md` to `ssn_last4` only and explicitly prohibits
  accepting or storing a full SSN. No approved key-custody/rotation,
  retention/deletion, or extension release-boundary decision has landed, and
  E4.4 §5 still identifies encryption key management as required before build.
  This remains a major security contradiction, so E4.4 stays
  `reviewed: false` and was not edited.
- **2026-07-14 (re-review, `ca47da6` cycle):** E4.4 was not part of this push
  (the commit touched E4.0, `ROADMAP-STATUS.md`, and `seed-universe.md` only),
  but it was re-assessed because its frontmatter is still `reviewed: false`.
  `AGENTS.md` and `SCHEMA.md` on the current `redesign` HEAD still bind
  providers to `ssn_last4` only and prohibit accepting or storing a full SSN;
  no key-custody/rotation, retention/deletion, or extension release-boundary
  decision (options 1–3 above) has landed. The security contradiction is
  unchanged, so E4.4 stays `reviewed: false` and was not edited.
- **2026-07-14 (re-review, `84a55b8` e4.0 cycle):** the [e4.0] push
  (`84a55b8`, resolving the OON/reapply blocker) re-triggered review; E4.4 was
  not in that push but was re-assessed as the only remaining `reviewed: false`
  epic. `AGENTS.md` (line 55: "Providers store `ssn_last4` only. Never store
  or accept a full SSN.") and `SCHEMA.md` (line 10 PHI-minimization + the
  `providers` column list, which carries `ssn_last4` and no full-SSN field)
  on the current `redesign` HEAD still bind to last-4-only. None of options
  1–3 has been chosen, and no key-custody/rotation, retention/deletion, or
  approved extension release-boundary design has landed. E4.4 §5 itself still
  names encryption key management as a REQUIRED-before-build PM decision. The
  major security contradiction is unchanged, so E4.4 stays `reviewed: false`
  and was not edited this cycle.
- **2026-07-15 (re-review, `43e7637` E4.1 cycle):** the latest push changed
  E4.1 and `seed-universe.md`; E4.1 remains `reviewed: true` and was skipped
  per the review-loop guard. E4.4 remains the only unreviewed epic. The
  roadblock is unchanged: its full-SSN storage, reveal, and extension-release
  requirements still contradict the binding `AGENTS.md` and `SCHEMA.md`
  last-four-only rule. The impact remains a blocked vault schema, key custody
  and rotation design, retention/deletion policy, ingress path, and approved
  browser/extension release boundary. No option above has been selected by the
  PM/security owner, so E4.4 stays `reviewed: false` and was not edited.
- **2026-07-15 (re-review, `e04d3b2` E4.1 roadmap cycle):** the latest push
  changed only the already-reviewed E4.1 epic and `ROADMAP-STATUS.md`, so E4.1
  was skipped per the review-loop guard. E4.4 remains the only unreviewed epic,
  and its storage, reveal, and extension release of a full SSN still conflict
  with the binding `AGENTS.md` and `SCHEMA.md` last-four-only rule. No approved
  key-custody/rotation, retention/deletion, or browser/extension release-boundary
  decision has landed, and no option above has been selected. E4.4 therefore
  remains `reviewed: false` and was not edited.
- **2026-07-15 (re-review, `13bbc0d` E4.1 round-3 cycle):** the triggering push
  changed the already-reviewed E4.1 epic and `seed-universe.md`, so E4.1 was
  skipped per the review-loop guard. E4.4 remains the only unreviewed epic.
  Its requirements to accept, store, reveal, and release a full SSN still
  directly contradict the binding `AGENTS.md` and `SCHEMA.md` last-four-only
  rule. No PM/security decision has selected a vault option or approved key
  custody and rotation, retention and deletion, or the browser/extension
  release boundary. E4.4 therefore remains `reviewed: false` and was not
  edited.
- **2026-07-15 (re-review, `c87de2e` E4.0 round-3 cycle):** the triggering push
  changed the already-reviewed E4.0 epic, its Claude handoff, and
  `seed-universe.md`, so E4.0 was skipped per the review-loop guard. E4.4
  remains the only unreviewed epic. Its requirements to accept, store, reveal,
  and release a full SSN still directly contradict the binding `AGENTS.md` and
  `SCHEMA.md` last-four-only rule. No PM/security decision has selected a vault
  option or approved key custody and rotation, retention and deletion, or the
  browser/extension release boundary. E4.4 therefore remains `reviewed: false`
  and was not edited.
- **2026-07-15 (re-review, `1681568` prettier-format cycle):** the triggering
  push only prettier-formatted the already-reviewed E4.0, E4.1, and E4.2 epics
  (plus `ROADMAP-STATUS.md`, `handoffs/E4.0-claude-handoff.md`, and
  `seed-universe.md`), so all three epics were skipped per the review-loop
  guard. E4.4 remains the only unreviewed epic. Its requirements to accept,
  store, reveal, and release a full SSN still directly contradict the binding
  `AGENTS.md` and `SCHEMA.md` last-four-only rule, and E4.4 §5 still names
  encryption key management as a REQUIRED-before-build PM/security decision.
  No PM/security decision has selected a vault option or approved key custody
  and rotation, retention and deletion, or the browser/extension release
  boundary. E4.4 therefore remains `reviewed: false` and was not edited.
- **2026-07-15 (re-review, `36d281c` E4.0 pipeline merge cycle):** the
  triggering push merged PR #155 (E4.0 Payer Pipeline) and touched the
  already-reviewed E4.0, E4.1, and E4.2 epics (plus `ROADMAP-STATUS.md`,
  `handoffs/E4.0-claude-handoff.md`, `seed-universe.md`, and the E4.0
  implementation), so all three epics were skipped per the review-loop guard.
  E4.4 remains the only `reviewed: false` epic. `AGENTS.md` (line 55:
  "Providers store `ssn_last4` only. Never store or accept a full SSN.") and
  `SCHEMA.md` (line 10 PHI-minimization + the `providers` column list carrying
  `ssn_last4` and no full-SSN field) on the current `redesign` HEAD still bind
  to last-four-only. E4.4's requirements to accept, store, reveal, and release
  a full SSN still directly contradict that binding rule, and E4.4 §5 still
  names encryption key management as a REQUIRED-before-build PM/security
  decision. No PM/security decision has selected a vault option or approved key
  custody and rotation, retention and deletion, or the browser/extension
  release boundary. E4.4 therefore remains `reviewed: false` and was not edited.
- **2026-07-15 (re-review, `6dc7035` E4.1 Action Bridge cycle):** the
  triggering push changed the already-reviewed E4.1 epic, its Claude handoff,
  and `seed-universe.md`, so E4.1 was skipped per the review-loop guard. E4.4
  remains the only `reviewed: false` epic. Its requirements to accept, store,
  reveal, and release a full SSN still directly contradict the binding
  `AGENTS.md` and `SCHEMA.md` last-four-only rule, while E4.4 §5 still requires
  a PM/security decision on key custody before build. No approved decision has
  selected a vault option or defined key rotation, retention/deletion, or the
  browser/extension release boundary. E4.4 therefore remains
  `reviewed: false` and was not edited.
- **2026-07-15 (re-review, `3a0d417` E4.2 round-2 cycle):** the triggering push
  changed the already-reviewed E4.2 epic (PM/Gemini round-2: enforced module
  boundary, phased SOP task-execution types, F4.2.6 upstream profile gating,
  staggered bulk release, template tier visibility) and `seed-universe.md`, so
  E4.2 was skipped per the review-loop guard. E4.4 remains the only
  `reviewed: false` epic. Its requirements to accept, store, reveal, and release
  a full SSN still directly contradict the binding `AGENTS.md` (line 55) and
  `SCHEMA.md` (line 10) last-four-only rule, and E4.4 §5 still names encryption
  key management as a REQUIRED-before-build PM/security decision. No PM/security
  decision has selected a vault option or approved key custody and rotation,
  retention and deletion, or the browser/extension release boundary. E4.4
  therefore remains `reviewed: false` and was not edited.
- **2026-07-15 (re-review, `b3f240c` R6/E4.2 roadmap cycle):** the triggering
  push changed the already-reviewed E4.2 epic (scorecard↔readiness link),
  `R6-workflow.md`, and `ROADMAP-STATUS.md`, so E4.2 was skipped per the
  review-loop guard and the two non-epic docs are out of the reviewer's epic
  gate. E4.4 remains the only `reviewed: false` epic. Its requirements to
  accept, store, reveal, and release a full SSN still directly contradict the
  binding `AGENTS.md` (line 55: "Providers store `ssn_last4` only. Never store
  or accept a full SSN.") and `SCHEMA.md` (line 10) last-four-only rule, and
  E4.4 §5 still names encryption key management as a REQUIRED-before-build
  PM/security decision. No PM/security decision has selected a vault option or
  approved key custody and rotation, retention and deletion, or the
  browser/extension release boundary. E4.4 therefore remains `reviewed: false`
  and was not edited.
- **2026-07-15 (re-review, `37ef0a5` E4.2 round-3 form-onboarding cycle):** the
  triggering push changed the already-reviewed E4.2 epic (PM round-3 form
  onboarding — F4.2.2 form readiness TE-16, F4.2.7 form intake + dummy-provider
  test runner TE-17, TS-98/99), `R6-workflow.md`, and `seed-universe.md`, so
  E4.2 was skipped per the review-loop guard and the two non-epic docs are out
  of the reviewer's epic gate. E4.4 remains the only `reviewed: false` epic. Its
  requirements to accept, store, reveal, and release a full SSN still directly
  contradict the binding `AGENTS.md` (line 55: "Providers store `ssn_last4`
  only. Never store or accept a full SSN.") and `SCHEMA.md` (line 10)
  last-four-only rule, and E4.4 §5 still names encryption key management as a
  REQUIRED-before-build PM/security decision. No PM/security decision has
  selected a vault option or approved key custody and rotation, retention and
  deletion, or the browser/extension release boundary. E4.4 therefore remains
  `reviewed: false` and was not edited.

## [e4.0] OON terminal state and reapplication-cycle semantics conflict — RESOLVED (2026-07-14)

- **Issue:** The payer pipeline's PM-locked A3 terminal phase named only
  Approved and Denied, while E4.0 F4.0.3 (and the enum) also required a case to
  close **Out-of-Network (OON)** — a third terminal close with no defined normal
  inbound edge. Separately, Denied **reapplication** cited only the internal
  E2.1 rule (`Denied → In Progress` in `status_history`, `[r4-review]` Q6) and
  did not state whether the **payer-pipeline** state resets or begins a new
  cycle. Across several re-reviews the reviewer declined to guess (adding OON to
  the PM-locked vocabulary is a locked-decision override), so E4.0 stayed
  `reviewed: false` pending the PM's choice of option 1/2/3.
- **Options:** (as recorded) 1 — OON as a third terminal payer-pipeline state,
  reapplication a new cycle on the existing case; 2 — neutral `Resolved` state +
  structured outcome; 3 — OON outside the pipeline as an internal close status.
- **Decision (PM Sowmya, 2026-07-14, commit `d3f6f82` "PM review passed — E4.0
  approved for build"):** **Option 1.** The PM reviewed the full epic — which
  already models OON as a third terminal close alongside Approved/Denied and
  keeps reapply on the existing case — and approved it for build. Email-RFI
  automation was explicitly deferred to R7. This resolves the business-scope
  blocker; the remaining edge mechanics are reviewer-owned §5 enablement.
- **Applied (reviewer, 2026-07-14):** E4.0 §5 TE-1 now defines the edge map
  explicitly — Approved reachable from In Review / Action Required; **Denied and
  OON reachable as non-Approved closes from any open pre-terminal state**
  (Drafting, Submitted, In Review, Action Required), edge-symmetric; **reapply
  after Denied is a normal forward transition Denied → Drafting on the same
  case** (new attributed `payer_pipeline_history` row, prior Denied row
  preserved append-only, not a correction), reconciled with TE-6. Frontmatter
  set `reviewed: true`; no business-scope change.

## [r6] Next-best-action queue configurability — RESOLVED (2026-07-14)

- **Issue:** The PM asked whether next-best-action workqueue settings are
  configurable and whether specific criteria need to be provided ("let me
  know if we need to provide specific criteria for next best action
  workqueue settings - are the settings configurable, etc?").
- **Current state:** The E2.3 queue ranking is fully derived and FIXED
  (deadline-ordered: provider start dates, location launch dates, task due
  dates) — nothing is configurable today. R6 adds overdue follow-ups as a
  ranking input ([r6] decision A2).
- **Decision (PM Sowmya, 2026-07-14):** **admin-configurable with a default
  option, configurable at the organization level.** The system ships a
  default ranking (overdue follow-ups above deadline-only rows; ties by
  earliest deadline); an org admin can adjust the ordering/enabling of the
  ranking inputs for their org in the E4.2 Payer & SOP admin module
  (F4.2.5). Ranking stays deterministic and fully derived — the org config
  is an input to the derivation, not stored per-case priority.

## [r6] R6 Execution-pack discovery decisions — RESOLVED (2026-07-14)

- **Issue:** R6/R7 (payer workflows + touches, extension fill, Sensitive
  Identifiers Vault, Document Storage) needed PM direction before epic
  drafting. Discovery questions A1–A4, B5–B6, C7–C8, D were put to the PM;
  all are answered, plus an unprompted baseline clarification (A0).
- **Decisions (PM Sowmya, 2026-07-14):**
  - **A0. Payer SOPs are a mandatory prerequisite for system readiness.**
    Case generation must be entirely deterministic — driven by upstream
    configuration, never downstream guesswork. Build a dedicated
    administrative module (architected as a micro-frontend — PM confirmed
    2026-07-14 this means a user-role-controlled admin module inside the
    existing app, NOT a separately deployed application) exclusively
    for Payer and SOP management, owned by a designated configuration user
    (Ops Lead or Admin) who defines payer-specific requirements, logic,
    and task sequences. Centralizing SOP setup upstream means generated
    cases arrive with complete, accurate task checklists; specialists log
    in to a clean, high-density queue and execute immediately — no
    investigating missing case details.
  - **A1. Case anatomy (real-world lifecycle):** Generated (system detects
    a missing payer enrollment and drafts a case; ALSO need **bulk case
    generation** — e.g. a group signs a new contract and every provider
    needs enrolling — in addition to ad hoc one-off creation for misses
    found during onboarding) → Assigned (specialist verifies required
    documents are active: license, CAQH, COI, etc.) → Submitted
    (specialist uses the extension to auto-fill the payer portal, or
    generates a CAQH export, or sends an email — the payer-specific steps
    captured in Tasks; attaches documents; submits; **capture the payer's
    Reference/Tracking ID** for future follow-up on delays) → In
    Review/Touches (periodic check-ins; payer portals are black boxes —
    responses land via shared-inbox email, fax, or manual portal scraping;
    lots of back-and-forth/RFIs; need a way to track email ↔ case
    touches) → Resolution (payer approves; specialist records effective
    dates + provider IDs; provider is In-Network/Credentialed with
    effective date, or the case closes OON or Denied).
  - **A2. Touches:** structured touch types are required — **Call, Portal
    Check, Email, Fax, CAQH Update** — free-text-only notes are a dead end
    for SaaS analytics (no operational-efficiency reports, no automations
    off paragraphs). UI stays high-density: a dropdown for touch type + a
    single-line text input for context. **Overdue follow-ups must
    explicitly surface in the next-best-action queue** so applications
    don't rot in payer purgatory.
  - **A3. Case status vocabulary:** decouple internal operations from the
    payer's pipeline. Internal task states ("Missing DEA", "Ready for QA")
    belong to the task tracker. The **Payer Pipeline is a distinct,
    immutable state machine: Drafting → Submitted → In Review → Action
    Required (RFI) → Approved / Denied.** Mixing internal gathering tasks
    with external payer statuses breaks reporting.
  - **A4. Denials/returns:** require a **structured reason code** (e.g.
    Missing Documentation, Network Closed, Demographic Mismatch). Status +
    note only would forfeit predictive analytics (R8) — structured denial
    reasons surface systemic issues like a payer consistently rejecting a
    specific facility's tax ID.
  - **B. Extension fill:** the workbench extension and the webapp must be
    a **cohesive duo with seamless handoff** — working a case from the
    platform vs. moving to a payer portal with the extension guiding case
    completion, logging it, and bringing the next best action, all from
    the same view; when SOP/fill data is missing it ties into the fix-it
    game to grow extension data value. The platform tells you what to do;
    the extension is what you complete it with. The extension eventually
    must be more than a form filler (some tasks are emails, etc.). **For
    this release, tightly scope the extension to read-only token
    resolution** (reading case/provider data to fill portal forms) —
    establish a reliable, low-latency form-fill experience first.
    Logging/submission stays manual from the extension into the Touch log
    (existing workflow remains).
  - **C1. SSN vault — zero-trust:** full SSN is **fill-only** for the
    extension and virtually never displayed in the application UI. Default
    UI uses tight minimalist masking (`***--1234`).
  - **C2. Admin reveal:** edge-case viewing goes behind a highly
    deliberate **"Click to Reveal"** restricted to Admin roles, which
    immediately logs an immutable audit event (Who, When, Which Provider,
    Justification).
  - **C3. Data ingress:** ideally the provider or an authorized org rep
    enters the full SSN via a **secure, time-expiring intake link**
    (modern identity-verification flow). If internal staff must enter it
    from a legacy intake form, provide a **secure input modal** that
    encrypts immediately on save.
  - **D1. Document storage grain:** per-provider (state license, …) AND
    per-group (W-9, COI, CMS-460, voided check, …).
  - **D2. Expiration tracking is mandatory this release.** Upload-only is
    just a file system; active credentialing software tracks expiration
    dates of the State License, DEA, and COI to feed the readiness radar
    (R9). Display in a clean, tight data table so specialists instantly
    spot expiring credentials before they block a submission.
  - **D3. Auto-attach via extension is deferred but NOT dropped:** legacy
    portal file inputs have variable security constraints; cross-origin
    file injection triggers portal security blocks. For now the extension
    handles text entry and the specialist manually downloads /
    drags-and-drops the PDF from secure storage. It is NOT a fast follow —
    it goes on the roadmap prioritized **after the redesign**, and the
    document-store architecture chosen today MUST support that future
    auto-attach feature.

## [r5-debt] Intake-flow uniformity gap (E3.0 retro) — RESOLVED (2026-07-13)

- **Issue:** the three intake experiences diverge. The foundational ladder is
  **org → group → facilities → providers**, and all three entry experiences —
  (1) credential manager filling out the webapp forms, (2) the sharable
  onboarding link, (3) CSV upload — must walk the same steps. E3.0 instead
  shipped one monolithic 20-column combined roster CSV attached to a single
  wizard section, rather than an upload option beside the manual form in
  **each** section after initial org setup.
- **Impact:** CSV users get a different mental model and data flow than
  form/link users; the combined template couples group/facility/provider
  creation into one file.
- **Decisions (PM Sowmya, 2026-07-13):**
  1. **Per-section uploads:** after initial org setup, the wizard's Group,
     Facilities, and Providers sections each offer BOTH a manual entry form
     and a CSV upload; each section's template mirrors exactly the fields its
     manual form captures (plus all prior [r5]/[r5-review] decisions — header
     gate, SSN safety, 10 MB ceiling, staging, async scan).
  2. **Combined roster retired:** both surfaces (internal power tool AND
     wizard) move to per-section uploads — one uniform, scalable model; the
     20-column combined template is superseded.
  3. **Sharable link:** stays org-intake-only for now, but on
     convert-to-customer the recipient flows into the SAME onboarding
     experience (group → facilities → providers with the same per-section
     upload options) — seamless continuation, no parallel flow.
  4. **Ladder enforcement:** the org → group → facilities → providers order
     holds uniformly across all three experiences.
- **Applied:** recorded as tech debt; fix ships as a dedicated epic
  **E3.3 — Sectioned Intake Uniformity** (to be drafted, PM-reviewed, and
  built after E3.1 — E3.1's preview/dedupe/staged-commit engine is the
  reusable core the per-section uploads feed, so it builds first against the
  current staged grain; E3.3 then splits the templates/surfaces and retires
  the combined file). Roadmap updated.

## [r5-review] E3.0 independent-review PM questions — RESOLVED (2026-07-13)

- **Issue:** the independent E3.0 review (PR #150) raised three PM questions:
  (1) how to express the "internal staff only" gate when roles are per-org
  `admin|specialist|billing` with no platform-staff concept; (2) how an org
  rep gets a login for the wizard uploader (TS-59); (3) whether the CSV
  template includes `ssn_last4` / `date_of_birth`.
- **Decisions (PM Sowmya, 2026-07-13):**
  1. **Internal-staff gate:** role-gated v1 now — the power tool is
     admin-gated (`useIsAdmin`); a dedicated platform-staff flag (e.g.
     additive `profiles.is_platform_staff`) is the durable follow-up, out of
     R5.
  2. **Org-rep provisioning:** the org rep is provisioned as an **admin of
     their own org** (fits the admin-only staging RLS with no policy change).
     E3.0 does not build the invite flow.
  3. **Template PII columns:** **include both `ssn_last4` and
     `date_of_birth`** in the template spec. `ssn_last4` is 4-digit-validated
     with a non-echoing error; a full-SSN value guard runs on every column
     (reject, never truncate/derive a last-4). Both fields are PHI in
     staging, covered by the RLS + purge controls.
- **Applied:** reviewer folded the decisions into E3.0 §5 (review branch,
  PR #150 — closed as superseded after #149 merged the reviewed epic);
  author (Devin) applied the five mechanical AC edits directly to the merged
  epic (F3.0.1 gating wording, wizard Provider Roster re-target, definitive
  F3.0.2 header list + PII columns + row grain, `/admin/import` supersession,
  reject-not-truncate SSN wording).

## [r5] R5 Scale-pack discovery decisions — RESOLVED (2026-07-13)

- **Issue:** R5 (bulk roster import via CAQH/NPPES + bulk assignment rules)
  needed PM direction before epic drafting. Twelve discovery questions were
  put to the PM; all twelve are now answered (part 2 amended some part-1
  answers — the amended versions below are authoritative).
- **Decisions (PM Sowmya, 2026-07-13):**
  1. **Sources:** NPPES lookup (if straightforward to set up) + CSV upload.
     CAQH ProView is a **later integration** — out of R5.
  2. **Conflict handling:** always allow user override — a **per-field
     review screen** for name, NPI, license, specialty. Location/address is
     NOT per-field reviewed.
  3. **Who uploads (amended):** BOTH, but **gate UI complexity behind user
     roles**. Internal Minted Panel staff get the power-user bulk-import
     tool for rapid implementation/client migration; the org rep gets a
     client-facing version via the onboarding wizard's CSV placeholder
     (E0.8 F0.8.4) with **tighter guardrails and a highly streamlined
     error-handling flow**. Upload UX requirements (both surfaces): preview
     of columns + sample rows before processing; drag-and-drop with a
     clearly defined drop zone and visual hover/active states; enforce
     `.csv` file type and a size limit; progress bar for large files with
     explicit Uploading → Scanning → Success/Failed states. Consider
     multi-file batch upload (e.g. CV, medical license, DEA cert together)
     with per-file failure handling — goal is maximizing good data at
     implementation-onboarding time. Devin to propose the remaining
     processing/extraction, storage, security, and compliance decisions in
     the epic drafts.
  4. **File spec (amended):** Devin recommends the expected CSV column spec
     based on the data needed for groups, providers, and locations. Provide
     a **downloadable .csv template directly inside the upload screen**. If
     an uploaded file's column headers don't match the required spec
     exactly, **reject the file immediately at the front gate**.
  5. **Dedupe key (amended):** Name + NPI + TIN + group + facility —
     providers can operate under multiple groups and locations, so the
     dedupe grain must include the group/facility dimensions.
  6. **Bad rows:** import the good rows; provide a **downloadable error
     report** for the rejected rows.
  7. **Preview-before-commit (amended):** yes — every import runs as a
     reviewable preview with a **high-level summary dashboard** before
     commit: counts of new providers to create, existing providers to
     update, and rows with blocked errors, plus explicit
     `Commit Changes` / `Cancel Import` actions. This confirmation step is
     the last chance to catch structural errors before the undo-less audit
     trail is generated.
  8. **Bulk assignment grain:** start simple — "assign this whole imported
     batch to group + facilities in one step." No specialty/state rule
     engine in R5.
  9. **Rule lifetime:** one-shot only (run once at import). No standing
     auto-apply rules.
  10. **Staging:** bulk-imported providers land in a **Pending Verification
      (Staged)** state and do NOT feed straight into E1.8 readiness or E2.x
      case generation. The user reviews a sample, confirms mappings, and
      explicitly commits to the database before any credentialing workflows
      trigger — prevents a bad column mapping from flooding task queues or
      triggering erroneous payer submissions.
  11. **Out of scope:** strictly data ingestion + internal entity
      assignment. NO external API calls during import (state board sites,
      rate limits = uncontrollable failure points). External verification,
      if needed, is a separate downstream workflow triggered after import
      completes. (NPPES lookup per decision 1 is a user-triggered lookup
      aid, not an in-import dependency.)
  12. **Volume:** design for thousands of records (5–10k) per import;
      **background (asynchronous) processing is mandatory**.

## [r4-review] R4 independent-review PM questions — RESOLVED (2026-07-13)

- **Issue:** The six R4 independent reviews (PRs #134–#139) raised eleven
  PM questions across E1.7b/E2.0–E2.4.
- **Decisions (PM Sowmya, 2026-07-13):**
  1. **Fallback SOP visibility (E1.7b):** yes — widen the `sop_templates`
     SELECT policy so the payerless global fallback SOP is visible to all
     orgs' members (template content only, tokens, no tenant data). Even
     without a payer SOP, the touch log helps understand status for one-off
     cases.
  2. **Fallback goes live for manual flows immediately (E1.7b/E2.2):**
     confirmed — a good side effect; no more empty cases from
     `NewCaseModal` / launch `CreateCasesDialog` for no-SOP payers.
  3. **"Using generic SOP" filter (E2.2):** a **case-list chip** (the
     URL-driven `?chip=` idiom), not a report.
  4. **Candidacy basis (E2.0):** cases are proposed only where the provider
     **actually has a clinic (facility) assignment** under the group — NOT
     for every group membership. (Overrides the reviewer's
     group-membership recommendation; see the E2.0 §5 addendum for the
     buildable presence-based rule.)
  5. **Exclusion lifecycle is status-linked (E2.0):** a key whose case
     reaches **Credentialed** stays suppressed while that status holds; if
     the case's status is later changed off Credentialed, the suppression
     lifts (the key resurfaces as an existing-case row) until manually
     excluded again. Exclusion/restore writes are **admin-only** (reviewer
     default; PM did not object).
  6. **Reapply status (E2.1):** Denied → **In Progress**, recorded in
     `status_history` as today. A final-FINAL denied case can be excluded
     and dropped from the list until its status changes again.
  7. **Recredentialing deadlines (E2.3):** ship the R4 queue on what exists
     (start dates, task due dates, follow-ups); add recred dates when R9
     lands. PM note: credentialing and re-credentialing should share the
     same lifecycle.
  8. **Location launch dates (E2.3):** rank-if-present
     (`facilities.effective_date`); the capture surface belongs to the
     later location-launch epic.
  9. **Queue nav label (E2.3):** **"My Cases"** (not the reserved "Work"
     label).
  10. **Run history placement (E2.4):** per reviewer recommendation — reach
      run history from the generation surface + per-case deep links; no new
      top-level nav item.
  11. **Run-record retention (E2.4):** follow healthcare record-retention
      practice — retain a minimum of **7 years**; records stay immutable;
      any archiving beyond that window is a later additive decision.

## [r4] Case-generation discovery decisions — RESOLVED (2026-07-12)

- **Issue:** R4 epic drafting (E1.7b SOP-as-data + E2.x case generation)
  required PM decisions on five workflow questions.
- **Decisions (PM Sowmya, 2026-07-12):**
  1. **Generation preview:** "Generate" computes every valid provider ×
     group × payer × state combination from roster × assignments ×
     payer-network targets and shows a **preview checklist** before any case
     is created. Unchecking a row records a **persistent exclusion with a
     reason** (already credentialed / panel closed / not pursuing) so the
     next run does not re-propose it. Manual one-off cases (outside the
     attached payer list) are rare and live as a **separate "create case"
     action**, not in the preview. Preview rows surface **group contract
     status** as the readiness driver (contract status joins the E1.8
     readiness inputs for generation).
  2. **Duplicates:** rows whose case already exists at the same 4-part key
     appear **grayed-out "already exists — in progress"** (never
     re-created). Reapplication after a denial is legitimate but always
     **continues on the existing case** to preserve the payer/provider
     history — never a parallel case for the same key.
  3. **Prerequisite payers: no prerequisite logic at all.** Commercial and
     Medicare Advantage applications run **in parallel**; once Medicare is
     approved the MA contract follows automatically. Prerequisites are not
     a readiness blocker and drop out of R4 scope entirely
     (`payers.prerequisite_payer_id` stays dormant).
  4. **No-SOP payers:** cases whose payer+state has no written SOP get the
     **generic fallback SOP** (the general enrollment checklist per
     `docs/redesign/E1.7b-sop-worked-examples.md` Example 2), swapped for
     the payer-specific SOP as those get authored.
  5. **Post-generation landing:** a **"next best action" queue** ordered by
     known upcoming deadlines (provider start date, location launch date,
     recredentialing deadlines).

## [e1.7a] SOP versioning model — RESOLVED (2026-07-12)

- **Issue:** The E1.7a spike required a PM decision on the SOP versioning
  model before E1.7b (SOP-as-data authoring build, R4 lane) can start. The
  ADR at `docs/redesign/E1.7a-sop-versioning-decision.md` recommended
  **Model A**: every SOP edit creates a new immutable version; in-flight
  cases keep the version their tasks were generated from (task stamp
  `(sop_template_id, sop_version)` per the E2.2 contract); newly generated
  cases pick up the latest version.
- **Decision (PM Sowmya, 2026-07-12):** **Model A approved** — "confirmed
  with business that we are good with model a." Includes the E2.2 task-stamp
  contract and the §5 step-shape extension per the ADR's sign-off checklist.
  E1.7b is unblocked for the R4 lane; the 2 real SOP worked examples remain
  a pending PM input for E1.7b grounding.

## [e1.6] Stedi / payer-data long-term source — RESOLVED (2026-07-12)

- **Roadblock:** E1.6 seeds the commercial payer catalog from Stedi, which
  requires a provisioned Stedi developer account + API key (repo secret). The
  PM is aligning on the long-term payer-data-source strategy in a separate
  thread and has not committed to Stedi as the permanent solution.
- **Impact:** E1.6 was placed on **hold** (`status: blocked`,
  `reviewed: false`). The spec itself is reviewer-enabled (§5) and the R1
  lane was unaffected — E1.6 runs in the R2 lane and no R1 epic depends on
  it. Only the catalog seed pipeline was gated.
- **Decision (PM Sowmya, 2026-07-12):** **Stedi is withdrawn.** F1.6.2 seeds
  from the self-built payer reference dataset at
  `docs/redesign/data/payer-catalog/` (PR #115 — `payers.csv` in the TE-2
  column shape, state rankings, MAC/Medicaid context, MSO delegations;
  quarterly manual refresh per its README). No external credentials needed;
  `stedi_payer_id` is retained as the column name, carrying the professional
  837P clearinghouse payer ID from the dataset. The E1.6 hold is lifted
  (`status: reviewed`, `reviewed: true`).
- **Addendum (PM, 2026-07-12, per Sonia):** clearinghouse payer IDs are
  **removed from consideration** — the field is not used by the work today
  and has no planned future use. `stedi_payer_id` is dropped from the E1.6
  schema entirely; the seed pipeline dedupes on the canonical `payer_slug`
  from `payers.csv` (new unique `payers.payer_slug` column). The dataset's
  clearinghouse-ID column stays in the CSV but is ignored.

## [e1.1] Facility-contact default + flat provider_groups columns — RESOLVED (2026-07-12)

- **Issue:** (1) `provider_groups` has three contact blocks (billing /
  correspondence / credentialing) and no generic phone column; the
  facility-contact fallback rule (E1.2 F1.2.1) did not name which block or a
  precedence. (2) Whether R1 builds on the flat `provider_groups` columns vs.
  the register's planned `group_addresses`/`group_contacts` normalization, and
  whether E1.6 extends the existing catalog. (3) Confirm E1.1 `reviewed: true`.
- **Decision (PM Sowmya, 2026-07-12):**
  1. A facility's contact fields (tel / fax / contact) **inherit the owning
     group's contact unless the facility provides its own**. Block precedence
     when multiple group blocks are populated: credentialing → correspondence →
     billing (first non-empty wins).
  2. R1 **builds on the flat `provider_groups` columns**; E1.6 **extends** the
     existing global catalog. The address/contact normalization epic lands
     post-R1, not pulled into Stage 1.
  3. E1.1 `reviewed: true` stands.

## [e0.10] Constraint-validation fixture scale — RESOLVED (2026-07-12)

- **Issue:** BD-1 (bad-row audit) and BD-2 (allowed state set) inputs are
  needed before the `VALIDATE` step of the state-format constraints, and the
  test surface for the deferred routing invariants was undefined.
- **Decision (PM Sowmya, 2026-07-12):** Exercise the audits/tests against an
  expanded fixture — two orgs, each with multiple groups spanning 10–20 states
  and 400+ providers, each generating multiple MSO routing rules across its
  states. Extend `seed-universe.md` accordingly and document the best-practice
  test cases. BD-2's allowed set is the canonical US 2-letter list already used
  by the form validators. Fixture build is tracked as separate work.

## [e1.8] Document readiness gaps have no fix-here surface — RESOLVED (2026-07-12)

- **Roadblock:** F1.8.2 derives group W-9 and voided-check readiness from
  `provider_documents`, and F1.8.3 requires every red item to link to the exact
  surface where it is fixed. The table and RLS exist, but the current app has
  no `provider_documents` service, hook, upload UI, or repo-managed Supabase
  Storage bucket/policies. Group insurance is manageable today through
  `InsurancePanel`; W-9 and voided-check documents are not.
- **Impact:** The authored acceptance criteria cannot be met as written:
  document checks would remain red with no in-product remediation path, or the
  build would silently absorb a document-upload/storage feature that the epic
  does not explicitly scope. E1.8 was `reviewed: false` pending this decision.
- **Options:**
  1. Add a minimal private group-document upload/view/replace surface to E1.8,
     using the existing `provider_documents` rows plus an additive private
     Storage bucket, org-scoped object policies, signed downloads, and audit.
  2. Add a preceding document-management epic/dependency and keep E1.8 blocked
     until that surface merges.
  3. Relax F1.8.3 for R3 so document gaps may link to the owning group screen
     or an explicit manual workflow; retain exact fix-here links for checks
     with existing editors.
- **Decision (PM Sowmya, 2026-07-12): Option 3.** F1.8.3 is relaxed for R3:
  document/COI/voided-check red items link to the owning provider/group screen;
  only checks with an existing editor (license, provider form, facility
  section) keep an exact fix-here link. No document-upload/storage surface is
  pulled into E1.8 — a dedicated documents surface stays a future epic. The
  read-only readiness matrix still evaluates document presence regardless.
  E1.8 restored to `reviewed: true`.

## [stage-3] R3 scope decisions (E1.4, E1.5, E1.8) — RESOLVED (2026-07-11)

- **Issue:** Open questions blocking R3 epic authoring: assignment scoping,
  primary-location semantics, per-location start dates, payer attachment
  grain and curation, archive/reapply behavior, and the readiness model.
- **Impact:** Blocked drafts of E1.4, E1.5, E1.8.
- **Decision (PM, 2026-07-11):**
  1. **E1.4:** the facility picker is scoped to the provider's group(s)'
     facilities only — never the whole org. Exactly one primary practice
     location per provider, even across groups. Locations are hand-picked
     every time (no auto-assign in R3; bulk rules are R5). Each assignment
     carries a required **start date** (the team computes this by hand today
     per provider per location — it becomes a first-class data point:
     additive `provider_facility_assignments.start_date`). No unassigned
     resting state: every provider needs a group and ≥1 location.
  2. **E1.5:** the UX is org-level intent ("this org works with BCBS"); the
     system expands it into group × state target rows derived from the
     group's facility states, shown for review with uncheckable exceptions
     (new `payer_network_targets` child table — `org_payer_assignments`
     stays the Minted-curated visibility layer, configured at onboarding and
     editable from group settings so payers can be added as org needs grow).
     Attach = "we intend to pursue"; no attachment status — real status lives
     on contracts/cases. Remove = archive (hidden from new case generation,
     history kept) with easy re-attach, because payers deny then reopen.
     Prerequisite-payer checks are case-generation-time (R4), not
     attach-time.
  3. **E1.8 = enrollment readiness only** (location-launch readiness is a
     separate future epic). Fully derived matrix at the case-key grain
     (provider × group × payer × state) over active targets. Checks split
     into a **provider checklist** (license exists/current/PSV-verified,
     CAQH ID + attested within **120 days**, NPI, demographics, malpractice)
     and a **group checklist** (facility in target state, W-9, COI, voided
     check). Advisory only — never blocks; case generation soft-warns. Gaps
     render as red items worked from the screen; no automatic task creation.

## [stage-1c] R1 form-scope decisions (E1.1–E1.3) — RESOLVED (2026-07-10)

- **Issue:** The remaining open questions blocking R1 epic authoring: group
  save requirements and flow, facility minimums and CAQH location fields,
  provider baseline field set, license PSV handling, SSN storage, and
  progress semantics.
- **Impact:** Blocked final drafts of E1.1, E1.2, E1.3.
- **Decision (PM, 2026-07-10):**
  1. **E1.1:** TIN is required to save a group. All three address + contact
     blocks (billing, correspondence, credentialing) are in the R1 form.
     Dual-path exit: primary "Next: Facilities" + secondary "Add another
     group"; section Complete at ≥1 group, no confirmation gate.
  2. **E1.2:** minimum save = address + state + group + at least one contact
     channel; facility contact defaults (inherits) from the owning group's
     phone/contact when absent. CAQH practice-location fields (accepting new
     patients, languages, interpreter languages, ADA, appointment phone) are
     in the R1 form as optional — this supersedes the earlier
     exclude-from-R1 call (CAQH alignment wins).
  3. **E1.3 baseline = CAQH-required provider core** minus full SSN, work
     history, and disclosure questions (CAQH holds those; "attestation
     current" is the proxy until the R5 import). Required to save: name,
     Type 1 NPI, ≥1 group assignment; everything else optional at entry
     (readiness gates later, E1.8).
  4. **Group assignment required at entry** — no unassigned providers; M:N
     multi-select with one primary. Provider status stays hidden and
     defaults to `onboarding` (no status picker in R1). Multiple state
     licenses supported in the R1 form.
  5. **License PSV is recorded, not lost:** each license carries verified
     status/date/verifier + the state-board lookup URL. Re-verify at
     renewal — editing expiration resets verification (feeds R9 clocks).
  6. **SSN stays last-4 only** (AGENTS.md rule unchanged). Full-SSN need
     (CAQH/Medicare/UHC form fill) is deferred to a future "Sensitive
     Identifiers Vault" epic in R6/R7: encrypted separate storage, role-gated
     reveal/fill, re-auth, append-only access audit, no browser/list/export
     exposure.
  7. **Progress is fully derived from data** — no manual "mark section done"
     anywhere (confirms the E1.0 design).

## [stage-1b] Payer catalog supersede-vs-extend, contract renewals, data migration — RESOLVED (2026-07-10)

- **Issue:** Three follow-on decisions after the E1.0 lock: (a) whether E1.6
  extends or supersedes the existing global payer catalog mechanism (migration
  `20260707060000_global_catalog_org_assignment.sql` + `payers` global rows +
  `org_payer_assignments`); (b) whether contracts are versioned per renewal;
  (c) whether existing production data needs a migration path into Stage 1.
- **Impact:** Blocked E1.6/E1.5 authoring (catalog + attachment model) and the
  roadmap's migration line.
- **Decision (PM + repo audit, 2026-07-10):**
  1. **E1.6 extends, does not rebuild.** The global-row pattern
     (`payers.org_id IS NULL` = global, visible only via
     `org_payer_assignments`, platform-managed via service role) is proven and
     stays. `payers` already carries curated credentialing fields
     (`portal_url`, `avg_decision_days`, `caqh_pull_deadline_days`,
     provisional/retro billing). E1.6 adds additive columns — `payer_kind`,
     `stedi_payer_id`, `cms_hios_id`, `aliases[]`, `states[]`, `status`,
     `merged_into_id`, `last_synced_at` — plus the append-only
     `payer_catalog_changes` diff table and the Stedi seed pipeline. Existing
     org-scoped payer rows are left untouched; converting them to global rows
     stays a separate, human-supervised step (per the original migration's
     note).
  2. **E1.5 attachment grain gets a new child table.**
     `org_payer_assignments` (UNIQUE(org_id, payer_id)) remains the
     visibility/subscription layer; the group + state attachment grain lands
     in a new additive table (working name `payer_network_targets`:
     org × group × payer × state).
  3. **Contracts: one row per group × payer × state, not versioned.**
     Renewal/recred history is derived from `status_history`/touches, not
     contract-row versions — E5.2 (recred pipeline) authoring must account
     for this.
  4. **No data-migration workstream.** Current production book is dummy data;
     real client data starts fresh in the new Stage 1 flows at cutover.

## [stage-1] Four R1 scope decisions — RESOLVED (2026-07-10)

- **Issue:** Four decisions blocked R1 (E1.0–E1.3) authoring: wizard audience,
  license source of truth, the shape of `facilities.hours` jsonb, and the
  credentialing-case uniqueness key.
- **Impact:** E1.0 framework, E1.2 hours form, E1.3 roster model, and the
  Stage 2 generation key could not be specced without guessing.
- **Decision (PM, 2026-07-10):**
  1. **Wizard audience:** internal-only (P1 Credentialing Manager) through
     Stage 3; no client-facing wizard access in R1–R7.
  2. **License source of truth:** hand-entered in v1; CAQH/NPPES import
     deferred to the R5 scale pack.
  3. **Facility hours:** per-day jsonb in the existing `facilities.hours`
     column — `{ "mon": { "status": "open", "open": "07:00", "close":
"19:00" }, …, "sun": { "status": "closed" } }`. Grain matches payer
     forms (per-day status/open/close, e.g. Humana provider certification)
     and doubles as the extension fill contract. E1.2 form gets a weekday
     quick-fill; no split shifts in v1.
  4. **Case key is 4-part:** provider × group × payer × state. Real-world
     basis confirmed by PM: the same provider can be credentialed with the
     same payer in different states under different groups, or with the same
     payer/state under multiple groups. Companion rules: (a) contracts remain
     group × payer × state — each group's own TIN enrollment is a separate
     contracting effort; (b) "group has a facility in the target state and
     the provider is licensed there" is an E1.8 readiness check and E2.0
     soft warning, not a DB constraint. This amends the AGENTS.md rule
     "one credentialing case per (provider_id, payer_id, state)"; the epic
     implementing the key change (E1.3/E2.3) must carry the AGENTS.md
     amendment in its diff.

## [e0.10] State-constraint scope and routing-rule overlap semantics — RESOLVED (2026-07-10)

- **Issue:** F0.10.2 says to constrain "the six `state` columns," but the
  current schema does not have one unambiguous six-column set. It has operational
  jurisdiction fields (`contracts.state`, `credential_cases.state`,
  `state_licenses.state`), physical-address fields (`facilities.state`,
  `providers.home_state`, and three `provider_groups.*_state` columns), a
  frozen provider license mirror (`providers.license_state`), and wildcard
  matching fields (`mso_routing_rules.state`, `sop_templates.state`) where
  `All`/NULL are valid today. The epic's named "group/facility/provider state
  fields" therefore does not match the spike's six-column claim, and applying
  `^[A-Z]{2}$` to the wildcard fields would break current routing/template
  behavior.
- **Issue:** F0.10.3 says overlapping MSO routing rules must be rejected with
  `UNIQUE (org_id, payer_id, state, specialty)`. The current resolver
  intentionally permits multiple matching wildcard layers (`All`) and ranks
  exact specialty/state above fallbacks, with newest-row tie-breaking. The
  proposed UNIQUE key prevents only exact duplicate tuples; it neither rejects
  all overlapping matches nor defines whether the existing wildcard precedence
  should remain.
- **Impact:** E0.10 cannot be technically enabled without guessing which state
  fields are business jurisdiction codes versus addresses/wildcards, or whether
  routing fallbacks remain a supported product behavior. The file remains
  `reviewed: false`; F0.10.2 and the routing-rule part of F0.10.3 are blocked.
  The implementation plan must also stage audits/remediation before adding
  UNIQUE indexes, because PostgreSQL does not support `UNIQUE ... NOT VALID`.
- **Options:**
  1. Constrain only canonical operational jurisdiction fields; explicitly list
     them, preserve `All`/NULL wildcard fields, and handle address normalization
     in the later address/contact epics.
  2. Constrain operational plus physical-address fields; explicitly list every
     column and define nullable/territory behavior, while still excluding
     wildcard matching fields.
  3. For MSO routing, preserve wildcard precedence and narrow the invariant to
     "no exact duplicate at the same specificity," or prohibit overlapping
     matches and replace the current resolver contract. A third option is an
     explicit additive priority field with a deterministic uniqueness rule.
- **Decision (PM, 2026-07-10):** Option 1 for state scope — constrain only the
  reviewer-pinned scalar jurisdiction/address columns listed in the epic's TE-2
  and preserve the `All`/NULL wildcard fields (`mso_routing_rules.state`,
  `sop_templates.state`) untouched; address normalization stays with the later
  address/contact epics. The MSO routing-rule uniqueness constraint is DEFERRED
  out of E0.10 entirely — the resolver's wildcard precedence remains the
  supported behavior until the PM picks a routing invariant (the three options
  above stay on the backlog). Unique constraints are audit-first (no
  `UNIQUE ... NOT VALID`), recorded in the epic's TE-3/TE-7. E0.10 is restored
  to `reviewed: true` with these amendments.

## [design-conformance] Sidebar IA v2 supersedes E0.6 nav + E0.8 "Org space" label — RESOLVED (2026-07-10)

- **Issue:** The PM-approved design system handoff (`docs/redesign/design-system/`)
  restructures the sidebar (Workspace: Home/Cases; Payers: Payer Management;
  Reporting Center; org zone as a labeled switcher tile with Account Detail /
  Facilities / Providers children) — superseding the E0.6 segmented nav
  (Setup/Config group, reserved Tasks/SOP items) and the E0.8 F0.8.7
  `Org space` label days after they shipped.
- **Decision:** PM-approved via the design handoff (2026-07-10). Tasks roll up
  under Cases; SOP folds into Payer Management; no `Org space` heading. The
  handoff is also the explicit authorization to modify the protected token,
  layout, and ui files it names.

## [e0.7] BD-1: Rate-limit mechanism for anon RPCs — RESOLVED (2026-07-09)

- **Issue:** F0.7.1 requires throttling on the four `anon` RPCs, but Stage 0
  has no server middleware tier and no-new-deps is a hard rule, so the limit
  must live inside Postgres.
- **Impact:** Blocked F0.7.1's throttle half until the mechanism was chosen.
- **Reviewer note (Devin, 2026-07-09):** Confirmed against the codebase — no
  throttle/attempts table or per-source counter exists in
  `supabase/migrations/` today; `submit_inbound_lead` has only the honeypot +
  required-field validation, and the three token RPCs rely solely on token
  entropy. A `public_rpc_attempts` counter table + a `CREATE OR REPLACE` fold
  into the four `anon` RPCs is implementable additively with no new deps and
  no middleware.
- **Decision (PM, best-judgment delegation):** Use low-cost in-Postgres rate
  limiting: a small `public_rpc_attempts` table keyed by a coarse source
  fingerprint (RPC name + hashed caller hint), lazily pruned, with
  conservative thresholds and a uniform invalid/expired response. No new
  infra. The E0.7 PR (#77) shipped the uniform-response half; the throttle
  build carries into E0.8 (F0.8.8).

## [e0.7] BD-2: Scoped accessibility pass on public routes — RESOLVED (2026-07-09)

- **Issue:** The public routes (`/capture`, `/contact`, `/share`) are the only
  pages outsiders see; they had no keyboard/label/focus audit.
- **Impact:** Scoped F0.7.5 needed a yes/no on the a11y pass.
- **Decision:** Include the scoped pass (labels, focus order, keyboard submit,
  error announcement) on the three public routes. Not shipped in PR #77;
  carries into E0.8 (F0.8.9).

## [e0.6] Navigation IA supersedes the already-merged E0.0 sidebar — RESOLVED (2026-07-09)

- **Issue:** E0.6 replaces E0.0's journey sidebar (Portfolio → Get started →
  Scope → Work → Outcomes, shipped + merged in #67) with a segmented IA: TOP =
  cross-org (Home, Reporting Center), BOTTOM = org-scoped (Account Detail, +
  reserved Facilities/Providers). Portfolio stops being a top-level nav item and
  becomes report #1 inside the new Reporting Center. This reworks merged code.
- **Impact:** Forks the E0.6 build and requires retargeting E0.4's all-inactive
  fallback (which pointed at Portfolio).
- **Decision:** PM chose the **full rework now** — E0.6 re-lays the sidebar to
  the segmented model and moves Portfolio into the Reporting Center. E0.4's
  fallback retargets to the Reporting Center / Home per the new IA. (PM also
  noted: build a whole stage's epics as a batch in future to avoid this kind of
  intra-stage rework — Stage 0 is now fully specified, so the remaining epics
  can build against the final IA.)

## [e0.6] Portfolio share-link lifetime — RESOLVED (2026-07-09)

- **Issue:** E0.5 links are 72h/single-use; a read-only dashboard share an owner
  checks repeatedly may warrant a longer/renewable life.
- **Decision:** **Revocable, 30-day default.** P1 can revoke at any time. This
  diverges from E0.5's 72h single-use because the E0.6 share is read-only and
  low-risk (no writes, scope-filtered).

## [e0.5] BD-1 — Unauthenticated recipient access model — RESOLVED (2026-07-09)

- **Issue:** E0.5's premise is an external recipient submitting data with NO
  account. Every data path today requires an authenticated session under
  org-scoped RLS. This is the first Stage 0 surface to cross the trust boundary.
- **Impact:** Forks the enabler design (TE-3).
- **Options:** (a) RECOMMENDED: public token-validated route `/capture/:token`
  backed by `SECURITY DEFINER` RPCs that hash-validate the token and read/write
  only the single authorized party — no anonymous GoTrue session, no login
  (consistent with the E0.0 "no login" default). (b) mint an anonymous Supabase
  session per link (heavier; not recommended for Stage 0).
- **Decision:** (a) — PM confirmed the lightweight token link (no login). Form
  data is basic org info, so the token isn't securing secret data; it only binds
  a link to one org's record (prevents a forwarded/guessed link overwriting the
  wrong org or revealing which org it targets). PM also directed folding an
  INBOUND "contact us" lead-capture flow into E0.5 — added as reviewer-proposed
  F0.5.5 + TE-7; inbound leads are triaged by P1 (recommended default), not
  auto-created orgs. Outbound remains as authored.

## [e0.5] BD-2 — Email delivery in Stage 0 — RESOLVED (2026-07-09)

- **Issue:** Nothing in the stack sends application email (GoTrue = auth mail
  only; no transactional provider). AGENTS.md forbids new deps without
  justification. The epic's Dependencies say "email delivery service … not
  stub," conflicting with the Stage 0 no-new-infra posture.
- **Impact:** F0.5.4 delivery mechanism. Does NOT block the rest of E0.5.
- **Options:** (a) RECOMMENDED: generate the link + render the exact email copy
  for P1 to copy/send — no send infra; F0.5.4 content is testable as rendered
  template text. (b) integrate a transactional provider (Resend/Postmark/SES) +
  domain verification — a new external dependency.
- **Decision:** (a) — PM confirmed. Stage 0 renders copy-able email text only;
  no send infra. Real transactional sending is a separate future decision.

## [e0.4] "Flag orgs as inactive" vs the e0.0 locked no-lifecycle-label rule — RESOLVED (2026-07-09)

- **Issue:** E0.4 F0.4.2 requires the all-inactive Portfolio fallback to show
  "all orgs visible/flagged" as inactive. E0.0's locked decision says the
  lifecycle state is "never surfaced to the Credentialing Manager as a status
  label."
- **Impact:** None if the default holds; E0.4 builds on it.
- **Options:** (a) DEFAULT, assumed: in the all-inactive fallback state ONLY,
  inactive orgs render under an **"Inactive" group heading** — the same grouping
  mechanism as the existing "Prospects"/"In motion" Portfolio sections, which is
  already user-visible lifecycle grouping. No per-org status pill/label anywhere;
  the E0.0 rule holds everywhere else. (b) Per-org "Inactive" pills — rejected
  as written: directly violates the locked decision. (c) No labeling at all,
  just an empty-state message + create CTA — loses "all orgs visible."
- **Decision:** PM confirmed option (a) on 2026-07-09. In the all-inactive
  fallback only, inactive orgs render under an "Inactive" group heading — the
  same grouping mechanism as the existing "Prospects"/"In motion" Portfolio
  sections. No per-org status pill/label anywhere; the E0.0 no-label rule holds
  everywhere else.

## [e0.3] Cross-org parties are an exception to the org-RLS convention — RESOLVED (2026-07-09)

- **Issue:** F0.3.4 requires one Party record reusable across orgs, so `parties`
  cannot carry a single `org_id` — an exception to the repo-wide "every table
  org-scoped by RLS" convention (AGENTS.md).
- **Impact:** None if the default holds; build proceeds on it.
- **Options:** (a) DEFAULT, assumed: `parties` has no `org_id`; RLS grants
  access where the caller has a membership in an org the party is assigned to
  (via `party_role_assignments`, which IS org-scoped as usual) or the caller
  created the party. (b) Org-scoped parties with duplication per org — rejected:
  defeats the entire purpose of E0.3.
- **Decision:** PM confirmed option (a) on 2026-07-09. `parties` carries no
  `org_id`; RLS grants access via assignment membership (org-scoped
  `party_role_assignments`) or `created_by`. The documented, tested exception
  to the org-RLS convention stands as implemented in
  `20260709120000_party_model_foundation.sql`.

## [e0.1 + e0.2] One party model for owner + CRM contacts — RESOLVED (2026-07-08)

- **Issue:** No party/role or org-contact tables exist in the schema. Three
  epics describe person records: E0.1 owner capture ("Full Party model"), E0.2
  customer/sales-rep contacts, E0.3 Full Party model (not yet delivered).
- **Impact:** Blocks the E0.1/E0.2 schema design; build proceeds on the default
  once confirmed.
- **Options:** (a) DEFAULT, assumed: E0.1 introduces a minimal additive
  foundation — `parties` (org-scoped person: name, email; E0.2 adds phone +
  split address) + `org_party_roles` (role check list: `owner`, then
  `customer_contact`, `sales_rep`) — which E0.3 extends rather than replaces.
  (b) Resequence: deliver E0.3 (Full Party model) before E0.1/E0.2. (c) Separate
  throwaway storage per epic (owner columns on `organizations`, a distinct
  `org_contacts` table) — rejected: E0.3 would strand both.
- **Decision:** PM confirmed option (a) on 2026-07-08. Additionally, E0.3
  (Full Party model) is nearly done — builds are queued so E0.1–E0.3 are
  reviewed together before hand-off, letting the party model be validated
  across all three epics up front.

## [e0.2] seed-universe.md lacks customer-contact fixtures — RESOLVED (2026-07-08)

- **Issue:** E0.2 FR-5 requires demo/test contacts "per seed mapping", and its
  UX notes name examples (Coach Eric Taylor, Kitty Forman), but
  `seed-universe.md` has no per-org customer-contact table (names, emails,
  phones, split addresses) and no Zeb Loewenstine entry.
- **Impact:** E0.2's seed + Playwright verification has no fixture source.
- **Decision:** PM directed the reviewer to close the gap directly (2026-07-08).
  Devin added the "CRM contact fixtures (E0.2)" section to `seed-universe.md`
  (Zeb Loewenstine sales-rep row + per-org customer contacts, `.test` emails,
  555 numbers, split addresses).

## [e0.1] Duplicate guard: hard block vs seed-universe "soft warning" — RESOLVED (2026-07-08, reviewer)

- **Issue:** `seed-universe.md` TS-6 says "duplicate soft warning"; E0.1 F0.1.4
  explicitly says hard block, no override.
- **Decision:** E0.1 wins (later, explicitly PM-aligned): hard block on exact
  case-/space-insensitive name match; "similar city/state" matching stays
  optional and is not implemented in Stage 0. The TS-6 fixture pair have
  different normalized names and coexist as seeds; TS-6 is tested by attempting
  to create an org with the same normalized name. `seed-universe.md` reviewer
  notes record the correction.

## [e0.0] "No login" locked decision vs Supabase RLS — RESOLVED (2026-07-08)

- **Issue:** E0.0 locks "No login, no login roles, no default landing … no auth
  ceremony," but every data read/write runs through org-scoped RLS, which
  requires an authenticated Supabase session. Login cannot be literally removed
  without replacing the data layer.
- **Impact:** None if the intended meaning is UX-level; blocks nothing today.
  Build proceeds on the default below.
- **Options:** (a) DEFAULT, assumed: keep the existing session bootstrap
  (`/login`, persisted session) beneath the shell; the redesigned UX simply has
  no login ceremony, role gates, or landing gate. (b) Literal removal — would
  require a shared anon/service data path, a major architecture change out of
  Stage 0 scope.
- **Decision:** PM confirmed option (a) on 2026-07-08. The existing session
  bootstrap stays beneath the shell; the redesigned UX has no login ceremony,
  role gates, or landing gate.

## [e0.0] Shared "not yet available" empty-state component — RESOLVED (2026-07-08)

- **Issue:** OQ-3 — whether one shared composition component (existing
  primitives only) is allowed under the "no new components" hard rule.
- **Decision:** PM confirmed on 2026-07-08: allowed. One shared composition
  component may be built from existing primitives for the reserved-route empty
  state.

## [e0.0] "Get started" sidebar persistence (OQ-2) — RESOLVED (2026-07-08)

- **Decision:** PM confirmed on 2026-07-08: "Get started" is always present.
  Revisit only if the PM reopens it.
