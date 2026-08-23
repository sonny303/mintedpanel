# Spike — Active Submission Drawer & document bridge (PRD reconciliation)

> **PARTLY SUPERSEDED 2026-08-23.** The product owner withdrew
> proof-of-submission capture: the touchlog plus the case's
> `payer_reference_id` are the record. Every decision here about step-level
> ATTACHMENTS (`SOPStepAttachment`, `StepArtifactsPanel`, the `filled_form`
> catch-all — D-ASD-1/2/4/5/6) is retired and the code is deleted;
> `requiredArtifacts` is an OUTBOUND list only. The document-bridge half
> stands: `CaseRequiredDocuments` is the one drawer surface (D-ASD-7), and
> the `verifyCaseLink` + gate work (D-ASD-9) shipped and holds. Read the
> "Outbound documents only" entry in `CLAUDE.md` before building from this.

**Status:** spike / audit — **no product code in this PR.** Awaiting PM ack of
`D-ASD-1 … D-ASD-10`, then the bites in §Untangled slices build in order.  
**Trigger:** PM PRD _"Frictionless Active Submission Drawer & On-The-Fly
Document Bridge"_ (2026-08-16) landing on top of three open PRs.  
**Lane:** 3M — Mura (two documents surfaces disagreeing) + Muda (a built panel
mounted nowhere) + Muri (a browser-supplied `case_id` with no gate proof).  
**Skill:** `.cursor/skills/minted-3m-audit/` · **Base:** `main` @ `36f0da5`.

Companion: `docs/redesign/E4.5-document-storage.md` (TE-1/TE-3/TE-4, F4.5.3) ·
`docs/redesign/E1.7b-sop-as-data.md` (TE-6 `requiredArtifacts`) · `SCHEMA.md`
(`provider_documents`) · `AGENTS.md` (data + `/api` rules).

---

## Verdict

The PRD's **operator intent is right and is now the design of record**: one
file is just a file, the credentials a task needs sit beside the task, replace
is one gesture, and paperwork never blocks step completion.

The PRD's **implementation sketch is wrong in one load-bearing place** and it
is the same place the open build got wrong: it stores a second copy of the
bytes. `SOPStepAttachment.storagePath` (PRD §2A) plus "auto-promote/update the
provider's document" (PRD §2B/TE-7) describes **two artifacts per file** — a
task-owned object and a vault document — which is exactly what the PM ruled
out on #328 (_"be mindful to not just create additional duplicate documents to
store, that is not needed and is not effective"_). #328 ships the same shape
with a manual checkbox instead of an automatic promote.

Corrected model, one line: **there is exactly one document, it lives in the
provider/group vault, the case points at it, and the step points at it.** The
step drawer is a _reference and replace_ surface, never a parallel store. Ten
`D-ASD` decisions below; the net effect on #328 is a **deletion** plus two
genuinely new behaviors (attach-existing, replace-supersede).

Cadence note: this is the **daily** loop (a specialist works tasks all day),
so it outranks once-per-payer setup work — but it is also the surface that
mutates the credential vault from inside a task, so `D-ASD-9` (isolation gate)
is not optional the way TD-53 assumed.

---

## PR-by-PR verdict

| PR                                                  | Relation to the PRD                     | Verdict                                                                                                          |
| --------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **#328** TS-163 SOP step artifact attach            | This _is_ the PRD's Story 1 + 2 surface | **Right instinct, wrong grain.** Rework per `D-ASD-1/2/3/4/5/7/8/9`. Roughly a net deletion; do not merge as-is. |
| **#327** `/account` settings + `user.*` token split | Unrelated to the PRD                    | **Merge on its own gates.** No overlap with documents/tasks; `user.*` tokens don't feed `requiredArtifacts`.     |
| **#326** return to Templates after create           | Unrelated to the PRD                    | **Merge.** 22-line navigation fix.                                                                               |

---

## What the baseline already gives us (do not rebuild)

Measured in code on `main`, not inferred:

