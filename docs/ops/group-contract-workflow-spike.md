# Group Contracts Matrix Specification — Payer × State Operational Workflow

**Date:** 2026-09-26  
**Status:** Approved Implementation Specification (updating PR #427 spike)  
**Base:** `sonny303/mintedpanel` `main` at `06261a400261203bbb2b03e40a9b73adc7e0c2fc`

---

## 1. Decision & Background

Operators manage group contract execution using a **Payer × State Group Contracting Matrix**. This replaces manual spreadsheets with a first-class, interactive report in the Reporting Center: **`/reporting/contracts-matrix`**.

The matrix represents a **single Provider Group's (TIN)** contracting footprint at a time, displaying all targeted/contracted payers across states, tracking 8 governed contracting statuses, tentative/confirmed dates, and cross-payer dependencies.

| 3M Dimension | Waste or Burden Eliminated                                                    | Operational Outcome                                                    |
| :----------- | :---------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| **Muda**     | Redundant manual spreadsheets disconnected from panel operations              | One unified, interactive Payer × State matrix inside Minted Panel      |
| **Mura**     | Ambiguous status labels and conflation with individual provider credentialing | 8 governed contracting statuses distinct from provider case lifecycles |
| **Muri**     | Blind spots on tentative effective dates and cross-payer prerequisites        | Explicit tentative dates and pinned cross-payer dependency notes       |

---

## 2. Governed Contracting Statuses

The `contracting` track in `public.status_configs` enforces the following 8 canonical statuses:

1. **Not Started** (`#9CA3AF`, Step 10, Bucket: `ours`) — Initial uncontracted or prospective state (renders as blank / `—` in grid).
2. **Application Submitted** (`#2563EB`, Step 20, Bucket: `waiting_payer`) — Group contracting packet submitted to payer.
3. **In Progress (Contract Signed)** (`#EAB308`, Step 30, Bucket: `waiting_payer`) — Group has signed the agreement; awaiting payer countersignature/loading (`x = signed` in sheet).
4. **In-Network** (`#059669`, Step 40, Bucket: `complete`) — Countersigned and actively effective.
5. **Denied** (`#DC2626`, Step 50, Bucket: `ours`) — Payer rejected group application or panel closed.
6. **Denied - Appealed** (`#EA580C`, Step 60, Bucket: `waiting_payer`) — Group submitted formal appeal following denial.
7. **Denied - Reapplied** (`#8B5CF6`, Step 70, Bucket: `waiting_payer`) — Group submitted reapplication under a new cycle.
8. **Out of Network** (`#64748B`, Step 80, Bucket: `complete`) — Group non-participating, opted out, or contract terminated.

---

## 3. Scope Boundaries

- **Single-Group Grain**: Contracts are scoped to a single `group_id` (TIN). The report provides a prominent Group selector at the top so operators switch easily between provider groups.
- **Multi-Specialty Support**: Contracts carry an optional `specialty` text field (e.g., _Physical Therapy_, _Occupational Therapy_, or default _Multi-Specialty / All_).
- **No Document Storage**: Contract PDF uploads and file storage infrastructure are excluded from scope. Focus is strictly on operational status, dates, and dependencies.
- **Dates**:
  - `tentative_effective_date`: e.g. `x (tent eff 10/1)`.
  - `effective_date`: Confirmed effective date (`Eff MM/DD/YYYY`).
  - `expiration_date`: Renewal or termination date.
- **Cross-Payer Dependencies**: Contract-level notes surface in an expandable footer card (e.g., _"Humana: effective only after Medicare enrollment complete to load contract"_).

---

## 4. Architecture & Implementation Components

1. **Database Schema (`supabase/migrations/`)**:
   - Additive migration `20260926160000_group_contracts_matrix_fields.sql`:
     - Add `tentative_effective_date date` and `specialty text` to `public.contracts`.
     - Seed and synchronize the 8 canonical contracting statuses in `public.status_configs`.
2. **Data Layer (`src/services/` & `src/hooks/`)**:
   - `src/services/contracts.ts`: Add `upsertContract` and `updateContract` handling tentative dates and specialty.
   - `src/hooks/useContracts.ts`: Add `useUpsertContract` and `useUpdateContract` mutations.
3. **Reporting Center Registration (`src/lib/reports.ts`)**:
   - Register `contracts-matrix` under the `credentialing` group.
4. **Routing & UI Components**:
   - Route `src/routes/reporting.contracts-matrix.tsx`.
   - Component `src/components/reports/GroupContractsMatrix.tsx` (Payer × State grid, group selector, legend, and footer notes).
   - Component `src/components/reports/ContractDetailDrawer.tsx` (interactive slide-over drawer to update status, dates, specialty, and notes).
