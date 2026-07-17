-- E1.3 F1.3.2 — provider_group_assignments: the M:N provider↔group join
-- (locked 2026-07-10; prerequisite for the 4-part case key, which lands with
-- E2.3 — NOT here). Mirrors provider_facility_assignments (the table
-- register's named template): shape, org-scoped RLS (member SELECT;
-- specialist/admin writes), grants, plus the E0.10 conventions — an index on
-- the non-leading FK (group_id) and a partial unique "exactly one primary
-- per provider". providers.group_id stays as a FROZEN legacy mirror of the
-- primary assignment (no new readers).

CREATE TABLE IF NOT EXISTS public.provider_group_assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  group_id uuid NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  start_date date,
  end_date date,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_group_assignments_pkey') THEN
    ALTER TABLE ONLY public.provider_group_assignments
      ADD CONSTRAINT provider_group_assignments_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_group_assignments_provider_id_group_id_key') THEN
    ALTER TABLE ONLY public.provider_group_assignments
      ADD CONSTRAINT provider_group_assignments_provider_id_group_id_key UNIQUE (provider_id, group_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_group_assignments_org_id_fkey') THEN
    ALTER TABLE ONLY public.provider_group_assignments
      ADD CONSTRAINT provider_group_assignments_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_group_assignments_provider_id_fkey') THEN
    ALTER TABLE ONLY public.provider_group_assignments
      ADD CONSTRAINT provider_group_assignments_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_group_assignments_group_id_fkey') THEN
    ALTER TABLE ONLY public.provider_group_assignments
      ADD CONSTRAINT provider_group_assignments_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id);
  END IF;
END $$;

-- E0.10 FK-index convention: index the non-leading FK columns.
CREATE INDEX IF NOT EXISTS idx_provider_group_assignments_group_id
  ON public.provider_group_assignments (group_id);
CREATE INDEX IF NOT EXISTS idx_provider_group_assignments_org_id
  ON public.provider_group_assignments (org_id);

-- Exactly one primary group per provider (mirrors
-- uq_provider_facility_assignments_one_primary from E0.10).
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_group_assignments_one_primary
  ON public.provider_group_assignments (provider_id)
  WHERE is_primary;

ALTER TABLE public.provider_group_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'provider_group_assignments_select') THEN
    CREATE POLICY provider_group_assignments_select ON public.provider_group_assignments
      FOR SELECT TO authenticated
      USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'provider_group_assignments_insert') THEN
    CREATE POLICY provider_group_assignments_insert ON public.provider_group_assignments
      FOR INSERT TO authenticated
      WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'provider_group_assignments_update') THEN
    CREATE POLICY provider_group_assignments_update ON public.provider_group_assignments
      FOR UPDATE TO authenticated
      USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))))
      WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'provider_group_assignments_delete') THEN
    CREATE POLICY provider_group_assignments_delete ON public.provider_group_assignments
      FOR DELETE TO authenticated
      USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
  END IF;
END $$;

REVOKE ALL ON public.provider_group_assignments FROM anon;
REVOKE ALL ON public.provider_group_assignments FROM authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.provider_group_assignments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.provider_group_assignments TO service_role;
