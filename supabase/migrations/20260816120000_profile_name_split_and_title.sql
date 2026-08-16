-- User profile identity: first/last name + title (2026-08-16).
--
-- WHY THESE COLUMNS EXIST. Payer forms ask for the preparer's first and last
-- name in separate boxes, and for their title ("Credentialing Manager") — the
-- {{user.*}} family could only offer one composite `user.name`, so a two-box
-- form needed a human to retype what the system already knew.
--
-- full_name IS RETAINED AND IS NOT A GENERATED COLUMN. It stays the single
-- display column every existing reader uses (the sidebar, the Org Detail Access
-- table, audit_log actor names, case provenance, touch authors — see
-- lookups.ts / cases.ts / generationRuns.ts / orgSettings.ts). The app writes it
-- from first+last on every profile save, the same frozen-mirror pattern as
-- providers.group_id and sop_templates.state. A GENERATED column would have
-- blanked out every existing display name the moment it was created, because
-- this migration deliberately does NOT backfill first/last (below).
--
-- NO BACKFILL, BY DECISION (2026-08-16). We do not split existing full_name
-- values on whitespace here. A heuristic split with nobody watching is how you
-- turn "Mary Van Der Berg" into last name "Berg"; the /account form is where a
-- human corrects their own name. Until a user saves, their first/last read NULL
-- and the user.firstName/lastName tokens resolve empty with an honest
-- unresolved reason — never a guessed value on a payer form. full_name keeps
-- its current value throughout, so no display surface changes.
--
-- NO RLS OR GRANT CHANGE. profiles_update_self (baseline) already scopes UPDATE
-- to `id = auth.uid()` and authenticated already holds SELECT/INSERT/UPDATE.
-- RLS is row-level, so the new columns are covered by the existing policy: a
-- user may edit their own name and title and nobody else's.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS title text;

COMMENT ON COLUMN public.profiles.first_name IS
  'Given name, set by the user on /account. NULL until they save; never backfilled by splitting full_name.';
COMMENT ON COLUMN public.profiles.last_name IS
  'Family name, set by the user on /account. NULL until they save; never backfilled by splitting full_name.';
COMMENT ON COLUMN public.profiles.title IS
  'Free-text job title (e.g. "Credentialing Manager"), used by the {{user.title}} form-fill token.';
COMMENT ON COLUMN public.profiles.full_name IS
  'Display name shown across the app and audit trails. Frozen mirror: written from first_name + last_name on every /account save (src/services/userProfile.ts). Not generated — pre-split rows keep their original value.';
