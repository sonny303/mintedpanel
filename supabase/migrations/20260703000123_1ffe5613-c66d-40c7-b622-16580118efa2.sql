-- A2 hardening (parts 1, 2, 4): grants, DELETE policies, hot-path indexes.
-- Applied to the dev project via MCP as "security_hardening_grants_delete_policies_indexes".
-- No existing RLS policies are modified.

-- ============ 1. GRANTS ============
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t.tablename);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_sop_field_tokens() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sop_field_tokens() TO authenticated;

-- ============ 2. DELETE POLICIES (org-scoped, writer roles) ============
-- Append-only tables (touches, status_history, audit_log) intentionally excluded.
GRANT DELETE ON public.state_licenses TO authenticated;
CREATE POLICY state_licenses_delete ON public.state_licenses
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  );

GRANT DELETE ON public.provider_facility_assignments TO authenticated;
CREATE POLICY provider_facility_assignments_delete ON public.provider_facility_assignments
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  );

GRANT DELETE ON public.notes TO authenticated;
CREATE POLICY notes_delete ON public.notes
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  );

-- ============ 4. HOT-PATH INDEXES ============
CREATE INDEX IF NOT EXISTS idx_tasks_case_id ON public.tasks (case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON public.tasks (org_id);
CREATE INDEX IF NOT EXISTS idx_credential_cases_org_id ON public.credential_cases (org_id);
CREATE INDEX IF NOT EXISTS idx_credential_cases_provider_id ON public.credential_cases (provider_id);
CREATE INDEX IF NOT EXISTS idx_touches_case_id ON public.touches (case_id);
CREATE INDEX IF NOT EXISTS idx_touches_org_id ON public.touches (org_id);
CREATE INDEX IF NOT EXISTS idx_status_history_case_id ON public.status_history (case_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_id_ts ON public.audit_log (org_id, ts DESC);
