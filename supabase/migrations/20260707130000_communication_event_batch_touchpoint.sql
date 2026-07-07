-- Story 8: batch touchpoint. One parent communication_event per payer call, one
-- child touchpoint per case (touches.communication_event_id links them). Keeps a
-- single touchpoint concept — a single-case touch is just a call with one child
-- (communication_event_id NULL). The child column was added in the Story 1
-- migration; here we add the parent table and the FK.
CREATE TABLE IF NOT EXISTS public.communication_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  payer_id uuid NOT NULL REFERENCES public.payers(id),
  channel text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT communication_event_channel_check
    CHECK (channel = ANY (ARRAY['call', 'email', 'portal', 'fax', 'mail']))
);

ALTER TABLE public.communication_event ENABLE ROW LEVEL SECURITY;

-- RLS mirrors touches: member SELECT, writer (specialist|admin) INSERT, no
-- UPDATE/DELETE (append-only, like the touchlog it parents).
DROP POLICY IF EXISTS communication_event_select ON public.communication_event;
CREATE POLICY communication_event_select ON public.communication_event
  FOR SELECT USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

DROP POLICY IF EXISTS communication_event_insert ON public.communication_event;
CREATE POLICY communication_event_insert ON public.communication_event
  FOR INSERT WITH CHECK (
    (org_id IN (SELECT user_org_ids() AS user_org_ids))
    AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))
  );

GRANT SELECT, INSERT ON public.communication_event TO authenticated;
GRANT ALL ON public.communication_event TO service_role;

ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_communication_event_id_fkey;
ALTER TABLE public.touches ADD CONSTRAINT touches_communication_event_id_fkey
  FOREIGN KEY (communication_event_id) REFERENCES public.communication_event(id);
CREATE INDEX IF NOT EXISTS touches_communication_event_id_idx
  ON public.touches (communication_event_id);
