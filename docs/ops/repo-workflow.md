# Repo workflow — write & merge rules

Canonical process for Minted Panel (`mintedpanel`) and the Workbench extension
(`minted-extension`). Coding rules stay in [`AGENTS.md`](../../AGENTS.md);
epic lifecycle detail stays in [`docs/redesign/README.md`](../redesign/README.md).
This file is the short map of **who writes what, how it merges, and what is
manual today**.

---

## Promotion flow (`feature` → `staging` → `main`)

Long-lived branches:

| Branch     | Role                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staging`  | Integration / UAT. Feature and epic-build PRs target this branch. Same SHA as `main` (`dffc60a`, 2026-08-30); this session found the ref already present and did not move it. |
| `main`     | Production. Vercel production alias (`mintedpanel.vercel.app`). Receives **promotion PRs from `staging`** only, plus the hotfix path below.                                   |
| `redesign` | **Retired** 2026-07-21 (#232). Historical redesign-era integration branch. Do not target it, do not resurrect it, do not confuse it with `staging`.                           |

`staging` is a **git promotion lane**, not a hosted staging environment. A
separate Supabase project + Vercel staging alias is still the post-redesign
platform item in [`ROADMAP-STATUS.md`](../redesign/ROADMAP-STATUS.md). Until
that exists, UAT is the Vercel preview of `staging`.

### Feature work

1. Branch off current `origin/staging` (rebase onto it if the branch started elsewhere).
2. Open a PR **targeting `staging`**. CI must be green. Reviewer/PM merges —
   **never self-merge**.
3. UAT on the `staging` deploy (preview URL until a dedicated alias exists).
4. Open a **promotion PR** `staging` → `main`. Same review rule: human merges,
   never self-merge. Production is the merge to `main`.

Do not open ordinary feature PRs against `main`. Do not merge `main` back into
`staging` as a substitute for promoting the other way — if `main` has a hotfix
the lanes have not absorbed, merge that hotfix into `staging` first (see
below), then continue promoting `staging` → `main`.

### Hotfix (production-critical only)

1. Branch off `main`.
2. Open a PR targeting `main`. Reviewer/PM merges.
3. Immediately merge or cherry-pick the same commit(s) onto `staging` so the
   lanes do not diverge. A hotfix that never lands on `staging` will be
   reverted the next time `staging` promotes.

### Branch protection

Checked 2026-08-30 via the GitHub branches API:

| Branch    | `protected` | Rulesets on the repo |
| --------- | ----------- | -------------------- |
| `main`    | `false`     | none                 |
| `staging` | `false`     | none                 |

There is **nothing to mirror** today: `main` has no protection rules, and this
session cannot create them (GitHub returns 403; the integration lacks
`administration`). When a maintainer enables protection on `main`, apply the
**same** rules to `staging` in the same change. Intended floor (from the
2026-07-07 go-live note, still outstanding):

- require a pull request (no direct pushes)
- require green CI (`CI / build`, `CI / migrations`)
- block force-push and deletion
- do not grant admins a bypass

Until that lands, both branches are unprotected. Treat the promotion flow as
process, not an enforced GitHub rule.

---

## Two lanes

| Lane              | Who builds                           | Branch pattern                                                               | Merge                                      |
| ----------------- | ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------ |
| **Epic queue**    | Claude Code (builder); Devin reviews | Feature branches targeting `staging`; epic docs as `docs/redesign/EX.X-*.md` | Reviewer/PM merges — **never self-merge**  |
| **3M / parallel** | Cloud Agent (this engagement)        | `cursor/3m-<slice>-6f36` (PR targets `staging`)                              | PM merges draft PRs — **never self-merge** |

Epic lane owns roadmap features (e.g. E6.9 Form Setup). The 3M lane owns
reliability, muda deletion, and approved simplification slices — it must not
finish epic scope without an explicit carve-out.

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

1. Epic approved = **epic PR already merged to `staging`**. There is no `reviewed`
   frontmatter flag (retired 2026-08-07).
2. Build session opens with a ≤60-minute **spike**; enablers go in the PR body.
3. CI: `npm run lint`, `npm run lint:epics`, `npm run test`; e2e when touched
   surfaces have coverage. Migration dry-run job must pass. Build PRs target
   `staging`; promotion to production is a later `staging` → `main` PR.
4. AGENTS.md layering and additive-migration rules hold.
5. Failures → review comments; remediations on the **same branch**.

### 3M / Cloud Agent PRs

1. One approved slice per turn; draft PR targeting `staging`; stop for PM review.
2. Branch name matches `cursor/3m-<slice>-6f36`.
3. CI green on the changed repo(s). Dual-repo slices usually open **two** PRs
   (panel then extension when the API contract moves).
4. Protected files unchanged unless the slice explicitly authorizes them.
5. PM verifies UI/preview where the slice touches journeys; agent runs CI only.

### CI surfaces (panel)

| Workflow                                     | What                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/ci.yml`                   | format, typecheck, lint, unit tests, build, migration dry-run. Runs on every PR and on push to `main` **and** `staging`. |
| `.github/workflows/verify-org-isolation.yml` | org-isolation gate for `/api`                                                                                            |

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

| Step                                                       | Why manual                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Apply hosted Supabase migrations (SQL Editor / dashboard)  | No automated `dev → staging → prod` _environment_ pipeline yet (distinct from the git `staging` lane above) |
| Enable identical branch protection on `main` and `staging` | Both report `protected: false`; agents cannot set rules (403)                                               |
| Provision Vault secret `ssn_vault_key`                     | E4.4; hosted rejects ALTER DATABASE GUC; fail-closed                                                        |
| Confirm UAT portals seeded                                 | Empty registry ⇒ extension fill/capture silent no-op                                                        |
| Merge PRs / approve epics / promote `staging` → `main`     | Governance: never self-merge                                                                                |
| Preview / UAT sign-off                                     | AGENTS.md: no self-testing panel journeys in chat                                                           |

---

## Epic collision (3M vs epic queue)

If an open epic PR touches the same files as an in-flight 3M slice
(especially `portals.ts`, `extensionRoutes.ts`, `payers.ts`, `payerSetup.ts`,
extension `sidepanel/main.ts`), **pause the 3M slice and ping the PM** before
continuing. Prefer merging the epic first, then rebasing 3M.

---

## Strip / simplify register (process muda)

| Item                                                     | Status                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `reviewed: true` gate                                    | **Retired** 2026-08-07 — epic merge to `main` is approval   |
| EPIC-TEMPLATE “deliver to `redesign` branch”             | **Fixed** (Slice 0) — now `staging`, then promote to `main` |
| Root `CONTRIBUTING.md`                                   | **Not added** — sole-author context; this file is enough    |
| Postman `/api` collection                                | **Out of scope** for 3M                                     |
| Historical handoff files under `docs/redesign/handoffs/` | Keep as history; banner points here for current rules       |

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
