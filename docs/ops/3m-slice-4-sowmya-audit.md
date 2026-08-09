# 3M Slice 4 — Sowmya audit appendix

**Status:** Complete (Slice 4 close-out, 2026-08-09).  
**Audience:** PM (Sowmya) + operators.  
**Companion:** [`3m-slice-5-closeout.md`](./3m-slice-5-closeout.md) · [`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md) · [`3m-uat-readiness-checklist.md`](./3m-uat-readiness-checklist.md).

This appendix is the Slice 4 deliverable: findings that stay **audit / ops /
roadmap**, not 3M product code. Items that needed a code fix were moved into
Slices 1 / 6 (see mapping below). Nothing here invents vault custody, platform
roles, or E6.9 FormStepPanel wiring — those stay R7 / epic lane.

---

## Finding disposition map

| ID  | Topic                                        | 3M disposition                                                               |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| F1  | Vault key may be unprovisioned               | **Ops** — runbook below; fail-closed until set                               |
| F2  | Open-cases used legacy status mirrors        | **Fixed** — Slice 1 (#267)                                                   |
| F3  | Empty portals registry silent no-op          | **Fixed** — Slice 1 (panel meta + extension empty-state)                     |
| F9  | Ungated shared / global authoring (D11)      | **Accepted risk → R7** — document below; do not revert in 3M                 |
| F22 | Hosted migrations may lag repo               | **Ops** — checklist + SQL below                                              |
| F23 | `create_payer` couples create → org assign   | **Fix in Slice 6 build** (spike locked D6.1–D6.7)                            |
| F24 | `listSharedPortals` / Train ghosts           | **Fix in Slice 6 build** (filter); Train already calls `/api/shared-portals` |
| F25 | Setup narrow + Train wide = incoherent model | **Resolved by F23+F24** under Slice 6                                        |
| F26 | Shared map propose has no portal FK          | **Monitor** — document; soft validation later if orphans appear              |
| F21 | E6.9 backend without FormStepPanel UI        | **Epic lane** — do not finish in 3M                                          |

---

## F1 — Vault key provisioning (ops)

### Truth (code)

- Full SSN lives only in `provider_ssn_vault` (E4.4). Ordinary tables keep
  `ssn_last4` only (`AGENTS.md`).
- Hosted Supabase **rejects** `ALTER DATABASE … app.settings.ssn_vault_key`
  for the dashboard `postgres` role. Migration
  `20260718020000_ssn_vault_key_via_supabase_vault.sql` sources the key from
  **Supabase Vault** secret name `ssn_vault_key`, with GUC fallback for local/CI.
- RPCs **fail closed** if no key is configured — nothing encrypts/decrypts with
  an empty key.

### Operator steps (hosted)

1. Project Settings → **Vault** → Add secret.
2. Name: `ssn_vault_key` (exact).
3. Value: a high-entropy secret (≥32 bytes). Do not paste into tickets/chat.
4. Verify without logging the secret:

```sql
-- Should return true when the vault secret exists (not the key value):
select exists (
  select 1 from vault.decrypted_secrets where name = 'ssn_vault_key'
) as vault_key_present;
```

5. Smoke a fail-open path you already use in UAT (admin reveal or fill-only
   release) only after the secret exists. If the secret is missing, expect the
   explicit “SSN vault key is not configured” error.

### 3M ask of PM

Tick the vault box on [`3m-uat-readiness-checklist.md`](./3m-uat-readiness-checklist.md).
No code change in this slice.

---

## F9 / TD-42 — Ungated shared authoring (accepted → R7)

### What shipped

PM D11 (2026-08-07) and E6.7/E6.9: global-tier RPCs and
`POST /api/shared-field-maps` are open to **any signed-in user**. JWT
verification is the gate; there is **no platform-role boundary** and **no
`audit_log` home** for cross-org / null-org writes (`audit_log.org_id` is NOT
NULL).

Surfaces (non-exhaustive): `author_global_sop`, `upsert_global_portal`,
`set_global_portal_flags`, `train_global_field_map`, global branch of
`publish_sop_template_version`, plus extension propose on
`/api/shared-field-maps`.

### Why 3M does not “fix” it

Re-gating now would fight a locked PM decision and the two-operator trust
model. The right home is **R7 platform roles**: capability boundary, re-gate
the RPCs, audit home for null-org writes. Tracked as **TD-42** (and sibling
**TD-43** org-scoped dictionary learning).

### Risk statement for Sowmya

Today any authenticated operator can mutate the **shared** form library and
global payer/SOP/portal authoring paths. Acceptable while the operator set is
tiny and trusted; becomes stop-ship before multi-tenant staff or external
writers. Do not treat “ungated” as a bug in the 3M lane.

---

## F22 — Hosted migration parity

Repo may be ahead of hosted. Agent environments often cannot verify (no
credentials / Supabase MCP `needsAuth`).

### Minimum Aug 7+ set (filename order)

- `20260807130000_people_contact_roles.sql`
- `20260807130100_people_contact_role_rpcs.sql`
- `20260807150937_harden_party_role_tenant_integrity.sql`
- `20260807160000_e69_field_registry.sql`
- `20260807160100_e69_shared_registry_rpcs.sql`
- `20260807170000_e69_datafields_to_registry.sql`

```sql
select version
from supabase_migrations.schema_migrations
where version like '20260807%'
order by version;
```

After apply: regenerate TypeScript types (process rule in `TECH-DEBT.md`) —
PR #264 territory if drift already exists.

Portals non-empty check (fill/capture UAT):

```sql
select count(*) as global_portals from portals where org_id is null;
```

Read-only ghost inventory (no deletes):
[`global-portal-payer-inventory.sql`](./global-portal-payer-inventory.sql).

---

## F23–F26 — Simplification appendix (platform vs org)

### Intended loop (join keys: `payer_id` + `portal_key`)

1. Create **global** payer
2. Author global SOP (`online_form` step)
3. Register **shared** portal (`org_id` null)
4. Bind `portalKey` on the SOP step
5. Extension **Train** proposes shared field maps (org-free, D10)
6. Field Registry / approve in webapp
7. **Later:** org assign → group targets → cases → Work fill

Two doors: webapp → Supabase RLS/RPCs; extension → JWT → `/api/*` only.
**No `/api/payers`.** Payers appear nested on portal/case payloads.

### Core Mura (why Slice 6 exists)

| Today                                                                 | Desired                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| `create_payer` always upserts `org_payer_assignments`                 | Create may assign; default still “add to my network” |
| Payer Setup lists `activeOrgPayers()` only                            | Platform authoring without prior assignment          |
| Shared portal lists historically unfiltered → ghost Train rows        | Active payer + non-null `payer_id` filter (F24)      |
| SOP/portal write without assign can fail **read-back** (RLS list gap) | Fix read path (spike D6.5 Option A)                  |

Locked build decisions: **D6.1–D6.7** in
[`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md).
Inventory SQL already shipped with the spike. **Slice 6 build** implements the
RPC flag, checkbox UX, list filters, and read-back fix.

### F26 — Orphan shared maps

`POST /api/shared-field-maps` does not FK-enforce a live `portals` row.
Skipping portal registration can leave orphan propose rows. **Monitor** via
inventory SQL; optional soft validation is post-3M (not Slice 6 must-have).

### Extension note (delta since plan draft)

E6.9 PR2 shipped: Train calls `GET /api/shared-portals`. Ghosts remaining after
Slice 6 are then an API-filter problem, not a missing consumer.

---

## Debt-register reconciliation (fresh eyes → Sowmya)

| Register item                       | Fresh-eyes call (2026-08-09)                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| TD-04 `vercel.json` SPA fallback    | **Stale / resolved** — `vercel.json` is `{}`; TanStack Start routes `/api` (Slice 3 docs). Update register below. |
| TD-35 dual-write mirrors            | **Still real** for some legacy readers; Slice 1 fixed the **extension open-cases** API path to `case_status`.     |
| TD-36–40, TD-38                     | **Closed** in E6 wave — do not re-plan                                                                            |
| TD-41 dual provider create          | **Real muda** — closed out of 3M with AC in Slice 5 doc → next Providers epic                                     |
| TD-42 ungated global authoring      | **Reclassified** — PM D11 accepted; → R7 (this appendix F9)                                                       |
| TD-43 org dictionary vs global maps | **Real** — rides R7 with TD-42                                                                                    |
| TD-45–48                            | Unchanged product/ deferred items — not 3M                                                                        |
| DESIGN-DEBT.md                      | Process register; compositions logged correctly. **PM triage cycle** still owed — not a 3M code slice.            |
| CLAUDE “delete quickCards mirror”   | **Stale** — extension removed Jul 2026                                                                            |

Register edits landed in the same PR as this appendix (`TECH-DEBT.md` § 3M
reconciliation).

---

## Readiness gates (operator mental model)

| Job                       | Do not start without                                      |
| ------------------------- | --------------------------------------------------------- |
| Train / propose maps      | Shared portal with non-null `payer_id` on an active payer |
| Work fill                 | Case + URL match + **approved** maps                      |
| Full-SSN vault paths      | Vault secret `ssn_vault_key` provisioned                  |
| Field Registry / E6.9 UAT | Hosted Aug 7 migrations applied + types regen             |

---

## What Slice 4 explicitly does **not** do

- Implement Slice 6 RPC/UI
- Merge Postman (#265)
- Implement R7 platform roles
- Finish FormStepPanel epic wiring
- Destructive seed cleanup
