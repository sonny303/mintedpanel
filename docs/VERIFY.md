# VERIFY.md — what to run before you push

One page instead of re-deriving the verification stack every session. Source:
[docs/efficiency-audit-2026-07-16.md](./efficiency-audit-2026-07-16.md)
(sections 2, P1, P2).

## 0. Bootstrap first (fresh session)

```sh
node scripts/bootstrap-session.mjs
```

Idempotent: writes the dummy `.env` Playwright needs (only when absent — a
fresh clone has none, and `npx playwright test` without it silently burns the
full 120s webServer timeout before failing), runs `npm ci` only when
`node_modules` is missing/stale, and fetches `origin/main`. Cloud
(Claude Code on the web) sessions run it automatically via the checked-in
SessionStart hook (`.claude/hooks/session-start.sh`); local sessions run the
one-liner by hand. It never writes real credentials.

The two dummy values it writes (also what CI uses) — the host **must** be
`example.supabase.co`, not any other placeholder:

```
VITE_SUPABASE_URL=https://example.supabase.co
VITE_SUPABASE_ANON_KEY=dummy-anon-key
```

`externalClient.ts` sets no `storageKey`, so supabase-js derives the GoTrue
localStorage key from the URL ref as `sb-<ref>-auth-token`. All 30
authenticated e2e specs seed the session under `sb-example-auth-token`, so a
different host (e.g. `dummy.supabase.co` → `sb-dummy-auth-token`) boots the app
logged-out and every authenticated spec times out.

## 1. Pick your tier from the diff

| Tier                 | Applies to                                                                                                      | Run                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **T0 docs-only**     | `docs/**`, `*.md` only                                                                                          | prettier + lint + tsc + vitest (≈1 min — cheap enough to keep unconditional); **no e2e**                                                        |
| **T1 scoped code**   | components/hooks/services; no schema, no `/api`, no protected files                                             | static stack + vitest + **focused e2e for touched routes only** (look them up in §3 — never the full suite)                                     |
| **T2 cross-cutting** | schema/migrations, `src/server/*`, shared libs (`sopResolver`, `types/index.ts`, `statusLabels`, `tokenFormat`) | T1 + full e2e of dependent surfaces + isolation gate (`node scripts/verify-isolation-local.mjs`) when `/api` is touched + types regen after DDL |

The static stack, always (every tier, every PR):

```sh
npm run lint && npx tsc --noEmit && npm run test && npx prettier --check .
```

## 2. Measured costs (2026-07-16, fresh cloud session, `redesign` head)

| Step                        | Wall time                               |
| --------------------------- | --------------------------------------- |
| `npm ci` (warm cache)       | 13s                                     |
| `npx tsc --noEmit`          | 21s                                     |
| `npm run test` (vitest)     | 11s                                     |
| `npm run lint`              | 7s                                      |
| `npx prettier --check .`    | 12s                                     |
| **Full static stack**       | **≈ 60–90s**                            |
| ONE focused Playwright spec | ≈ 2 min (~90s of it is dev-server boot) |
| Full e2e (40 spec files)    | **43.6 min**                            |

The static gates are not the problem — run them always. The full e2e suite is
a 44:1 ratio against the entire static stack; reserve it for T2 diffs or
background runs, and use the route→spec map below for everything else.

## 3. Route → spec map (focused e2e is a lookup, not a judgment call)

```sh
npx playwright test e2e/<spec>.spec.ts
```

### Public / unauthenticated

