# Provider ↔ Minted Requests — the post-onboarding communication workflow

> **Amended Oct 19, 2026.** The Oct 18 to 19 design review changed parts of this doc. Where they conflict, the provider onboarding engineering handoff wins. It's in the Obsidian vault at `20 Projects/Minted Panel/Minted Panel - Provider Onboarding Engineering Handoff.md`. Changes that touch this doc:
> - Request emails deep-link straight to the specific ask after the code. For documents, she picks the type, uploads and submits.
> - A new provider-initiated "Update my profile" entry lets her update without being asked, and a coordinator reviews changes before they feed payer applications. This relaxes §4.2's "the gateway shows asked items only".
> - Requests ship in Release 3, not Release 4.

**Status:** vision / planning only. No code. Builds on the approved onboarding
stages ([Stage 1](./mid-cycle-onboarding-stage-1.md), [Stage 2](./mid-cycle-onboarding-stage-2.md),
[Stage 3](./mid-cycle-onboarding-stage-3.md)) and uses the **draft** Minimum
Data Set (Stage 1 §1.10; CAQH ID decided required 2026-10-17).
**Date:** 2026-10-17
**Scope:** how Minted reaches a provider *after* onboarding to obtain something
(a CAQH re-attestation, a renewed document, a confirmed field, an answer) and
how the provider answers, through the one provider-facing door the onboarding
stages already commit to. Three scenarios are answered against the codebase
(§2–§4), then generalized into one request model that is **not a new
subsystem** (§5). Mocks are deliberately not part of this deliverable; the
canvas gets them only if the PM asks.

Carried in, not re-argued:

- The gateway `/join/$org` is the provider's only door; the link is the door,
  a code to the bound inbox is the key; a verified gateway session is a
  short-lived server-side session bound to the provider row, never a Supabase
  Auth user (Stage 1 §1.4, §1.6).
- Events are `audit_log` rows plus provider `notes` (provider grain) or case
  `touches` (case grain), never flags (Stage 1 §1.4; Stage 2 §2.0).
- Reminders are the Stage 2 ladder: max three, business hours only, one per
  business day, idempotent on the audit row, escape hatches on every email,
  then hand to a human (Stage 2 §2.2).
- There is no provider-facing transactional email today; choosing one is a
  Stage 1 prerequisite (Stage 1 §5.1). Nothing here measures delivery or opens.
- Provider-facing copy uses generic roles ("your practice administrator"),
  never a named coordinator; synthetic names only in examples.

---

## 0. What already exists (the zero-overbuild inventory)

Every piece of the workflow below is one of these, pointed at a different
moment in the provider's life.

