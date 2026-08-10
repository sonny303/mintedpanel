# Architecture truth (binding)

Read these before contradicting them. Prefer live code over stale docs; prefer these over chat memory.

## Two doors (non-negotiable)

| Surface                          | Path                                                                                  | Forbidden                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Webapp** (mintedpanel)         | React → hooks → services → Supabase JS → **RLS**                                      | Calling Workbench `/api` for panel data                         |
| **Extension** (minted-extension) | Chrome → JWT (`Authorization: Bearer`) → Workbench `/api/*` → service-role → Postgres | Direct Supabase from content/sidepanel; inventing `/api/payers` |

Workbench `/api` is for the **browser extension only**. Panel does not need Postman against it for product QA.

## Org model (post–Slice 6 + corrected payer-setup)

- JWT / session carries **org membership** (`memberships`).
- **Active org** in panel: Zustand auth-store `activeOrgId`.
- Org ↔ payer adoption stays on **`org_payer_assignments`** (do not delete this layer unless PM reopens). Group↔payer ops live on **`payer_network_targets` / contracts / cases** — different layer; neither replaces the other.
- **`create_payer`:** live hosted signature is the **10-arg** form (#274). Creating a payer still upserts the caller org’s assignment in-RPC; the Slice 6 `p_assign_to_org` flag was **superseded** (do not reintroduce).
- SOP library read-back: prefer migration `20260809120100` (global SOPs readable without assignment) — confirm hosted apply before trusting authoring of unadopted payers.
- Authoring payer universe ≠ ops/filter universe — use `useAuthoringPayers` / `list_global_payers` in authoring UIs; ops/network lists stay assignment-scoped.
- Payer Setup **Ready** = checklist SOP presence (#277), not form proven/drift. Attach review defaults are facility-backed only; E6.2 eligibility unchanged.
- **SOP match (`pickTemplate`, #280 / D3.3-G):** sort **state specificity** (exact > `All`) → **group specificity** (exact > any) → **ownership** (org > global) → fallback. Sentinel `state='All'`. Do not use pre-Slice-3 “org block always beats global.”

## Case / contracting grain

- Credentialing case uniqueness: `(provider_id, group_id, payer_id, state)` with `UNIQUE NULLS NOT DISTINCT`.
- Contracting status lives on **`contracts`**, never on `credential_cases`.
- Open-case semantics: `case_status` with closed = `{approved, denied, withdrawn, abandoned}` (also in extension `OPEN_CASE_STATUSES`).

## Sensitive data

- Ordinary tables: `ssn_last4` only.
- Full SSN: vault + audited SECURITY DEFINER RPCs only (E4.4). Never log/export/render full SSN elsewhere.

## Migrations

- **Additive only.** Never rename/drop columns or edit shipped migration files.
- New migration → update `docs/data-model/table-register.md` in the same PR.
- After merge: operator applies migrations on hosted DB, then regenerates `src/integrations/supabase/types.ts` (hand-edited types in PR are interim).

## Extension specifics

- Vite builds `sidepanel` + `content` (`vite.content.config.ts`). `npm run watch` must rebuild **both**.
- Content script talks to sidepanel via `chrome.runtime` messaging; fill/inject is the product path.
- Portals for fill: API list must honor the same visibility as panel D6.4 (assigned + own-org authored; not “all globals”). Browser `chrome.storage` `listPortals` is a **second, unfiltered** path — treat as debt until unified.
- Train / recognition: dual registry risk (sidebar list vs content `portalId` / URL match). Product intent: one portal pointer for capture + recognition.
- Capture payloads may include free-text field labels — PHI/PII risk; do not invent logging of captured values.

## Design / code governance (panel)

- Tokens: primary `#1B4D3E`, border `#E8E5E0`, no card shadows, no decorative gradients.
- Components → hooks → services; named exports; no `any`; no `console.log` / TODO in shipped code.
- Protected without explicit instruction: historical migrations, `sopResolver.ts` (careful), layout/ui primitives, non-additive `types/index.ts` rewrites.

## Workflow

- Single source: `docs/ops/repo-workflow.md` (no root CONTRIBUTING.md by design).
- Issues: `type` + `priority` labels; human creates issues unless PM asks agent to.
- PR: draft → review → merge by human (or explicit PM merge instruction).
- Do not dump chore checklists into chat; execute or leave one PM decision.

## What “done” meant for the 2026 3M engagement

Slices 0–6 **code** closed on main. System was **not** declared muda/mura-free. Post-engagement work continues under this skill’s evaluation loop.
