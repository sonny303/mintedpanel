-- MINT-60 follow-up: authenticated table reads expose only the safe receipt
-- projection. actor_id remains available to trusted service workflows and in
-- the SECURITY DEFINER reset RPC's return value for its caller.

REVOKE ALL ON TABLE public.form_mapping_reset_events
  FROM PUBLIC, anon, authenticated;

-- Clear any prior per-column SELECT grants before re-granting the projection.
REVOKE SELECT (
  id,
  portal_id,
  owner_scope,
  org_id,
  portal_key,
  old_mapping_generation,
  new_mapping_generation,
  actor_id,
  created_at,
  affected_field_count,
  idempotency_key
) ON TABLE public.form_mapping_reset_events
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  portal_id,
  owner_scope,
  org_id,
  portal_key,
  old_mapping_generation,
  new_mapping_generation,
  created_at,
  affected_field_count,
  idempotency_key
) ON TABLE public.form_mapping_reset_events TO authenticated;

-- Keep the trusted audit surface table-wide so service workflows can retain
-- actor attribution and append receipts. Ordinary authenticated writes remain
-- unavailable; reset_portal_mapping is the authenticated writer.
GRANT SELECT, INSERT ON TABLE public.form_mapping_reset_events TO service_role;

COMMENT ON TABLE public.form_mapping_reset_events IS
  'MINT-45/MINT-60 append-only reset receipts. Authenticated table reads are limited to safe receipt columns and RLS; actor_id is withheld from table reads. Trusted service workflows retain table-wide SELECT, and reset_portal_mapping returns the caller receipt through its SECURITY DEFINER result.';