| Surface | What it is today | Reused for |
| --- | --- | --- |
| CSV provider template, `PROVIDER_TEMPLATE_HEADERS` ([`src/lib/importSections.ts`](../../src/lib/importSections.ts)) | Carries `caqh_id` **and** `caqh_last_attested_date` (both nulled when `is_new_grad` is true; `buildMapped` maps both; the commit RPC was widened by [`20260919033009_provider_csv_add_provider_parity.sql`](../../supabase/migrations/20260919033009_provider_csv_add_provider_parity.sql)). | §2: a bulk-uploaded provider can arrive with a CAQH date, or without one. |
| `CAQH_CURRENT_DAYS = 120`, `isCaqhCurrent` ([`src/lib/enrollmentReadiness.ts`](../../src/lib/enrollmentReadiness.ts)); `stale_caqh` / `missing_caqh` ([`src/lib/providerGaps.ts`](../../src/lib/providerGaps.ts)) | Pure, date-only derivations against a passed-in `today`. Rendered as the roster gap pill "CAQH attestation stale" ([`src/routes/providers.index.tsx`](../../src/routes/providers.index.tsx)), the readiness check "CAQH attested within 120 days" ([`src/components/providers/ProviderReadinessSection.tsx`](../../src/components/providers/ProviderReadinessSection.tsx)), and the queue action "Resolve readiness gap: …" ([`src/lib/nextBestActions.ts`](../../src/lib/nextBestActions.ts), readiness gap outranks touch-due and tasks). | §2: detection. Nothing new detects; nothing is scheduled. |
| `POST /api/providers/:id/caqh-attestation` ([`src/server/providerRoutes.ts`](../../src/server/providerRoutes.ts)) and the "CAQH last attested date" field ([`src/components/providers/ProviderFormSections.tsx`](../../src/components/providers/ProviderFormSections.tsx)) | The two existing writers of `providers.caqh_last_attested_date`: the extension after a CAQH fill (future date → 422, stamps `provider_field_verifications` with source `caqh`), and the coordinator typing a date. Both go through `updateProvider` ([`src/services/providers.ts`](../../src/services/providers.ts)), so org scoping and the UPDATE audit row come from one path. | §2: the provider's own "I attested on …" lands through the same `updateProvider` path. |
| `provider_documents` vault + signing boundary ([`src/server/documentRoutes.ts`](../../src/server/documentRoutes.ts), [`src/services/documents.ts`](../../src/services/documents.ts), [`src/lib/documents.ts`](../../src/lib/documents.ts), [E4.5](../redesign/E4.5-document-storage.md)) | Immutable versions, "current" derived, `caseId` optional on upload, dated kinds require an expiration date, 25 MiB pdf/png/jpeg, cross-org id 404s before signing, every intent/finalize/download audited. Owner grains: provider-owned kinds are `state_license`, `dea`, `cv`, `diploma`, `board_cert`, plus `coi`/`filled_form`/`other` (both grains) — `uploadableKinds("provider")`. | §3: the provider's upload is a version in the same vault, through the same two routes behind a different guard. |
| SOP step `requiredArtifacts` + `attachments` pointer ([`src/types/index.ts`](../../src/types/index.ts) `SOPStep`; [`src/components/cases/StepArtifactsPanel.tsx`](../../src/components/cases/StepArtifactsPanel.tsx)); `requiredDocumentKinds` + [`src/components/documents/CaseRequiredDocuments.tsx`](../../src/components/documents/CaseRequiredDocuments.tsx) | A case step names what it needs; a pointer (never a copy) says what satisfies it; the case shows present / missing / expired per required kind (E4.5 F4.5.3). `projectTaskSteps` ([`src/services/caseContext.ts`](../../src/services/caseContext.ts)) whitelists step keys to the extension, which is how `payerForm` was added without a wire-contract change. | §3: a document request is a pointer on the step that needs the document; fulfilment is the attachment pointer appearing. |
| Expiring credentials ([`src/components/documents/ExpiringCredentialsTable.tsx`](../../src/components/documents/ExpiringCredentialsTable.tsx), [`src/routes/reporting.expiring-credentials.tsx`](../../src/routes/reporting.expiring-credentials.tsx)) | Per-kind `expiringSoonDays` thresholds, derived at render. | §5: the provider-grain "renew this document" ask is raised from here. |
| `touches` (append-only; `entry_type ∈ touchpoint/note/system_event/task_update`; seven types incl. `provider_outreach` and `caqh_update` in [`src/lib/touchTypes.ts`](../../src/lib/touchTypes.ts); `recipient_name`/`recipient_contact`; `next_follow_up_date` + the carry-forward reducer in [`src/lib/followUps.ts`](../../src/lib/followUps.ts); `corrects_touch_id` self-FK) | The one case-activity spine. `provider_outreach` is literally "we contacted the provider" and already reports as internal-facing. | §3, §5: every case-scoped ask and answer is a touch; the follow-up date is the human's reminder; corrections stay appends. |
| `notes` (`entity_type = 'provider'`, live; `getNotesFor` / `createNote` in [`src/services/lookups.ts`](../../src/services/lookups.ts)) | The provider-grain activity line, already chosen by Stage 2 for "Mark contacted", "help requested", nudge events. | §2, §5: provider-grain asks and answers. |
| `audit_log` (`action_type ∈ CREATE/UPDATE/STATUS_CHANGE/TOUCH_LOGGED/TERMINATION/READ`, `before`/`after` jsonb, `description`; browser read via [`src/services/audit.ts`](../../src/services/audit.ts)) | Stage 2 §2.4 already makes it the event source for `invited`, `code_verified`, `submitted`, `nudge_sent`. | §5: the **machine-readable** ask lives in `audit_log.after`; the human-readable copy is the note or touch. |
| Anon intake attribution ([`supabase/migrations/20260717120100_ssn_intake_links.sql`](../../supabase/migrations/20260717120100_ssn_intake_links.sql)) | `submit_ssn_intake` writes its audit row with `user_id = link.created_by` and a description saying the value came "via secure intake link". | §5: a provider's own write is attributed to the coordinator who issued the link, with the description naming the provider as the actor. No provider user id exists, by design. |
| Lockdown chrome ([`src/routes/ssn-intake.$token.tsx`](../../src/routes/ssn-intake.$token.tsx)) and the public-route list in [`src/routes/__root.tsx`](../../src/routes/__root.tsx) | `Shell` with the shield mark; used/expired/revoked/invalid never confirm which provider a bad token targets. | The gateway's "Needs you" screens, verbatim. |
| Stage 1 gateway build inventory (§1.6): `provider_intake_links`, `request_intake_code`, `verify_intake_code`, `submit_intake` | One route, one table, three anon RPCs, the existing form. One active link per provider (the E4.4 partial unique). | §5: requests do not add a link table, a code, or a session. They add **screens** behind the same verified session. |
| Case status ([`src/lib/caseStatus.ts`](../../src/lib/caseStatus.ts)) and the legacy `status_configs` "Waiting on Provider" row with `action_bucket = waiting_provider` ([`src/lib/canonicalStatuses.ts`](../../src/lib/canonicalStatuses.ts)) | The canonical 8-status set has no "waiting on provider" state; every transition goes through `set_case_status`. | §5: an open request never moves a case. "Waiting on the provider" is derived from the open request, not stored. |

Two facts from the inventory shape the design:

1. **Detection already exists for the facts that matter; what is missing is
   the ask and the answer.** Stale CAQH, expiring documents, missing MDS
   fields are all derived today and rendered to the coordinator. The gap is
   that the coordinator then leaves the system (own inbox, phone) to ask, and
   re-enters it to record what came back.
2. **The provider's write path already has a shape.** `submit_ssn_intake` is a
   provider writing one fact into the org's data without an account, through
   a link, attributed to the issuer, audited. Every answer below is that shape
   with a different fact.

---

