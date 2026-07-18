-- E4.2 payer governance close-out — payers write lockdown (2026-07-18).
--
-- Orgs SELECT canonical payer identities from the Minted catalog; they never
-- create, rename, or update payers rows. The app-side write paths are gone
-- (free-text creation removed by the governance PR; updatePayer removed with
-- this close-out), and the legacy org-scoped rows those paths served were
-- removed by the PM-approved pre-prod-cut data wipe (2026-07-17, AGENTS.md
-- carve-out; pre-wipe data preserved in the mintedpanel-backup-july17
-- project) — the live table is global-catalog-only (org_id IS NULL on every
-- row). These grants/policies were the one remaining channel that could mint
-- or mutate an org-scoped payer (a hand-crafted PostgREST call under
-- payers_insert/payers_update). Close it.
--
-- SELECT is untouched: members keep the payers_select policy (own-org
-- disjunct now vestigial, plus the assigned-global disjunct the catalog runs
-- on). Catalog writes stay service-role only (payer-catalog-sync /
-- review_payer_catalog_change), which bypass RLS and are unaffected.
drop policy if exists payers_insert on public.payers;
drop policy if exists payers_update on public.payers;

revoke insert, update on table public.payers from authenticated;
revoke insert, update on table public.payers from anon;
