# Repo workflow — write & merge rules

Canonical process for Minted Panel (`mintedpanel`) and the Workbench extension
(`minted-extension`). Coding rules stay in [`AGENTS.md`](../../AGENTS.md);
epic lifecycle detail stays in [`docs/redesign/README.md`](../redesign/README.md).
This file is the short map of **who writes what, how it merges, and what is
manual today**.

---

## Two lanes

| Lane | Who builds | Branch pattern | Merge |
| --- | --- | --- | --- |
| **Epic queue** | Claude Code (builder); Devin reviews | Feature branches targeting `main`; epic docs as `docs/redesign/EX.X-*.md` | Reviewer/PM merges — **never self-merge** |
| **3M / parallel** | Cloud Agent (this engagement) | `cursor/3m-<slice>-6f36` | PM merges draft PRs — **never self-merge** |

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

1. Epic approved = **epic PR already merged to `main`**. There is no `reviewed`
   frontmatter flag (retired 2026-08-07).
2. Build session opens with a ≤60-minute **spike**; enablers go in the PR body.
3. CI: `npm run lint`, `npm run lint:epics`, `npm run test`; e2e when touched
   surfaces have coverage. Migration dry-run job must pass.
4. AGENTS.md layering and additive-migration rules hold.
5. Failures → review comments; remediations on the **same branch**.

### 3M / Cloud Agent PRs

1. One approved slice per turn; draft PR; stop for PM review.
2. Branch name matches `cursor/3m-<slice>-6f36`.
3. CI green on the changed repo(s). Dual-repo slices usually open **two** PRs
   (panel then extension when the API contract moves).
4. Protected files unchanged unless the slice explicitly authorizes them.
5. PM verifies UI/preview where the slice touches journeys; agent runs CI only.

### CI surfaces (panel)

| Workflow | What |
| --- | --- |
| `.github/workflows/ci.yml` | format, typecheck, lint, unit tests, build, migration dry-run |
| `.github/workflows/verify-org-isolation.yml` | org-isolation gate for `/api` |

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

| Step | Why manual |
| --- | --- |
| Apply hosted Supabase migrations (SQL Editor / dashboard) | No automated `dev → staging → prod` pipeline yet |
| Provision vault `app.settings.ssn_vault_key` | E4.4 operator task; fail-closed until set |
| Confirm UAT portals seeded | Empty registry ⇒ extension fill/capture silent no-op |
| Merge PRs / approve epics | Governance: never self-merge |
| Preview / UAT sign-off | AGENTS.md: no self-testing panel journeys in chat |

---

## Epic collision (3M vs epic queue)

If an open epic PR touches the same files as an in-flight 3M slice
(especially `portals.ts`, `extensionRoutes.ts`, `payers.ts`, `payerSetup.ts`,
extension `sidepanel/main.ts`), **pause the 3M slice and ping the PM** before
continuing. Prefer merging the epic first, then rebasing 3M.

---

## Strip / simplify register (process muda)

| Item | Status |
| --- | --- |
| `reviewed: true` gate | **Retired** 2026-08-07 — epic merge to `main` is approval |
| EPIC-TEMPLATE “deliver to `redesign` branch” | **Fixed** (Slice 0) — deliver epic docs to `main` |
| Root `CONTRIBUTING.md` | **Not added** — sole-author context; this file is enough |
| Postman `/api` collection | **Out of scope** for 3M |
| Historical handoff files under `docs/redesign/handoffs/` | Keep as history; banner points here for current rules |

---

## Quick links

| Doc | Role |
| --- | --- |
| [`AGENTS.md`](../../AGENTS.md) | Binding coding rules for agents |
| [`docs/redesign/README.md`](../redesign/README.md) | Epic lifecycle + merge gate |
| [`EPIC-TEMPLATE.md`](../redesign/EPIC-TEMPLATE.md) | New epic skeleton |
| [`3m-uat-readiness-checklist.md`](./3m-uat-readiness-checklist.md) | Hosted / UAT sign-off |
| Extension `CLAUDE.md` | Extension architecture + wire contracts |