## 1. Design stance

**A request is not a record. A request is an ask event about a fact the
system already tracks, and it is open while the fact is still unmet.**

| Part | Where it lives | Example |
| --- | --- | --- |
| The **fact** | An existing column, row, or pointer | `providers.caqh_last_attested_date`; a `provider_documents` version; a step `attachments` pointer; a `provider_field_verifications` row; a reply touch |
| The **ask** | One `audit_log` row (structured, in `after`) + one human-readable line at the grain of the fact (provider `notes` row or case `touches` row) | "Asked the provider to re-attest CAQH · Oct 17" |
| The **door** | The provider's gateway session (`/join/$org`, Stage 1) | The email's one button |
| The **answer** | The provider's write to the fact, through the Stage 1 RPC pattern, plus its own event line | "Provider reported CAQH attested Oct 17 (via gateway)" |
| **Open / fulfilled / lapsed** | **Derived** by one pure lib from ask events + the fact + `today` | open = ask exists and the fact is unmet since the ask |
| **Reminders** | Stage 2 ladder, fed by the same derivation | nudge rows in `audit_log` |
| **Who asks** | A human with a writer role, from the place that shows the gap | Never a scheduler; Stage 1 dropped periodic detection |

Consequences:

- **No `provider_requests` table.** The ledger is the audit log (which Stage 2
  already treats as the event source) and the grain-appropriate activity line.
- **No status column anywhere.** "Waiting on provider", "fulfilled", "lapsed"
  are read off the fact and the events.
- **One door.** Onboarding (Stage 1 Workflow B) is simply the first request a
  provider ever receives: "complete your profile." Every later request is a
  smaller screen behind the same code-verified session. The gateway's
  post-code screen becomes **"Needs you"**: the list of open requests, or
  "Nothing needed right now."
- **Human asks, machine reminds.** The coordinator decides *what* to ask and
  *whom* (a practice using CAQH organizational access or PECOS surrogacy
  should not be asking the provider at all, Stage 3 §3.0). Once asked, the
  ladder runs without them.

---

## 2. Scenario 1 — CSV-uploaded provider, CAQH attestation stale at day 60

### What the codebase says

**Did the upload carry CAQH data?** It could. `PROVIDER_TEMPLATE_HEADERS`
carries both `caqh_id` and `caqh_last_attested_date`; the helper text calls
them optional; `buildMapped` writes both, nulling them when `is_new_grad` is
true; the parity migration of 2026-09-19 widened `commit_import_run` to accept
them. Whether a given provider *has* a date depends on the operator's file.
Three realistic outcomes at day 60:

| The CSV row had | Day-0 state | Day-60 state |
| --- | --- | --- |
| CAQH ID + attested date ≤ 60 days old at upload | Both checks green | Still green (window is 120 days) — **no request is due yet**; the first honest ask is at ~day 110 |
| CAQH ID + attested date 60–120 days old at upload | Green | `stale_caqh` sometime before day 60 |
| CAQH ID, blank date | `stale_caqh` from day 0 (the gap treats "no date" as stale) | Unchanged — a 60-day-old blank, not a 60-day-old staleness |
| Blank CAQH ID (or `is_new_grad = true`) | `missing_caqh` from day 0 | Unchanged; the MDS makes CAQH ID required, so this is an admission blocker, not a request |

So the honest statement is: "60 days later" is a story about the second and
third rows. The system does not know the difference between "attested long
ago" and "never recorded" beyond the two gap keys, and it should not pretend
to.

**How staleness is detected today.** Nowhere, on a clock. It is computed at
read time by `isCaqhCurrent(attestedDate, today)` (age within 0–120 days,
inclusive) and `deriveProviderGaps` (`dayDiff > CAQH_CURRENT_DAYS`), and
rendered in three places the coordinator already looks: the roster gap pill,
the record's readiness card, and the next-best-action queue, where a readiness
gap is the highest-precedence action on every open case for that provider.
No one is notified; it is visible when someone looks. That is consistent with
Stage 1's decision to drop periodic detection, and this document keeps it.

**Who reaches out today.** The coordinator, from their own inbox or phone.
The provider re-attests *in CAQH ProView* (the attestation itself never
happens in Minted), tells the coordinator, and the coordinator types the date
into the record. Or the coordinator attests on the provider's behalf through
organizational access and the extension stamps the date after the fill.
Nothing in that loop is logged until the date lands.

### The proposed flow

```
Coordinator (record or queue)          Provider (gateway)                 Data
─────────────────────────────          ──────────────────                 ────
Readiness row "CAQH stale"
  → [Ask provider]
      issue/reuse intake link ───────► email: "one thing needed"
      note: "Asked provider to                                           notes (provider)
        re-attest CAQH · Oct 17"                                         audit_log CREATE
                                       tap Continue → code → "Needs you"
                                       "Re-attest your CAQH profile"
                                         steps + "I attested on [date]"
                                       submit ────────────────────────► providers.caqh_last_attested_date
                                                                         notes: "Provider reported
                                                                           CAQH attested Oct 17"
                                                                         audit_log UPDATE
Gap clears at next read (pill, card,
  queue) — nothing else to do
```