| PRD ask                                          | Already exists                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 120s signed download URL                         | `DOWNLOAD_URL_TTL_SECONDS = 120` (`src/lib/documents.ts:181`), minted by `signDocumentDownload` + audited READ row  |
| `/api/documents/upload-intent` / `finalize`      | `src/server/documentRoutes.ts`, service-role behind `guard.ts`, `no-store`, one audit row per action                |
| Replace = new version of the same family         | `UploadIntentInput.familyId` → `supersedes` head link (`src/services/documentStorage.ts`)                           |
| Green / amber / red credential status            | `classifyExpiration` + `caseDocumentStatus` (`src/lib/documents.ts`)                                                |
| "The documents this task requires", live-derived | **`src/components/documents/CaseRequiredDocuments.tsx`** — built in E4.5 F4.5.3 and **imported by nothing** (muda)  |
| Gmail body → clipboard past a URL bound          | `planGmailHandoff` + `GMAIL_URL_SAFE_MAX = 1900` (`src/lib/gmailCompose.ts`)                                        |
| Step completion not gated on files               | `planStepCompletion` gates on **step order only** — there is no artifact gate to remove (PRD Story 3 already holds) |

Two consequences. First, the PRD's "Active Documents Panel" is ~80% written
and simply unmounted — the fix is to mount and extend it, not to author a
third documents component. Second, `GMAIL_URL_SAFE_MAX` governs the **body**,
not attachments; the PRD conflates the two (PRD §3B). Attachments never went
in the URL and never can.

---

## Decisions (D-ASD) — the design of record

### `D-ASD-1` — the step stores a pointer, never a path

`SOPStep.attachments[]` entries carry `documentId` + display cache only:

```ts
export interface SOPStepAttachment {
  documentId: string; // provider_documents.id — the ONLY identity
  artifactName: string; // the requiredArtifacts entry it satisfies
  fileName: string; // display cache
  uploadedAt: string;
  uploadedBy: string | null;
  kind: DocumentKind;
}
```

**Rejected from the PRD:** `storagePath`, `fileSize`, `mimeType`, and a
separate `id`. `fileSize`/`mimeType` already live on the row. A `storagePath`
in `sop_content` is a second source of truth that goes stale the moment a
replace supersedes the version, and it invites a direct bucket read that skips
the audited 120s signing endpoint — the one contract E4.5 TE-3 exists to hold.
Every download in the drawer resolves `documentId` → `/api/documents/:id/download`.

JSONB-only, no migration: correct, and #328 got this right.

### `D-ASD-2` — attach the existing current version first; upload is the fallback

A `requiredArtifacts` entry that resolves to a canonical kind and already has
a current vault version renders **"Attach current version" — one click, zero
bytes uploaded.** Upload only appears when there is no current version, and an
upload against a resolvable name is written **directly as that canonical
kind**, provider/group-owned, `case_id` set.

This deletes the PRD's whole TE-7 auto-promotion mechanism: nothing needs
promoting because nothing was ever mis-filed. It also deletes #328's promote
checkbox, `promoteOwner`, and the second upload. The PRD's own §4 Story 1
("1-click access to files that already exist") is unreachable without this —
#328 can only ever offer an upload.

### `D-ASD-3` — replace supersedes inside the same family

The `[ ↻ ]` gesture calls the existing replace flow with the row's `familyId`.
The new version becomes current for the vault, the drawer, Required documents
and readiness simultaneously, because they all read the same family. Never
mint a second family for the same `(owner, kind)`.

Guardrail: replace is only offered on a row whose current document the org
owns; a step never replaces a document it merely references from another case
context (the `case_id` on the _new version_ is this case — usage context, per
E4.5 TE-1).

### `D-ASD-4` — `filled_form` is the catch-all, and it is **visible** in the vault

Per the PM's Q2 ruling, one `doc_type` may mean both the extension's filled
output and operator proof. An artifact name that resolves to no canonical kind
("Portal confirmation screenshot") stores as `filled_form`, provider/group-owned,
`case_id` set — and **appears in the vault list like everything else**.

Deleted from #328: the `caseArtifact` meta flag, the `DocumentsPanel` filter,
and the "case-scoped grain that must never appear in the vault" reading. A
client-side filter was never an invariant — exports, reporting and the
extension would each have had to repeat it.

