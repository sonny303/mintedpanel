# Architecture truth (binding)

Read these before contradicting them. Prefer live code over stale docs; prefer these over chat memory.

## Two doors (non-negotiable)

| Surface                          | Path                                                                                  | Forbidden                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Webapp** (mintedpanel)         | React → hooks → services → Supabase JS → **RLS**                                      | Calling Workbench `/api` for panel data                         |
| **Extension** (minted-extension) | Chrome → JWT (`Authorization: Bearer`) → Workbench `/api/*` → service-role → Postgres | Direct Supabase from content/sidepanel; inventing `/api/payers` |

Workbench `/api` is for the **browser extension only**. Panel does not need Postman against it for product QA.

## Org model (post–Slice 6 + R1 B)

- JWT / session carries **org membership** (`memberships`).
- **Active org** in panel: Zustand auth-store `activeOrgId`.
- **`org_payer_assignments`:** table + rows **stay** (additive — never DROP). **R1 B (2026-08-10):** retire it **as a gate** for catalog visibility, attach eligibility, and `create_payer` side-effect — work id **OPA-RETIRE** (do **not** call this Slice 3; #280 owns that label). It is **not** a `buildGenerationPreview` candidacy input (targets / group assignments / facility assignments / exclusions / existing cases only).
- Group↔payer ops live on **`payer_network_targets` / contracts / cases** — different layer.
- **`create_payer`:** live hosted signature is the **10-arg** form (#274). Until OPA-RETIRE lands, creating a payer may still upsert the caller org’s assignment in-RPC; the Slice 6 `p_assign_to_org` flag was **superseded** (do not reintroduce).
- SOP library read-back: prefer migration `20260809120100` (global SOPs readable without assignment) — confirm hosted apply (OPS-S6).
- Authoring payer universe ≠ ops/filter universe — `useAuthoringPayers` / `list_global_payers` in authoring UIs.
- Payer Setup **Ready** = checklist SOP presence (#277), not form proven/drift. Attach review defaults are facility-backed only; E6.2 eligibility unchanged.
- **SOP match (`pickTemplate`, #280 / D3.3-G):** sort **state specificity** (exact > `All`) → **group specificity** (exact > any) → **ownership** (org > global) → fallback. Sentinel `state='All'`.

## Case / contracting grain

- Credentialing case uniqueness: `(provider_id, group_id, payer_id, state)` with `UNIQUE NULLS NOT DISTINCT`.
- Contracting status lives on **`contracts`**, never on `credential_cases`.
- Open-case semantics: `case_status` with closed = `{approved, denied, withdrawn, abandoned}` (also in extension `OPEN_CASE_STATUSES`).
- **Generation candidacy** (`buildGenerationPreview`): active targets × un-ended group membership × facility presence under the group; then exclusions/existing. Facts fence (`listProviderReadinessFacts`) drops `pending_verification` / terminated / test — **GEN-SILENT** explains those drops + `no_facility` on `/generation` without changing the math.

## Sensitive data

- Ordinary tables: `ssn_last4` only.
- Full SSN: vault + audited SECURITY DEFINER RPCs only (E4.4). Never log/export/render full SSN elsewhere.

## Migrations

- **Additive only.** Never rename/drop columns or edit shipped migration files.
- New migration → update `docs/data-model/table-register.md` in the same PR.
- After merge: operator applies on hosted DB, then regenerates `types.ts`. **Hosted ≠ merged.**

## Extension specifics

- Vite builds `sidepanel` + `content`. `npm run watch` must rebuild **both**.
- Portals for fill: `/api/portals` with D6.4. Browser panel `listPortals` / `usePortals` must use the same `isListableRegistryPortal` predicate (**LISTPORTALS** / #282).
- **Train vs Work registries stay dual** (different visibility). Capture **bind** is URL-only (`matchPortalByUrl`; query/hash ignored). Dropdown = navigate to `formUrl` (design). Mismatch with selection → C1 copy, not “New form … Form 2” (**TRAIN-DUAL**). `payerName` in `recognizeForm` is candidate-name only — does not scope match.
- Never auto-bind capture to dropdown key — shared propose is `org_id` null + idempotent on `(portal_key, selector)`.
- Capture payloads: shape-only (labels/selectors); no value logging.
- `sidepanel/main.ts` is a godfile (TD-50); click wiring needs extracted helpers for real tests (TD-51 — source-grep is a tripwire only).

## Design / code governance (panel)

- Tokens: primary `#1B4D3E`, border `#E8E5E0`, no card shadows, no decorative gradients.
- Components → hooks → services; named exports; no `any`; no `console.log` / TODO in shipped code.
- Protected without explicit instruction: historical migrations, `sopResolver.ts` (careful), layout/ui primitives, non-additive `types/index.ts` rewrites.

## Workflow

- Single source: `docs/ops/repo-workflow.md`.
- Issues: `type` + `priority` labels; human creates unless PM asks agent.
- PR: draft → review → merge by human.
- Do not dump chore checklists into chat; execute or leave one PM decision with **evidence**.

## What “done” meant for the 2026 3M engagement

Slices 0–6 **code** closed on main. System was **not** declared muda/mura-free. Post-engagement work continues under this skill’s evaluation loop + `next-agent-context.md`.
