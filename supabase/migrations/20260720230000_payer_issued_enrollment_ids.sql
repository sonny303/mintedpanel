-- 2026-07-20 — Re-scope resolution identifiers to payer-aligned enrollment
-- details (user handoff). A payer-issued enrollment ID (PIN) is not an
-- org-wide value: a payer issues it either to a PROVIDER (under a group's
-- contract — the enrollment_facts grain) or to a GROUP (under its contract —
-- the payer_network_targets grain). Store the issued VALUE where it is
-- issued; both levels may coexist for the same payer. The per-payer LABEL
-- (what the payer calls its ID) stays Minted-curated on payers
-- (resolution_id_label) — the org_payer_settings override tier is retired
-- app-side (table kept dormant per the additive rule).
--
-- Additive, nullable, no backfill; existing RLS UPDATE policies govern the
-- writers (facts: org writers via the E6.2 policies; targets: org admins).

alter table public.enrollment_facts
  add column if not exists payer_issued_id text;

comment on column public.enrollment_facts.payer_issued_id is
  'Payer-issued enrollment identifier (PIN) for this provider enrollment, as issued under the group''s contract. Label comes from payers.resolution_id_label (Minted-curated) with a generic fallback.';

alter table public.payer_network_targets
  add column if not exists payer_issued_id text;

comment on column public.payer_network_targets.payer_issued_id is
  'Payer-issued GROUP enrollment identifier (group PIN) for this group x payer x state attachment. Coexists with provider-level IDs on enrollment_facts.';
