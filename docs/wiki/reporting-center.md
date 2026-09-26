# Reporting Center

_Updated for: Reporting & Roster Architecture Plan v2.1 (2026-09-25). Reflects the Clinical Capacity, Billing Readiness, and Roster Engine pivot._

Cross-org and client-facing reporting suites, organized by operational role and question type.

## Primary Architecture & Boundaries

Minted Panel operates under strict data boundaries:
- **No live EHR scheduling integrations** or 837/835 revenue/claims feeds.
- Focus is on **verifiable operational truth**: clinical capacity, credentialing proof, billing clearance signals, ownership mapping, and automated payer rosters.
- Full architectural specification: [Reporting & Roster Architecture Plan v2.1](../reporting/reporting-and-roster-architecture-v2.md).

## The Three Reporting Pillars

### 1. Customer Dashboards (Client Capacity & Billing Suite)
- **★ Top Priority: Transparent Enrollment Explorer** (`/reporting/enrollment-explorer`): High-density matrix of Clinicians (rows) $\times$ Payer Products (columns) with a slide-over proof drawer (primary source verification, effective dates, retro windows, next-action ownership, downloadable audit documents).
- **Billing Readiness & Change Feed** (`/reporting/billing-readiness`): Point-of-care verification (Green/Yellow/Red) and real-time credentialing event alerts for therapy clinics holding claims until credentialed.
- **Executive Clinician Readiness & Deployment Dashboard** (`/reporting/capacity-ramp`): High-level KPI strip (% ready to bill, new hire onboarding cohorts, actionable blockers deck, optional Wave 2 financialized capacity at risk).

### 2. Internal Reports (Operational Suite)
- **Payer Pipeline Velocity & SLA Tracker** (`/reporting/pipeline-velocity`): Application aging mapped by `ActionBucket` ownership (*Ours*, *Waiting on Client/Provider*, *Waiting on Payer*, *Complete*) with attribution clocks.
- **Portfolio** (`/reporting/portfolio`): Cross-org executive view (In motion, Prospects, Inactive).
- **Launches** (`/reporting/launches`): Clinic go-live dates driving deadline rankings.
- **Facilities Without Providers** (`/reporting/facilities-without-providers`) & **Locations per Group** (`/reporting/locations-per-group`).
- **Denials** (`/reporting/denials`): Structured reason codes and reapplication tracking.
- **Expiring Credentials** (`/reporting/expiring-credentials`): 30/60/90-day countdowns for licenses, malpractice policies, and CAQH re-attestations.
- **Audit Log** (`/reporting/audit-log`): Append-only regulatory ledger (zero PHI rendered).
- **Inbound Leads** (`/reporting/leads`): Triage queue for public inquiries.

### 3. Rosters Section (Provider Roster Engine)
Accessible via `/reporting/rosters/*`:
- **Template Catalog** (`/reporting/rosters/templates`): Payer-specific schema definitions (BCBS, Humana, Medicare MACs).
- **Mapping Workspace** (`/reporting/rosters/mapping/:id`): Visual column mapping with deterministic transforms.
- **Validation & Overrides** (`/reporting/rosters/validation/:id`): Rule validation (NPI Luhn, licenses, addresses) with $\ge 20$-char audit override reasons.
- **Quick Export & Audit Ledger** (`/reporting/rosters/export/:id`, `/reporting/rosters/history`): Deterministic CSV/XLSX generation with immutable sha256 snapshot records.

## Navigation & Tenancy
- Reporting Center preserves the 6 primary sidebar items in the app shell.
- Rosters live under `/reporting/rosters/*`.
- Tokenized public report shares (`REPORT-08` / `PUBLIC-03`) provide secure, zero-session executive access.