1. **Raise.** On the record's readiness card and Identity section, the
   `caqh_current` row (and the roster pill it deep-links to) gains one
   affordance: **Ask provider**. It is the same `AddButton`-class control the
   record already uses; billing never sees it. The queue row keeps its
   existing deep link to the record; it does not get its own button (one
   place to ask, like one place to add).
2. **Issue.** Clicking it calls the Stage 1 link RPC (revoke-then-issue if the
   provider's active link is older than its expiry; reuse it otherwise), sends
   the request email through the Stage 1 mailer, and writes:
   - `audit_log`: `action_type = 'CREATE'`, `entity_type = 'provider'`,
     `entity_id = provider`, `description = 'request.attest_caqh'`,
     `after = { type: "attest_caqh", linkId }` (no values);
   - `notes` (provider): `Asked provider to re-attest CAQH · Oct 17 · by Sowmya S.`
     (the fixed-prefix convention Stage 2 §2.4 already uses for `contacted`).
   Grain rule: CAQH is a provider fact, so the line is a provider note, even
   when the coordinator came from a case's queue row. The queue row shows
   "asked Oct 17" by reading the same event (it already consumes readiness
   inputs per provider).
3. **Answer.** The provider opens the email, verifies with the code, and sees
   one item. The screen states the three steps in ProView in one line each,
   links to proview.caqh.org, and offers a date field defaulting to today
   with "I re-attested on this date". Submit calls the Stage 1 submit RPC
   with `{ type: "attest_caqh", attestedOn }`; the RPC applies the same
   rules as the `/api` route (future date rejected) and writes through the
   same column, plus a provider note `Provider reported CAQH attested Oct 17 (via gateway)`
   and the UPDATE audit row attributed per the intake-link pattern.
4. **Complete.** Nothing is marked. `isCaqhCurrent` is true at the next read,
   so the pill, the readiness row, and the queue action disappear together.
   The note line stays as the record of what happened.
5. **Remind.** If the date is still stale after the request's first threshold
   (§5.4), the Stage 2 ladder sends nudge 1 with the same screen; after three,
   it stops and the provider shows in "Needs a human" (Stage 2 §2.4), where
   the coordinator already looks.

**What the provider's self-report is worth.** A date typed by the provider
has the same evidentiary standing as a date typed by the coordinator after a
phone call: unverified. It clears the readiness check exactly as the manual
field does today. It does **not** stamp `provider_field_verifications` —
that table records what a fill *verified* (`manual | caqh | extension`), and a
self-report verified nothing. The note carries the provenance. If the PM wants
a visible distinction ("reported by provider, not verified"), it is a render
rule on the note, not a column.

**Owner:** provider (per the draft MDS, Tier 1 "CAQH attested within 120 days
(provider)"). **Raised by:** coordinator. **Logged on:** the provider record
(note + audit). **Gateway:** yes, same door, same session.

---

## 3. Scenario 2 — mid re-credentialing, the payer needs a renewed certification

### What the codebase says

A payer's request reaches the coordinator by payer email or portal, and the
coordinator logs it today as a payer-facing touch (`email` or `portal`) on
the case, usually with `next_follow_up_date`. The case's task step for that
submission names the artifact in `requiredArtifacts` ("Board certification"),
and `CaseRequiredDocuments` shows that kind as present / missing / expired
from the vault.

What happens next is **outside the system**: the coordinator emails the
provider from their own inbox; the provider replies with an attachment; the
coordinator uploads it (StepArtifactsPanel "upload a fresh one" → provider
vault, `caseId` set, attached to the step) and then attaches it on the payer
portal by hand (E4.5 F4.5.3's documented interim). The ask and the reply are
not logged; the upload is.

The upload path itself is sound and should not be forked: intent → signed
PUT → finalize, two `/api` routes behind `authenticate()` (JWT + org
membership + writer role), audited at each hop, cross-org 404 before signing.
The one thing it cannot do is accept a caller with no JWT, which a provider
session is.

### The proposed flow

```
Coordinator (case task step)            Provider (gateway)                   Data
────────────────────────────            ──────────────────                   ────
StepArtifactsPanel row "Board cert"
  [Attach existing] [Upload] [Ask provider]
      ↳ step.providerRequest pointer ──► email: "one document needed"       tasks.sop_content (pointer)
        touch: provider_outreach,                                            touches (case)
          task_id, recipient, follow-up                                      audit_log CREATE
                                        Continue → code → "Needs you"
                                        "Upload your renewed board
                                          certification" (kind fixed,
                                          expiration date, file)
                                        upload ──────────────────────────► /api/join/documents/upload-intent
                                                                            PUT (Storage, signed)
                                                                            /api/join/documents/finalize
                                                                              provider_documents v2 (caseId)
                                                                              step.attachments += pointer
                                                                              touches: system_event
                                                                              audit_log (intent, finalize)
Case shows "present"; follow-up date
  still the coordinator's; they attach
  on the payer portal and log the payer
  touch — unchanged
```

1. **Raise.** StepArtifactsPanel already offers two write paths per required
   artifact (attach existing, upload fresh). It gains a third, **Ask
   provider**, for provider-owned kinds only (`uploadableKinds("provider")`).
   It writes:
   - a pointer on the step, in the same jsonb the `attachments` and
     `payerForm` pointers already live in:
     `providerRequest: { kind: "board_cert", artifactName, requestedAt, touchId }`.
     `SOPStep` is additive in `src/types/index.ts`; `projectTaskSteps`
     whitelists keys, so **the extension wire contract does not widen** (the
     payer-PDF precedent). A step carrying the pointer is "requested from the
     provider"; a step without it is an ordinary step.
   - a case touch: `entry_type = 'touchpoint'`, `touch_type = 'provider_outreach'`,
     `task_id` = the task, `recipient_name` = the provider,
     `recipient_contact` = the bound email, `notes = "Requested Board certification (renewal) from provider"`,
     `next_follow_up_date` = today + the request threshold (§5.4), so the
     coordinator's existing follow-up discipline covers it with no new
     reminder concept on the case;
   - `audit_log` CREATE on `entity_type = 'provider'` with
     `after = { type: "upload_document", kind, caseId, taskId, touchId }`.
   Then it issues/reuses the gateway link and sends the email.
2. **Answer.** The provider verifies and sees "Upload your renewed board
   certification · for Shelby Sports Rehab." The kind is fixed by the
   request (no picker); the expiration date is required because `board_cert`
   is not a dated kind only if `documents.ts` says so — the screen reuses
   `expirationDateError` and `checkDocumentFile` unchanged; the file rules
   are the vault's (pdf/png/jpeg, 25 MiB).
3. **Store.** Two new routes, `POST /api/join/documents/upload-intent` and
   `POST /api/join/documents/finalize`, behind a new guard step
   `authenticateProviderSession()` beside `authenticateUser()` in
   [`src/server/guard.ts`](../../src/server/guard.ts). It validates the
   gateway session token through the Stage 1 RPC (one source of truth for
   session validity) and returns a ctx where **org, provider, kind, case and
   task come from the open request, never from the body**. The handlers call
   the same `createUploadIntent` / `finalizeDocument` service functions with
   that ctx; owner type is forced to `provider`, `familyId` is the current
   family of that kind if one exists (a renewal versions the family, which is
   what makes "current" derive correctly), `caseId` is the request's case.
   `uploaded_by` is NULL; the audit rows are attributed to the link issuer
   with "via gateway" in the description. The finalize handler also appends
   the `attachments` pointer to the step (the existing attach-new path) and
   writes the fulfilment touch: `entry_type = 'system_event'`, `task_id`,
   `notes = "Provider uploaded Board certification v2 (expires Mar 1, 2028) via gateway"`.
   No download route is exposed to the session: the provider never reads the
   vault, only writes one version into it.
4. **Complete.** The step's `attachments` now carries a pointer satisfying
   the artifact, so `CaseRequiredDocuments` shows "present" and the panel
   renders the attachment, exactly as if the coordinator had uploaded it. The
   `providerRequest` pointer stays on the step as history; "fulfilled" is
   derived (an attachment for that artifact whose vault row is newer than
   `requestedAt`), never written.
5. **Hand back.** The coordinator's follow-up date is untouched (only
   `clears_follow_up` ends a follow-up, and the provider's answer must not
   decide that). They download the current version through the audited
   `/api/documents/:id/download`, attach it on the payer portal, and log the
   payer touch — the part of the loop that was already in the system stays as
   it was.

**Is the request made in the system or by separate email?** In the system,
which sends the email. The email names the practice, the document kind, and
the one button; it carries no file, no case detail, no payer name unless the
PM wants it (open decision §7.4).

**Gate.** Both routes are resource routes and add assertions to
[`scripts/verify-org-isolation.mjs`](../../scripts/verify-org-isolation.mjs):
a session for provider A cannot mint an intent or finalize for provider B or
for a case in another org (404 before signing, the existing contract); an
expired or `used` session is the uniform invalid response; body-supplied
`ownerId` / `orgId` / `caseId` are ignored, not trusted. Every other rule of
the documents boundary (no-store, never logged, bounded orphan sweep) is
inherited because the service functions are the same.

**Owner:** provider. **Raised by:** coordinator, from the case task step.
**Logged on:** the case (ask touch, fulfilment touch, step pointer) and the
vault (the version). **Gateway:** yes; the upload is the one answer that needs
`/api`, because a signed Storage URL cannot be minted client-side.

---

## 4. Scenario 3 — the general model

### 4.1 Reuse evaluation

| Candidate | Verdict | Why |
| --- | --- | --- |
| `provider_intake_links` + gateway session (Stage 1) | **Reuse as the door, unchanged.** No `purpose` column on the link. | One active link per provider (the E4.4 partial unique) means a link cannot be "the request" when two are open. The link opens a session; the session shows every open request. The email names the purpose; the data does not need to. |
| `touches` for case-scoped requests | **Reuse as the human-readable ask and answer.** | `provider_outreach` already means "we contacted the provider"; `task_id`, recipient capture, and `next_follow_up_date` already carry what a request needs; the carry-forward reducer already gives the coordinator the reminder. One schema change (§6): `touches_source_check` must admit `provider` (and `email`, closing the known wart in CLAUDE.md), so an answer is attributed honestly with `coordinator_id = NULL`. |
| provider `notes` for provider-scoped requests | **Reuse, with the Stage 2 fixed-prefix convention.** | Already live, already the Stage 2 event line, already rendered on the record. `author_id` is nullable, so a provider's answer line is `author_id = NULL` + prefix "Provider …". |
| `audit_log` as the structured ledger | **Reuse — this is what makes derivation robust.** | Prefix-parsing free text would be fragile. `after` jsonb carries `{ type, kind?, caseId?, taskId?, fieldKeys?, touchId?, noteId? }` — identifiers and kinds only, never values. Stage 2 §2.4 already reads this table for `invited` / `nudge_sent`; requests are more rows of the same shape. |
| Stage 2 nudge ladder (§2.2, §2.4) | **Reuse the lib, the scheduler, the quiet rules, the escape hatches, the three-strike stop.** Thresholds per request type are **days**, not hours. | Onboarding is the first request; later requests are the same loop with slower clocks. `dueNudges(rows, now)` takes open requests instead of onboarding rows; the nudge row (`description = 'nudge 2 sent'`, `after.requestType`) is the idempotency key, unchanged. |
| A `provider_requests` table | **No.** | Every field it would hold is either an event (audit/notes/touches) or derivable from the fact. A table would become the second source of truth for "open," and someone would add `status` to it within a month. |
| SOP step jsonb pointer | **Reuse for case-scoped document requests only** (`providerRequest`, §3). | It is where the need is authored (`requiredArtifacts`) and where fulfilment lands (`attachments`). Other request types have a column or a row to point at and need no step pointer. |

### 4.2 Request types

| Type | The fact (completion test) | Grain · activity line | Raised from | Owner | What the provider sees in "Needs you" |
| --- | --- | --- | --- | --- | --- |
| **attest_caqh** | `providers.caqh_last_attested_date` with `isCaqhCurrent(date, today)` true and `date ≥ askedAt` | Provider · note | Readiness card / Identity section `caqh_current` row; roster pill deep-link | Provider | "Re-attest your CAQH profile" — three steps, ProView link, date field |
| **upload_document** (case) | Step `attachments` has a pointer for the artifact whose vault row `created_at ≥ askedAt` | Case · `provider_outreach` touch (ask), `system_event` touch (fulfilment), step pointer | `StepArtifactsPanel` "Ask provider" on a provider-owned kind | Provider | "Upload your renewed {kind label} · for {practice}" — fixed kind, expiration date if dated, file |
| **upload_document** (provider) | The family's current version has `expiration_date > today` (or a version exists for a kind that had none), `created_at ≥ askedAt` | Provider · note | `ExpiringCredentialsTable` row action; readiness `license_current` / `license_present` gap | Provider | Same screen; `caseId` null |
| **confirm_field** | A `provider_field_verifications` row per asked `field_key` with `verified_source = 'provider'`, `verified_at ≥ askedAt`; or, for a blank MDS field, the column now non-null | Provider · note | Identity / Contact section "Ask provider to confirm" on a Tier 1 blank or a `demographics` / `npi` gap; Stage 2's "to admit" checklist | Provider | "Confirm these details" — current value shown (session-verified, so pre-fill is allowed; never SSN, DEA, or portal credentials), Confirm / Correct per field |
| **answer_question** | A `touches` row with `source = 'provider'` and `replies_to_touch_id` = the question touch (case grain), or a provider note with the reply prefix newer than the question note (provider grain) | Case · `provider_outreach` touch with the question and `next_follow_up_date`; or Provider · note | `AddTouchDialog` on a case (type Provider Outreach, "send to provider" toggle); record Activity "Ask provider" | Provider | "A question from {practice}" — the question text, one text area |

Rules that hold across the table:

- **The ask names one owner, and it is always the provider.** Practice-owned
  facts (facility assignment, group W-9/COI) are never provider requests; they
  belong in the owner view's "Needs you" (Stage 2 §2.1). Minted-owned steps
  are never requests at all.
- **A request never changes case status.** Nothing here calls
  `set_case_status`. "Waiting on provider" for a case is derived: ≥1 open
  request on that case. Reports and the queue may render it; nobody stores it.
- **The gateway shows asked items only.** Unasked open gaps do not appear:
  the practice administrator decides what to ask and when (CAQH may be
  handled through organizational access; a document may be on its way by
  other means). This is the human-asks rule from §1.
- **Pre-fill follows the Stage 1 posture.** Values are shown only behind the
  verified session and only for the field being confirmed. The "never ask
  here" list from Stage 1 §5.6 (SSN, portal credentials, DEA number) applies
  to requests exactly as to onboarding; those move through Stage 3's secure
  items screen, which is a request of its own kind and out of scope here.
- **Scope stays inside one org.** A provider with rows in two orgs has two
  gateways (`/join/$org` is org-pinned) and two request lists. Nothing joins
  across orgs.

### 4.3 How completion is derived (not stored)

One pure lib, `src/lib/providerRequests.ts` (a **planned** file named here
for the build; it does not exist yet), beside the existing `providerGaps.ts`
and Stage 2's planned `providerOnboardingStage.ts` (also not built yet), with
`today` passed in:

```
deriveProviderRequests({
  provider, notes, auditEvents,            // provider grain
  cases, touches, tasks,                   // case grain
  documents, fieldVerifications,           // facts
  today,
}) → ProviderRequest[]
```

Each `ProviderRequest` is `{ type, grain, caseId?, taskId?, askedAt, askedBy,
nudges: number, pausedAt?, fulfilledAt: string | null, lapsed: boolean }` where

- `askedAt` / `askedBy` / `type` and the target identifiers come from the
  `audit_log` row (`description` starts with `request.`);
- `fulfilledAt` is the timestamp of the first fact that satisfies the
  completion test in §4.2 **and** is at or after `askedAt`; null otherwise;
- `nudges` counts `nudge_sent` audit rows after `askedAt` for this type;
- `pausedAt` is the Stage 2 escape hatch note (`help_requested`,
  `told_not_needed`) or `contacted`, newer than the last nudge;
- `lapsed` = open and `nudges = 3` and no `pausedAt` — the "Needs a human"
  condition.

Nothing in the lib reads a clock, calls a service, or writes. Tests pin each
type's completion rule with fixtures, the way `followUps.test.ts` pins the
carry-forward reducer. The same derivation feeds four consumers:

| Consumer | What it renders |
| --- | --- |
| Gateway "Needs you" (anon RPC, server-side) | open requests for the session's provider, oldest first |
| Provider record (`RecordSectionCard` "Requests", below Readiness; collapses when empty) | open + last 90 days fulfilled, with the note/touch line and nudge count |
| Case Touches panel | nothing new — the ask and fulfilment touches are ordinary rows; the step shows the pointer |
| Reports | one registry entry under the existing `intake` group in [`src/lib/reports.ts`](../../src/lib/reports.ts): **Provider Requests** — open by type, median business hours ask → fulfilled (≥ 5 fulfilled or "not enough data"), lapsed count linking to "Needs a human". No delivery or open metrics, by construction. |

### 4.4 Reminder thresholds per type (code-owned, business days)

The onboarding ladder runs in hours because a new hire cannot bill. A
re-attestation or a renewal has a payer's clock, measured in days. Same ladder
shape (nudge, +interval, +interval, stop), same quiet rules, slower:

| Type | Nudge 1 after | Nudge 2 | Nudge 3 (final) | Then |
| --- | --- | --- | --- | --- |
| attest_caqh | 3 business days | +3 | +5 | "Needs a human"; provider note; queue row keeps the readiness gap as the action |
| upload_document | 2 | +3 | +5 | Same; the case follow-up date (set at ask) already brought it back to the coordinator |
| confirm_field | 3 | +3 | +5 | Same |
| answer_question | follows the question touch's `next_follow_up_date`; nudges at that date and +3, +5 | | | Same |

One constant block, like `documents.ts` expiry windows; calibrated after the
first cohort. **Never more than one email to a provider per business day
across all open requests**: when several are open, one email lists them all
("Shelby Sports Rehab needs 2 things from you"), and one nudge row per
request is written so idempotency stays per request.

### 4.5 What the provider receives (realistic render, sparse copy)

```
From:     Shelby Sports Rehab via Minted Panel <requests@mintedpanel.com>
Reply-To: (the practice administrator's address)
Subject:  One document needed for your credentialing

Hi Dr. Rao,

Your practice administrator at Shelby Sports Rehab needs your renewed
board certification for a payer re-credentialing.

    [ Continue ]

It takes about two minutes. You'll confirm it's you with a code sent to
this address. We will never ask for your SSN or any password on this page.

Need help, or told you don't need to do this? Reply to this email.
```

Reminder 2 of 3 adds one line above the button: "This is reminder 2 of 3."
There are no tracking pixels, no "we noticed you haven't opened," and no
claim about any integration. The gateway's landing screen repeats the same
"never ask" sentence, which is the anti-phishing cue Stage 1 chose.

The "Needs you" screen, after the code:

```
Shelby Sports Rehab · secure intake by Minted Panel

Needs you (2)

  ▸ Upload your renewed board certification
    Asked Oct 17 · for a payer re-credentialing
  ▸ Re-attest your CAQH profile
    Asked Oct 15

Nothing else is needed right now. You can close this page.
```

---

## 5. Build inventory (planning only — nothing here is started)

| Piece | What gets built | What it copies |
| --- | --- | --- |
| `src/lib/providerRequests.ts` (planned, not yet in the repo) + tests | The derivation in §4.3 and the thresholds in §4.4 | `providerGaps.ts`, `followUps.ts`, and Stage 2's planned `providerOnboardingStage.ts` |
| Gateway "Needs you" screens | Four small screens behind the Stage 1 code step: attest, upload, confirm, answer | The Stage 1 form screen; `ssn-intake.$token.tsx` lockdown chrome |
| Anon RPC `submit_request_response(session, payload)` | One SECURITY DEFINER RPC that validates the session, dispatches on `type`, applies the same rules the authenticated paths apply (future attestation date rejected; field keys restricted to the asked set), writes the fact, the activity line, and the audit row attributed per the intake-link pattern. E0.8-throttled. | `submit_intake` (Stage 1), `submit_ssn_intake` |
| `/api/join/documents/upload-intent`, `/api/join/documents/finalize` + `authenticateProviderSession()` | The signing boundary behind the gateway session; owner/kind/case from the request, not the body | `documentRoutes.ts`, `guard.ts` `authenticateUser()` |
| "Ask provider" affordances | Readiness card `caqh_current` row; `StepArtifactsPanel` third action; `ExpiringCredentialsTable` row action; Identity/Contact section on Tier 1 blanks; `AddTouchDialog` Provider Outreach "send to provider" | `AddButton`, existing section deep-links |
| `RecordSectionCard` "Requests" | Open + recent requests on the provider record | The Stage 2 "Onboarding" card |
| One report entry | Provider Requests under `intake` | `reports.ts` registry |
| Four email templates | One per type, code-owned, reminder line interpolated | Stage 2's three |
| Gate assertions | One block for the two `/api/join/*` routes and the new anon RPC | `verify-org-isolation.mjs` |

Nothing in this inventory touches the extension, `set_case_status`,
`create_case_with_tasks`, the SSN vault, or any locked `/api` contract.

---

## 6. Schema delta (all additive; none is a status column)

| Change | Needed by | Nature |
| --- | --- | --- |
| Widen `touches_source_check` to admit `provider` and `email` | §3 fulfilment touch; §4.2 answer_question; also closes the inbound-email wart CLAUDE.md records | Constraint migration, additive |
| `touches.replies_to_touch_id` nullable self-FK + index | answer_question (case grain) only | Mirrors `corrects_touch_id` exactly; skip if questions are not in v1 (§7.2) |
| Widen `provider_field_verifications.verified_source` CHECK to admit `provider` | confirm_field only | Constraint migration, additive; the table is a repo migration awaiting operator apply — verify the object first (`supabase-migrations` skill) |
| `SOPStep.providerRequest` pointer | upload_document (case) | Types additive in `src/types/index.ts`; jsonb, no DDL; whitelisted out of `projectTaskSteps` |
| `audit_log.description` values `request.<type>`, `nudge n sent` | all | No DDL; a convention, pinned by the lib's tests |

Not changed: `provider_intake_links` (Stage 1's shape stands), `providers`,
`provider_documents`, `notes`, `credential_cases`, `status_configs`.

---

## 7. Open decisions for the PM

1. **Self-reported attestation clears the check.** Confirm that a provider's
   "I attested on …" clears `caqh_current` exactly as the coordinator's typed
   date does today, with provenance in the note and no
   `provider_field_verifications` stamp. Alternative: render it as "reported
   by provider" until a fill verifies it (a render rule, still no column).
2. **Which types ship first.** Recommended v1: attest_caqh and
   upload_document (both grains). confirm_field needs the field-verification
   source widening; answer_question needs the reply self-FK and is the one
   type with free text from the provider. Both can follow.
3. **Asks are human-only.** Confirm no automatic ask, consistent with Stage
   1 dropping periodic detection. The only candidate for an exception is CAQH
   at ~day 110 (10 days before stale); the panel's default is no.
4. **How much the email says.** Practice name + document kind + one button
   (recommended), or also the payer name ("for your Cigna re-credentialing").
   No case id, no file, no coordinator name either way.
5. **One email per business day across requests.** Confirm the batching rule
   in §4.4 (one email lists all open items) over one email per request.
6. **Where a provider-grain ask raised from a case is logged.** Recommended:
   at the grain of the fact (provider note), with the queue row reading the
   same event. Alternative: also a case `provider_outreach` touch, which
   double-logs one event.
7. **Request thresholds.** Confirm the business-day values in §4.4 as
   starting points; they live in one constant block and change in code.
8. **Multi-org providers.** Confirm that a provider rostered in two orgs gets
   two independent request lists (org-pinned gateway), with no cross-org
   view, matching the isolation posture.

---

## 8. Borrowed vs new

| Borrowed from the onboarding stages (unchanged) | New in this document |
| --- | --- |
| `/join/$org`, `provider_intake_links`, the three gateway RPCs, the email code, the session (Stage 1 §1.6) | The "Needs you" screen as the post-code landing for a provider who is not onboarding, and its four item screens |
| Events as `audit_log` + notes/touches; no status columns (Stage 1 §1.4, Stage 2 §2.0) | The `request.<type>` audit convention with a structured `after`, and the completion tests per type (§4.2) |
| The nudge ladder, quiet rules, escape hatches, three-strike stop, hourly scheduler, "Needs a human" (Stage 2 §2.2, §2.4) | Day-scale thresholds per request type, and the one-email-per-day batching across requests (§4.4) |
| Business-hours helper and the metric discipline: medians, "not enough data," nothing from the mailer (Stage 2 §2.4) | The Provider Requests report entry (§4.3) |
| Owner-per-field from the draft MDS; provider-owned facts are nudged, practice-owned go to the owner view (Stage 1 §1.10, Stage 2 §2.1) | The rule that the gateway shows **asked** items only, and that the ask is always a human action (§1, §4.2) |
| The "never ask here" list and the sensitive-items screen (Stage 1 §5.6, Stage 3 §3.2) | Nothing — sensitive requests stay in Stage 3 |
| The anon intake attribution pattern (`submit_ssn_intake`) | The gateway-session guard for the two document signing routes, and the `provider` source on touches (§3, §6) |
| The documents vault, signing boundary, step pointers, `CaseRequiredDocuments` (E4.5, ASD) | The `providerRequest` step pointer and the "Ask provider" affordance beside attach/upload (§3) |

The test of zero-overbuild: remove this document and nothing in Stages 1–3
changes. Add it and every provider-facing moment after onboarding goes
through the door those stages already built.
