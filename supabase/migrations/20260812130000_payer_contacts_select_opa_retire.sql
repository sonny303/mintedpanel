-- Hotfix — payer_contacts_select missed the OPA-RETIRE widening.
--
-- Symptom: adding a contact on Payer Detail showed "Contact added", then the
-- list refetched and rendered "No contacts yet". The write SUCCEEDED (the row
-- is in the table, audited); the READ was blocked.
--
-- Cause: `payer_contacts_select` (20260727120200) RESTATES the parent payer's
-- visibility, because policies do not compose across tables. That restatement
-- was a copy of the THEN-current `payers_select` — global row visible only via
-- an `org_payer_assignments` row. OPA-RETIRE (`20260810220000`) widened
-- `payers_select` to own-org OR `org_id IS NULL` and stopped `create_payer`
-- writing the assignment row, but did not carry the widening into this copy.
-- Result: every manually-created payer (all of them, post-OPA-RETIRE) has zero
-- assignment rows, so its contacts are invisible to every org — including the
-- one that just wrote them.
--
-- Live at authoring time: `payer_contacts_select` was the LAST policy in the
-- database still reading `org_payer_assignments`
-- (`pg_policies` sweep over qual + with_check returned exactly this one row).
--
-- Fix: restate the CURRENT `payers_select` shape. SELECT only — the RPC-only
-- write posture (no client INSERT/UPDATE/DELETE policy or grant) is untouched,
-- and this grants no visibility the parent payer row does not already have.

DROP POLICY IF EXISTS payer_contacts_select ON public.payer_contacts;

CREATE POLICY payer_contacts_select ON public.payer_contacts
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.payers p
      WHERE p.id = payer_contacts.payer_id
        AND (
          (p.org_id IN (SELECT user_org_ids()))
          OR (p.org_id IS NULL)
        )
    )
  );
