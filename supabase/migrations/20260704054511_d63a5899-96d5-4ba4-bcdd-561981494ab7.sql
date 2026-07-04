-- status_configs.action_bucket was made NOT NULL on the hosted database with
-- no default, so Admin > Statuses inserts (which never send the column) fail
-- with a not-null violation on every track, including the new location track.
-- A default of 'ours' matches the action engine's safe fallback (unknown
-- buckets surface as needs_action).
ALTER TABLE public.status_configs ALTER COLUMN action_bucket SET DEFAULT 'ours';
