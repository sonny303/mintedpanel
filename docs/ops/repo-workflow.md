# Repo workflow — write & merge rules

Canonical process for Minted Panel (`mintedpanel`) and the Workbench extension
(`minted-extension`). Coding rules stay in [`AGENTS.md`](../../AGENTS.md);
epic lifecycle detail stays in [`docs/redesign/README.md`](../redesign/README.md).
This file is the short map of **who writes what, how it merges, and what is
manual today**.

---

## Promotion flow — feature → staging → main

Long-lived branches:

| Branch    | Role                                                                 |
| --------- | -------------------------------------------------------------------- |
| `main`    | Production. Vercel production + hosted prod Supabase.                |
| `staging` | Integration / pre-prod. Created from `main` (same SHA at bootstrap). |

**Do not revive the retired `redesign` branch** as a merge target. It remains
on the remote as history only (retired 2026-07-21, #232).

### Path for every change

```
feature branch  →  PR into staging  →  (CI + review)  →  merge to staging
                                                              ↓
                         promotion PR: staging → main  →  (CI + review)  →  merge to main
```

1. **Branch off `staging`** (or rebase onto current `origin/staging` before
   opening the PR). Name patterns stay lane-specific (see Two lanes below).
2. **Open a PR targeting `staging`.** Reviewer/PM merges — **never self-merge**.
3. **Verify on staging** (preview / UAT) before promoting.
4. **Promote with a PR from `staging` into `main`.** Same gates; PM merges.
   Prefer a clean fast-forward or a squash/merge PR titled
   `promote: staging → main (<date or slice>)` — do not force-push either
   long-lived branch.
5. Hotfixes that must land on prod the same day still go **feature → staging →
   main** (short-circuiting staging is not allowed). Cherry-pick into staging
   first if the fix was started from an older `main` tip.

### Branch protection (mirror rule)

`staging` must carry the **same** GitHub branch-protection / ruleset settings
as `main`. When protection on `main` changes, update `staging` in the same
ops change.

Bootstrap check (2026-08-30): both `main` and `staging` report
`protected: false`, and the repo has **no** rulesets. The cloud-agent token
cannot read or write the Branch protection API (`403 Resource not accessible
by integration`). If an admin later enables protection on `main`, mirror it
onto `staging` immediately (Settings → Branches, or
`PUT /repos/{owner}/{repo}/branches/{branch}/protection`).

### What stays out of this flow

- Hosted Supabase migrations still apply manually (see Human-only ops). A
  separate staging Supabase project / Vercel staging project is post-redesign
  platform work — this section is the **Git** promotion path only.
- The Chrome extension repo follows the same feature → staging → main shape
  when its `staging` branch exists; keep panel-first for `/api` contracts.

---

## Two lanes

| Lane              | Who builds                           | Branch pattern                                                            | Merge                                               |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------- |
| **Epic queue**    | Claude Code (builder); Devin reviews | Feature branches targeting `staging`; epic docs as `docs/redesign/EX.X-*.md` | Reviewer/PM merges to `staging` — **never self-merge** |
| **3M / parallel** | Cloud Agent (this engagement)        | `cursor/3m-<slice>-6f36` (PR → `staging`)                                 | PM merges draft PRs to `staging` — **never self-merge** |

Epic lane owns roadmap features (e.g. E6.9 Form Setup). The 3M lane owns
reliability, muda deletion, and approved simplification slices — it must not
finish epic scope without an explicit carve-out.

After merge to `staging`, promotion to `main` is a separate PM-owned PR (see
Promotion flow above).

Cross-repo rule: **panel-first** for `/api` contract changes; mirror types in
the extension in a coordinated follow-up (extension `CLAUDE.md` wire contracts).

---

## Writing rules (both lanes)

1. Follow [`AGENTS.md`](../../AGENTS.md) — hooks → services → Supabase; additive
   migrations only; protected files; no `any`; named exports; no placeholder UI.
2. Epics: author from [`EPIC-TEMPLATE.md`](../redesign/EPIC-TEMPLATE.md); claim
   scenario ids with `node scripts/check-epic-hygiene.mjs --next`; update
   [`table-register.md`](../data-model/table-register.md) when migrations add
   tables/columns.
3. Product blockers go in [`CLARIFICATIONS_NEEDED.md`](../../CLARIFICATIONS_NEEDED.md)
   — do not invent a PM decision in a PR.
4. New engineering/design debt: record in `TECH-DEBT.md` / `DESIGN-DEBT.md` in
   the same PR that incurs it (registers are triaged by the PM; not a merge block).

---

## Merge gates

### Epic build PRs

Full checklist: [`docs/redesign/README.md`](../redesign/README.md) § Build & merge gate.

Summary:

1. Epic approved = **epic PR already merged to `staging`** (then promoted to
   `main` via the promotion PR). There is no `reviewed` frontmatter flag
   (retired 2026-08-07).
2. Build session opens with a ≤60-minute **spike**; enablers go in the PR body.
3. CI: `npm run lint`, `npm run lint:epics`, `npm run test`; e2e when touched
   surfaces have coverage. Migration dry-run job must pass. Same CI must be
   green on the `staging` → `main` promotion PR.
4. AGENTS.md layering and additive-migration rules hold.
5. Failures → review comments; remediations on the **same branch**.

### 3M / Cloud Agent PRs

1. One approved slice per turn; draft PR **into `staging`**; stop for PM review.
2. Branch name matches `cursor/3m-<slice>-6f36`.
3. CI green on the changed repo(s). Dual-repo slices usually open **two** PRs
   (panel then extension when the API contract moves).
4. Protected files unchanged unless the slice explicitly authorizes them.
5. PM verifies UI/preview where the slice touches journeys; agent runs CI only.
6. After merge to `staging`, wait for the next promotion PR into `main` (do not
   open a second feature PR that targets `main` directly).

### CI surfaces (panel)

| Workflow                                     | What                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| `.github/workflows/ci.yml`                   | format, typecheck, lint, unit tests, build, migration dry-run |
| `.github/workflows/verify-org-isolation.yml` | org-isolation gate for `/api`                                 |

Extension: `.github/workflows/ci.yml` — typecheck, lint, vitest.

---

## Protected surfaces

Do not edit without explicit instruction:

- Existing files under `supabase/migrations/` (add new only)
- `src/lib/sopResolver.ts`
- `src/components/layout/*`, `src/components/ui/*`, design tokens
- `src/types/index.ts` (additive only)

Extension: never hold the service-role key; never query Supabase tables from
the extension (JWT + panel `/api` only).

---

## Human-only ops (manual today)

These are not agent-verifiable. Checklist:
[`3m-uat-readiness-checklist.md`](./3m-uat-readiness-checklist.md).

| Step                                                      | Why manual                                           |
| --------------------------------------------------------- | ---------------------------------------------------- |
| Apply hosted Supabase migrations (SQL Editor / dashboard) | No automated `dev → staging → prod` pipeline yet     |
| Provision Vault secret `ssn_vault_key`                    | E4.4; hosted rejects ALTER DATABASE GUC; fail-closed |
| Confirm UAT portals seeded                                | Empty registry ⇒ extension fill/capture silent no-op |
| Merge PRs / approve epics                                 | Governance: never self-merge                         |
| Promote `staging` → `main`                                | Explicit promotion PR; never force-push long-lived branches |
| Mirror branch protection `main` ↔ `staging`               | Admin token required; agent gets 403 on protection API |
| Preview / UAT sign-off                                    | AGENTS.md: no self-testing panel journeys in chat    |

---

## Epic collision (3M vs epic queue)

If an open epic PR touches the same files as an in-flight 3M slice
(especially `portals.ts`, `extensionRoutes.ts`, `payers.ts`, `payerSetup.ts`,
extension `sidepanel/main.ts`), **pause the 3M slice and ping the PM** before
continuing. Prefer merging the epic first, then rebasing 3M.

---

## Strip / simplify register (process muda)

| Item                                                     | Status                                                    |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `reviewed: true` gate                                    | **Retired** 2026-08-07 — epic merge (now via `staging`) is approval |
| EPIC-TEMPLATE “deliver to `redesign` branch”             | **Fixed** (Slice 0) — do not target `redesign`; use `staging` → `main` |
| Direct-to-`main` feature PRs                             | **Superseded** 2026-08-30 — feature → `staging` → `main`           |
| Root `CONTRIBUTING.md`                                   | **Not added** — sole-author context; this file is enough           |
| Postman `/api` collection                                | **Out of scope** for 3M                                            |
| Historical handoff files under `docs/redesign/handoffs/` | Keep as history; banner points here for current rules              |

---

## Quick links

| Doc                                                                | Role                                                |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| [`AGENTS.md`](../../AGENTS.md)                                     | Binding coding rules for agents                     |
| [`docs/redesign/README.md`](../redesign/README.md)                 | Epic lifecycle + merge gate                         |
| [`EPIC-TEMPLATE.md`](../redesign/EPIC-TEMPLATE.md)                 | New epic skeleton                                   |
| [`3m-uat-readiness-checklist.md`](./3m-uat-readiness-checklist.md) | Hosted / UAT sign-off                               |
| [`3m-slice-4-sowmya-audit.md`](./3m-slice-4-sowmya-audit.md)       | Slice 4 — F1/F9/F22/F23–F26 + debt reconciliation   |
| [`3m-slice-5-closeout.md`](./3m-slice-5-closeout.md)               | Slice 5 — closed items + TD-49/TD-50 backlog        |
| [`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md) | Platform vs org adoption (Slice 6 locked decisions) |
| Extension `CLAUDE.md`                                              | Extension architecture + wire contracts             |
