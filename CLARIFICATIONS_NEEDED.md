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
