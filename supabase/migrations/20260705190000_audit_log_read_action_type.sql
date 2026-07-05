-- Allow 'READ' in audit_log.action_type.
--
-- R2 locked decision 4 (2026-07-05): GET /api/providers/:id/profile — the most
-- PHI-dense response in the system — writes one audit row per successful read
-- (acting user, provider, route; never the body or token values). This
-- supersedes the 2026-07-05 rely-on-fill_sessions decision recorded in
-- docs/minted-panel-release-plan.md, which anticipated exactly this migration.
--
-- Additive in effect: every previously-valid value remains valid; 'READ' is
-- appended. Dropping and re-adding the constraint is the only way Postgres can
-- widen a CHECK.
alter table public.audit_log drop constraint if exists audit_log_action_type_check;
alter table public.audit_log add constraint audit_log_action_type_check
  check (action_type = any (array[
    'CREATE'::text,
    'UPDATE'::text,
    'STATUS_CHANGE'::text,
    'TOUCH_LOGGED'::text,
    'TERMINATION'::text,
    'READ'::text
  ]));
