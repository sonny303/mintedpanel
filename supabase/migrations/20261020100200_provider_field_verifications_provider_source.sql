-- 2026-10-20 — Relax provider_field_verifications CHECK to accept 'provider'
-- as a valid verified_source. The provider is now a source of truth for fields
-- they enter themselves in the self-onboarding form.
--
-- Additive + idempotent. The original constraint name was
-- provider_field_verifications_source_check (from migration
-- 20260728120000_s61_provider_field_verifications.sql).

ALTER TABLE public.provider_field_verifications
  DROP CONSTRAINT IF EXISTS provider_field_verifications_source_check;

ALTER TABLE public.provider_field_verifications
  ADD CONSTRAINT provider_field_verifications_source_check
  CHECK (verified_source IN ('manual', 'caqh', 'extension', 'provider'));