| Surface                                  | Spec(s)                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/login`                                 | `login.spec.ts`                                                                                         |
| Landing resolver (first-run / workspace) | `landing-resolver.spec.ts`                                                                              |
| `/capture/$token` (one-time capture)     | `capture-link.spec.ts`; abuse/throttle: `abuse-probe.spec.ts`; upload fence: `sectioned-intake.spec.ts` |
| `/contact` (inbound leads)               | `contact-inbound.spec.ts`; abuse/throttle: `abuse-probe.spec.ts`                                        |
| `/share/$token` (read-only report share) | `report-share.spec.ts`; abuse: `abuse-probe.spec.ts`                                                    |

### Shell & navigation

| Surface                                                                                                                                                                                                               | Spec(s)                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Sidebar IA v2, org switcher, nav counts                                                                                                                                                                               | `sidebar-ia.spec.ts`    |
| Legacy/flat route sweep (`/home`, `/providers`, `/launches`, `/reports`, `/fix-it`, `/client-progress`, `/admin/*`, `/work`, redirects `/portfolio` `/progress` `/admin/sops`, reserved `/soon` `/scope` `/outcomes`) | `legacy-routes.spec.ts` |

### Onboarding & org intake

| Surface                                                    | Spec(s)                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `/onboarding` (create-org page + side panel)               | `onboarding-shell.spec.ts`, `onboarding-regression.spec.ts` |
| `/get-started` (Account Detail, contacts, People Enroll)   | `org-contacts.spec.ts`, `parties-regression.spec.ts`        |
| `/onboarding/wizard` framework (sections, chips, Next CTA) | `onboarding-wizard.spec.ts`                                 |
| Wizard — Provider Group section                            | `provider-group.spec.ts`                                    |
| Wizard — Facilities section                                | `facilities-wizard.spec.ts`                                 |
| Wizard — Provider Roster section (+ roster upload card)    | `provider-roster.spec.ts`, `roster-import.spec.ts`          |
| Wizard — Assignments section                               | `assignments-wizard.spec.ts`                                |
| Wizard — Payer Network section                             | `payer-network.spec.ts`                                     |
| Provider record — Readiness section (relocated 2026-07-21) | `provider-readiness.spec.ts`                                |

### Reporting & portfolio

| Surface                                                        | Spec(s)                               |
| -------------------------------------------------------------- | ------------------------------------- |
| `/reporting`, `/reporting/portfolio`                           | `reporting-center.spec.ts`            |
| `/portfolio` redirect + all-inactive fallback                  | `portfolio-inactive-fallback.spec.ts` |
| `/reporting/expiring-credentials` + document tables (provider, | `document-storage.spec.ts`            |
| group, case verification, signed upload/download)              |                                       |

### Payers & admin

| Surface                                                                                   | Spec(s)                                                                                                                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/payer-directory` (redirects into Payer Setup)                                           | `payer-directory.spec.ts`, `payer-catalog-selection.spec.ts`                                                                     |
| `/admin/payer-admin` (Payer Setup page + module)                                          | `payer-setup-page.spec.ts`, `payer-admin-module.spec.ts`, `payer-setup-module.spec.ts`, `admin-payers.spec.ts`                   |
| `/admin/payers/new` · `/admin/payers/$id/edit`                                            | `payer-form.spec.ts`                                                                                                             |
| `/admin/payer-admin/catalog/$payerId` (payer detail — tabs, in-place edit, archive/merge) | `payer-detail.spec.ts`, `payer-directory.spec.ts`, `payer-catalog-selection.spec.ts`                                             |
| `/admin/templates` (SOP authoring, versioning)                                            | `sop-versioning.spec.ts`, `sop-email-recipients.spec.ts`, `template-portal-integrity.spec.ts`, `template-typing-latency.spec.ts` |

### Generation, cases & work queue

| Surface                                                                  | Spec(s)                           |
| ------------------------------------------------------------------------ | --------------------------------- |
| `/generation` preview + exclusions                                       | `generation-preview.spec.ts`      |
| Generation confirm & create (4-part key, `/work?run=` landing)           | `case-creation.spec.ts`           |
| `/generation/runs`, run detail, case provenance                          | `generation-traceability.spec.ts` |
| SOP stamping + "Using generic SOP" chip (`/cases`, case detail)          | `sop-stamping.spec.ts`            |
| `/work` next-best-action queue                                           | `next-best-action-queue.spec.ts`  |
| `/cases` route render reality-check                                      | `dashboard.spec.ts`               |
| `/cases` views (Flat · By provider · By payer · Matrix), URL back-compat | `cases-pivots.spec.ts`            |

### Import (staged roster)

| Surface                                                          | Spec(s)                    |
| ---------------------------------------------------------------- | -------------------------- |
| `/admin/import` + staged scan pipeline                           | `roster-import.spec.ts`    |
| `/import/$runId` preview / dedupe / conflict review / commit     | `import-preview.spec.ts`   |
| Per-section uploads, combined-template retirement, capture fence | `sectioned-intake.spec.ts` |

### Skipped placeholders (awaiting a seeded tenant — `test.skip` today)

`case-status-update.spec.ts`, `create-case.spec.ts`, `task-complete.spec.ts`,
`touch-log.spec.ts` document write flows awaiting a seeded, disposable test
tenant; they run nothing and never gate a PR.

## 4. Dev-server reuse (skip the ~90s boot)

Start the dev server ONCE in the background and keep it running:

```sh
npm run dev &
```

`playwright.config.ts` has `reuseExistingServer: !process.env.CI`, so every
subsequent `npx playwright test` invocation attaches to the running server
instead of paying the ~90s Vite boot again. One server per session; iterate
focused specs against it.

## 5. Sandbox notes

- **Chromium path:** the repo's Playwright pin is newer than the sandbox
  browsers — the config already launches `/opt/pw-browsers/chromium` when it
  exists. Never run `playwright install`.
- **Known-flaky specs:** `legacy-routes.spec.ts`'s `/soon?title=…` and
  `/scope` reserved-route states pass on retry (`retries: 1`). A red first
  attempt there is not news; a red retry is.
- Cloud sandboxes cannot reach `*.supabase.co` — the e2e suite runs entirely
  on its mock harness (see CLAUDE.md "Running and verifying" for the recipe).