Guardrail replacing it: keep the vault's manual upload picker unchanged by
listing picker kinds explicitly rather than by re-purposing `uploadable`.
`uploadable` means _the server accepts it_; the picker is a UI list. #328
overloaded `uploadable: false` and then branched around it in
`validateOwnerKindFile`, which is how a validator stops being readable.

Also: exclude `filled_form` **and** `other` from resolvable-kind detection.
That resolution now decides canonical-vs-catch-all, so "Filled Form" or
"Other" resolving to a real kind is no longer cosmetic (review item 6).

### `D-ASD-5` — the artifact ↔ attachment join must not hide a file

#328's `stepArtifactRows` builds a `Map` keyed by `artifactName` (last write
wins) while `planAttachStepArtifact` appends — so a second attachment under
one name hides the first, and duplicate `requiredArtifacts` entries collide on
the React key. Fix: a row carries `attachments: SOPStepAttachment[]` (newest
first), keys are `documentId`, and normalized-duplicate artifact names are
de-duped where the template is saved. Orphans (a restamp renamed the
checklist) still render under a neutral heading — that part of #328 stands.

### `D-ASD-6` — attachments never gate anything

`planStepCompletion` keeps gating on step order only. No artifact gate, no
task-status effect, no case-status effect. Readiness and Required documents
read `provider_documents` — never `sop_content` — so the vault stays the
single source of truth for "do we have this credential" (PRD Story 3, PM Q1).

### `D-ASD-7` — one drawer surface: mount `CaseRequiredDocuments`, don't add a third

The PRD's sticky **Active Documents** panel is the existing
`CaseRequiredDocuments` (live-derived status + audited one-click download),
mounted in `TaskDrawer` as the right rail and extended with `[ ↻ ]` replace
and the open task's non-resolvable artifact rows. The per-step checklist keeps
only what is genuinely per-step: which artifacts this step needs and what is
attached to it.

This is what structurally kills the mura the #328 review named — "State
License ✓ present" beside "State License — Missing [choose file]" on one case
becomes impossible, because both readings come from one panel over one family.

### `D-ASD-8` — bulk download is anchor clicks, not `window.open` in a loop

#328's `downloadAll` awaits inside a loop, so only the first `window.open`
sits inside the user gesture and Chrome blocks the rest; the e2e passes only
because the harness permits popups. Use sequential hidden-anchor `download`
clicks from the single gesture, one signed URL each, per-file failure toast,
and an `aria-live="polite"` count. The email bar reads **"Download N
attachments for email"** next to **"Open in Gmail"**, with the PRD's advisory
copy verbatim: _"Attachments downloaded to your device — drag them into Gmail
after compose opens."_ Leave the body→clipboard fallback alone.

### `D-ASD-9` — the isolation gate is in scope, TD-53 does not stand

