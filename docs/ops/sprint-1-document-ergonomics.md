# Sprint 1 — document ergonomics and provider readiness

## Approved scope

The user approved this source-only sprint on 2026-09-25 after inspection of the
supplied Sprint 1 handoff, repository, and current pull requests. Base:
`ab82da23bc0c8158af3865ae78622c0a1d6cea10` (`main`). Staging at
`d80ae67cb25c94e33a984784d66849321aaf31de` had an identical source tree.

Deliver one draft PR targeting `main`, with Luna/xhigh implementation and
independent Astra/high review. Merges, staging deployment, production release,
and hosted data changes require separate approval. Automatic Vercel deployments
are disabled. The attachment's direct staging merge/deployment sequence is not
the approved execution path.

## Requirements and acceptance

| ID       | Required behavior                                                                                                                                                                                                                                                                                              | Verification                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MP-17    | Case Download all saves each available document as `{ProviderName}_{DocumentLabel}.{ext}`. Sanitize filenames; preserve extension; use label plus an ID snippet when provider name is unavailable. Preserve sequential, individually audited downloads and partial-failure reporting.                          | Filename edge cases; executable download behavior; existing authorization/signing regression tests. |
| MP-22    | W-9 upload/replacement has one optional Signed date stored in `effective_date`. New W-9 metadata always has null expiration. Lists/checklists show Signed date or Signed date not set. Existing W-9 expiration values never produce expired/expiring alerts. Other kinds retain their existing date semantics. | Metadata/classification tests, storage finalization tests, upload and list browser coverage.        |
| MP-15    | Upload permits a custom filename, defaults to the selected file, and keeps the real extension when it is omitted or altered. Intent and finalize use the same normalized name. File reselection and replacement must not silently use a stale default.                                                         | Filename edge cases; upload intent/finalize consistency; browser upload coverage.                   |
| MP-35    | Missing voided check does not reduce initial enrollment readiness or appear in its gap filter. All other readiness requirements remain. Voided-check upload and SOP document support remain available. This sprint adds no automatic contracting-stage gate.                                                   | Ready-provider fixture without a voided check; readiness regression and browser tests.              |
| MP-20/34 | Add Provider captures optional gender and persists it. Personal information displays and permits editing it. Form defaults and the import exhaustiveness contract account for gender; CSV gender import remains unsupported. Preserve existing null and legacy values.                                         | Import/form contract tests and provider creation/detail browser coverage.                           |

## Ownership and boundaries

| Owner                    | Write surface                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document implementation  | `src/lib/documents*`, document components and `StepArtifactsPanel.tsx`, document services/hooks/server routes and focused tests, `e2e/document-storage.spec.ts`; only necessary existing router/mock-harness wiring if download behavior requires it. |
| Readiness implementation | `src/lib/enrollmentReadiness*`, `ProviderReadinessSection.tsx`, readiness query projections and `e2e/provider-readiness.spec.ts`.                                                                                                                     |
| Gender implementation    | Provider form state/sections, provider creation/detail routes, import exhaustiveness tests, a shared pure gender vocabulary if needed, and focused provider browser coverage.                                                                         |
| Orchestrator             | This requirements/evidence record, integration checks, commits, and draft PR.                                                                                                                                                                         |

Shared document edits have one owner. No agent merges branches or publishes.
No migrations, grants, credentials, dependencies, protected shell/UI components,
design tokens, or unrelated reporting features are part of this sprint.

## Data trace and invariants

| Data                     | Operation                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_documents`     | Existing scoped reads and immutable-version upload/finalize writes; custom `file_name`; W-9 `effective_date` as signed date and null `expiration_date` on new versions. |
| Private document storage | Existing scoped signed upload/download flows only.                                                                                                                      |
| `providers`              | Existing scoped create/update writes to the already-supported `gender` field.                                                                                           |
| Readiness inputs         | Existing provider, license, group, facility, and contract reads; no new database writes.                                                                                |
| Audit log                | Preserve existing audited upload/download/provider operations; no signed URLs or document bytes in logs.                                                                |

Tenant/owner checks, role enforcement, short-lived signed URLs, no-store
responses, immutable document history, and existing audit behavior must remain.
No historical document rows are rewritten.

## Actual-source adaptations

The handoff assumes a `PROVIDER_FORM_ALIASES` object that no longer exists.
The current `PROVIDER_FORM_TEMPLATE_HEADERS` is an exhaustive form-to-CSV map.
Gender is explicitly accounted for as UI-only with an empty header list.
Accepting new `gender` or `sex` CSV columns would silently discard values:
the current import draft, commit plan, and transactional SQL writer all omit
this field. The existing header rejection stays in place. End-to-end gender
CSV import requires a separate migration and persistence verification; it is
not shipped or advertised by this sprint. This preserves the handoff's
operational acceptance criteria: Add Provider and Personal information.

Bulk filenames use the existing audited signing action and replace only the
Storage URL's `download` query parameter. The installed Storage client applies
that parameter after signing; authorization, token, object path and expiry are
unchanged. No API endpoint or database migration is added.

## Verification record

Baseline verification on the unchanged staging tree (identical to the approved
main base): 194 unit files / 2,423 tests passed; TypeScript, formatting, and epic
hygiene passed; lint passed with 14 existing warnings and zero errors.

The first local browser baseline passed ten cases and exposed a pre-existing
timezone-sensitive assertion in `providers-area.spec.ts` TS-112: the fixture's
midnight UTC timestamp renders July 4 in America/Denver while the assertion
expects July 5. Its failing runner stalled in teardown and was terminated.
A fresh UTC-browser run of TS-112 passed. Sprint browser evidence uses an
explicit UTC timezone and synthetic fixtures; this does not repair or certify
the unrelated date-formatting behavior.

Implementation verification in progress: 195 unit files / 2,433 tests pass.
TypeScript, lint (the same 14 baseline warnings), format, and epic hygiene
pass. Independent review corrections cover exact legacy gender preservation
and collecting distinct browser download events. Build and the combined
automated browser run with synthetic fixtures are pending. Hosted runtime/UAT is outside this
source-only delivery and must not be represented as verified.
