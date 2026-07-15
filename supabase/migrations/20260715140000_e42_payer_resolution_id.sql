-- E4.2 F4.2.1 — per-payer resolution-identifier config.
-- Each payer names its payer-issued INDIVIDUAL (Type 1 NPI-linked) enrollment
-- identifier differently (Aetna "Provider PIN", BCBS "Provider ID") and may or
-- may not be expected to issue one at approval. This config is read through the
-- E4.0 `payerResolutionIdentifier.ts` seam by the F4.0.3 approval step. The
-- Group/Billing (Type 2) label is fixed, so only the individual field is
-- configured here. Additive + nullable: NULL label = unconfigured, so the seam
-- falls back to the generic "Payer-issued ID" optional field.
alter table public.payers
  add column if not exists resolution_id_label text,
  add column if not exists resolution_id_expected boolean;