`upload-intent` and `finalize` now accept a browser-supplied `caseId` — a
cross-tenant dimension — and the PRD multiplies the number of upload paths
that pass one. `AGENTS.md` calls a red isolation gate stop-ship. Cross-org
rejection being unit-proven is not the same claim as gate-proven
(TD-51's lesson, verbatim). So: add `upload-intent` / `finalize` assertions to
`scripts/verify-org-isolation.mjs` plus `scripts/mock-api-server.mjs`
coverage, in the bite that ships the write path. The PM's "nothing missing
should be a blocker" answer was about readiness gaps blocking operators; it is
not a ruling about tenant isolation and is not read as one here.

PHI: file names can carry patient/provider identifiers — never logged, and
signed-URL responses stay `no-store`. Capture shape only.

### `D-ASD-10` — the one unavoidable friction: expiry on the three dated kinds

`state_license`, `dea` and `coi` have `expirationRequired: true`, mirrored by
a DB CHECK. A truly zero-field upload of a State License is therefore
**impossible**, not merely undesirable, and silently filing it as
`filled_form` to dodge the field would mis-file a credential and break
expiring-soon reporting.

Ruling: one **inline** date field in the row (not a modal, not a dialog),
`:user-invalid` styled per the PRD's form-state guidance, shown only for those
three kinds and only on upload/replace — never on attach-existing, which is
where the daily path actually lives. Everything else uploads with zero fields.

---

## Residual register (3M, current)

| ID              | 3M   | Cadence | Area          | Finding                                                                                | Evidence                                                     | Sev | Effort | Rec     |
| --------------- | ---- | ------- | ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --- | ------ | ------- |
| **ASD-DUP**     | Muda | daily   | panel/storage | Promote writes a second family + second copy of the same bytes                         | `StepArtifactsPanel.tsx` `submit()` second `uploadM` call    | S1  | S      | delete  |
| **ASD-NOEXIST** | Mura | daily   | panel         | No way to attach a credential that already exists — upload is the only path            | same file, `MissingArtifactRow`                              | S1  | M      | fix     |
| **ASD-ORPHAN**  | Muda | daily   | panel         | `CaseRequiredDocuments` built, imported nowhere                                        | zero importers repo-wide                                     | S1  | S      | fix     |
| **ASD-HIDE**    | Muri | daily   | panel         | "Never in the vault" enforced by one client filter                                     | `DocumentsPanel.tsx` `caseArtifact` filter                   | S2  | XS     | delete  |
| **ASD-JOIN**    | Muri | daily   | panel         | Name-keyed `Map` + appending planner hides the earlier attachment; duplicate React key | `documents.ts` `stepArtifactRows` vs `sopStepAttachments.ts` | S1  | XS     | fix     |
| **ASD-POPUP**   | Muri | daily   | panel         | `downloadAll` popup-blocked outside the e2e harness                                    | `StepArtifactsPanel.tsx` `downloadAll`                       | S1  | XS     | fix     |
| **ASD-GATE**    | Muri | daily   | panel/api     | `caseId` accepted from the browser with no isolation-gate assertion (TD-53)            | `scripts/verify-org-isolation.mjs`                           | S0  | S      | fix     |
| **ASD-COPY**    | Mura | daily   | panel         | Attach-succeeded-but-promote-failed reports "Couldn't attach this file"                | `submit()` `catch`                                           | S2  | XS     | fix     |
| **ASD-DOC**     | Mura | rare    | docs          | `SCHEMA.md` `provider_documents` prose still calls `filled_form` legacy-only           | `SCHEMA.md`                                                  | S3  | XS     | fix     |
| **ASD-RACE**    | Muri | daily   | panel         | `sop_content` read-modify-write races two coordinators (TD-52)                         | `services/tasks.ts`                                          | S2  | M      | monitor |

---

## Untangled slices

### `BITE-ASD-01` — Re-grain the write path (net deletion)

- **3M:** Muda · **Cadence:** daily · **Repos:** panel · **Depends on:** none
- **Problem:** the step upload writes a case-scoped `filled_form` plus an
  optional duplicate canonical copy.
- **Change:** delete `caseArtifact` from `DocumentKindMeta`, the
  `DocumentsPanel` filter, `promoteOwner`, the promote checkbox and its
  expiration input; a resolvable artifact name uploads **as that kind**, a
  non-resolvable one as `filled_form`; both provider/group-owned with
  `case_id`; explicit picker-kind list replaces the `uploadable` overload;
  exclude `filled_form` + `other` from resolvable-kind detection.
- **AC:** one `provider_documents` row per attached file · a step-attached
  State License appears in the provider vault and in Required documents with
  no extra action · no kind is hidden by a client filter · `filled_form` still
  absent from the vault upload picker.
- **Out:** attach-existing, replace, drawer layout.

### `BITE-ASD-02` — Attach existing + replace-supersede

- **3M:** Mura · **Cadence:** daily · **Depends on:** `BITE-ASD-01`
- **Change:** resolvable row with a current version → "Attach current version"
  (pointer write only, no upload); `[ ↻ ]` replace passes `familyId` through
  the existing replace flow; inline expiry field for the three dated kinds
  (`D-ASD-10`); fix the `stepArtifactRows` join + React keys (`D-ASD-5`);
  correct the partial-failure toast copy.
- **AC:** attaching an existing credential uploads zero bytes and creates no
  new row · replace produces version N+1 in the same family, current
  everywhere · a second attachment under one artifact name never hides the
  first · step completion still needs no attachment.
- **Out:** drawer layout, bulk download.

### `BITE-ASD-03` — Active Documents rail + bulk download

- **3M:** Muda · **Cadence:** daily · **Depends on:** `BITE-ASD-02`
- **Change:** mount `CaseRequiredDocuments` in `TaskDrawer` as the sticky rail
  (`@container`, side-by-side → stacked, no layout shift), add `[ ↻ ]` and
  non-resolvable artifact rows; replace `downloadAll`'s `window.open` loop
  with anchor `download` clicks; email bar "Download N attachments for email"
  - the PRD advisory copy; `aria-live="polite"` announcements; keyboard path
    Tab/Enter/Space; HTML5 drag-and-drop onto a row; `DESIGN-DEBT.md` entry for
    the unspecced rail.
- **AC:** opening any case task shows required credentials with live
  green/amber/red · bulk download yields N files with no popup block · every
  row is reachable and operable by keyboard · no page layout shift at the
  drawer's narrow breakpoint.

### `BITE-ASD-04` — Close the isolation gate (`D-ASD-9`)

- **3M:** Muri · **Cadence:** daily · **Repos:** panel
- **Change:** `upload-intent` / `finalize` assertions in
  `scripts/verify-org-isolation.mjs` (cross-org `caseId`, cross-org `ownerId`,
  cross-org `familyId`) + `scripts/mock-api-server.mjs` coverage; close TD-53.
- **AC:** gate green and red-on-regression (flip one assertion locally to
  prove it fails) · TD-53 closed with the assertion names cited.
- **Note:** ships with 01–03, not after them.

### `BITE-ASD-05` — Docs truth

- **3M:** Mura · **Cadence:** rare
- **Change:** `SCHEMA.md` `provider_documents` prose (`filled_form` is the
  live catch-all, `case_id` is usage context, one family per credential);
  `CLAUDE.md` step-attachment paragraph; `TECH-DEBT.md` TD-52 restated,
  TD-53 closed; `table-register.md` row.

---

## Lanes

| Code (agentable)                  | Ops (human)                  | Backlog          |
| --------------------------------- | ---------------------------- | ---------------- |
| BITE-ASD-01 … 05 (all panel-only) | none — no migration required | TD-52 (ASD-RACE) |

No migration, no hosted apply, no `types.ts` regen: every column this needs
(`case_id`, the provider-OR-group-OR-case owner CHECK, `family_id`,
`supersedes`) already shipped in E4.5.

---

## Keep / Improve / Kill

- **Keep:** JSONB-only step link · pointer + display cache · `verifyCaseLink`
  at intent as well as finalize (a real E4.5 hole #328 closed correctly) ·
  detach unlinks and never deletes · orphan rows rendered, never dropped.
- **Improve:** the join (`D-ASD-5`) · bulk download (`D-ASD-8`) · partial-
  failure copy · `SCHEMA.md`.
- **Kill:** `caseArtifact` · the promote checkbox and second upload · the
  `DocumentsPanel` filter · `storagePath` in `sop_content` (PRD §2A) · the
  auto-promotion mechanism (PRD §2B) — unnecessary once uploads file
  themselves correctly the first time.

---

## PM decisions needed

1. **Ack `D-ASD-1 … D-ASD-10`** as the design of record, superseding the PRD's
   §2A schema and §2B auto-promotion sketch (same operator outcome, one
   document instead of two).
2. **`D-ASD-9`** — confirm the isolation-gate assertions ship with the write
   path (this spike's ruling) rather than staying deferred as TD-53.
3. **`D-ASD-10`** — confirm one inline expiry field for `state_license` /
   `dea` / `coi` on upload/replace only. The alternative is mis-filed
   credentials and broken expiring-soon reporting; there is no zero-field
   option, the DB CHECK forbids it.
