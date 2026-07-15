-- E4.2 F4.2.7 / TE-17 — dry-run test-fill marker + designated test provider.
-- `fill_sessions.is_test` distinguishes dummy-provider dry runs from real
-- fills; every metric reader (scorecard firstPassRate, reporting) filters it
-- out. `providers.is_test_provider` marks the org's designated test provider —
-- an ordinary providers row excluded from queue/generation/scorecard
-- derivations by ONE shared pure predicate. Both additive, default false.
alter table public.fill_sessions
  add column if not exists is_test boolean not null default false;
alter table public.providers
  add column if not exists is_test_provider boolean not null default false;

-- E4.2 F4.2.7 / TE-17 — a dry-run test fill against the designated test
-- provider requires NO case ("no case is required"). Relax case_id to nullable
-- so a marked test fill can be logged without a credentialing case. The
-- extension's real-fill path (/api/fill-events) still requires a case (its own
-- validation is unchanged); only the in-app test runner writes a null-case row.
alter table public.fill_sessions alter column case_id drop not null;
