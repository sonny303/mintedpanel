-- 20260926160000_group_contracts_matrix_fields.sql
-- Additive columns on contracts and synchronization of the 8 canonical contracting statuses.

-- 1. Additive fields on public.contracts
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS tentative_effective_date date,
  ADD COLUMN IF NOT EXISTS specialty text;

-- 2. Synchronize the 8 governed contracting statuses in public.status_configs across all existing organizations
DO $$
DECLARE
  org RECORD;
  status_record RECORD;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    -- Define the 8 canonical statuses
    FOR status_record IN
      SELECT * FROM (VALUES
        ('Not Started',                  '#9CA3AF', 10, 'ours'),
        ('Application Submitted',        '#2563EB', 20, 'waiting_payer'),
        ('In Progress (Contract Signed)','#EAB308', 30, 'waiting_payer'),
        ('In-Network',                   '#059669', 40, 'complete'),
        ('Denied',                       '#DC2626', 50, 'ours'),
        ('Denied - Appealed',            '#EA580C', 60, 'waiting_payer'),
        ('Denied - Reapplied',           '#8B5CF6', 70, 'waiting_payer'),
        ('Out of Network',               '#64748B', 80, 'complete')
      ) AS t(label, color, sort_order, action_bucket)
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.status_configs
        WHERE org_id = org.id AND track = 'contracting' AND label = status_record.label
      ) THEN
        UPDATE public.status_configs
        SET color = status_record.color,
            sort_order = status_record.sort_order,
            action_bucket = status_record.action_bucket
        WHERE org_id = org.id AND track = 'contracting' AND label = status_record.label;
      ELSE
        INSERT INTO public.status_configs (org_id, track, label, color, sort_order, action_bucket)
        VALUES (org.id, 'contracting', status_record.label, status_record.color, status_record.sort_order, status_record.action_bucket);
      END IF;
    END LOOP;
  END LOOP;
END $$;
