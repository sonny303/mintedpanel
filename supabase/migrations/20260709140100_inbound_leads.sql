-- E0.5 TE-7 — Inbound "contact us" lead capture (PM-directed, reviewer-added).
--
-- A public /contact form lets a stranger with NO org/party submit interest. It
-- creates a TRIAGED lead, never a live org (the one-active-link / recipient-
-- binding / party-overwrite rules of the outbound flow do NOT apply here). P1
-- triages: Convert (-> E0.1 create_organization, prospect) or Dismiss. Leads
-- never touch real orgs until P1 converts, which contains spam blast radius (TD-5).
--
-- Additive + idempotent. inbound_leads is NOT org-scoped on insert (there is no
-- org yet, TD-6): insert is via a SECURITY DEFINER anon RPC with required-field
-- validation + a honeypot (baseline anti-abuse, no new dependency, no CAPTCHA).
-- The shared internal triage queue is the Stage 0 model: any authenticated user
-- reads/updates leads.

CREATE TABLE IF NOT EXISTS public.inbound_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'converted', 'dismissed')),
  converted_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbound_leads_status_idx ON public.inbound_leads (status);

ALTER TABLE public.inbound_leads ENABLE ROW LEVEL SECURITY;

-- Stage 0 shared internal triage queue (TD-6): any authenticated user sees and
-- triages inbound leads. Insert is anon-RPC-only (no authenticated INSERT policy).
DROP POLICY IF EXISTS inbound_leads_select ON public.inbound_leads;
CREATE POLICY inbound_leads_select ON public.inbound_leads
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS inbound_leads_update ON public.inbound_leads;
CREATE POLICY inbound_leads_update ON public.inbound_leads
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, UPDATE ON public.inbound_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_leads TO service_role;

-- ---------------------------------------------------------------------------
-- submit_inbound_lead (public, ANON). The most abuse-exposed endpoint in Stage 0
-- (no token gate — that's the point of a public contact form, TD-5). Baseline
-- controls: a hidden honeypot field (a bot fills it; a human never sees it) +
-- required-field validation. A filled honeypot returns a fake success and
-- inserts nothing. Leads land as 'new' for P1 triage; no org is ever created here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_inbound_lead(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := btrim(coalesce(p_payload->>'contact_email', ''));
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
BEGIN
  -- Honeypot: real users never populate this hidden field; bots do. Silently
  -- pretend success so a bot gets no signal, but insert nothing.
  IF btrim(coalesce(p_payload->>'company_website', '')) <> '' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF btrim(coalesce(p_payload->>'org_name', '')) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF btrim(coalesce(p_payload->>'contact_name', '')) = '' THEN
    RAISE EXCEPTION 'Your name is required';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;
  IF v_email !~ v_email_re THEN
    RAISE EXCEPTION 'Email is not valid';
  END IF;
  IF btrim(coalesce(p_payload->>'contact_phone', '')) = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;

  INSERT INTO public.inbound_leads (
    org_name, contact_name, contact_email, contact_phone,
    address_line1, address_line2, city, state, postal_code, country, status
  ) VALUES (
    btrim(p_payload->>'org_name'),
    btrim(p_payload->>'contact_name'),
    v_email,
    nullif(btrim(coalesce(p_payload->>'contact_phone', '')), ''),
    nullif(btrim(coalesce(p_payload->>'address_line1', '')), ''),
    nullif(btrim(coalesce(p_payload->>'address_line2', '')), ''),
    nullif(btrim(coalesce(p_payload->>'city', '')), ''),
    nullif(btrim(coalesce(p_payload->>'state', '')), ''),
    nullif(btrim(coalesce(p_payload->>'postal_code', '')), ''),
    nullif(btrim(coalesce(p_payload->>'country', '')), ''),
    'new'
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_inbound_lead(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_inbound_lead(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_inbound_lead(jsonb) TO authenticated;
