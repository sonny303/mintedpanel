-- 2026-07-21 Org Detail consolidation (user handoff Task A): the governed
-- party-role LABELS catch up with the E0.8 terminology so the "Authorized
-- contact" / "Organization contact" designations render as role chips in the
-- unified People list (the summary block no longer restates people). Display
-- metadata only — role KEYS, assignments, and policies are untouched.
UPDATE public.party_role_types
SET label = 'Authorized contact'
WHERE role_key = 'owner';

UPDATE public.party_role_types
SET label = 'Organization contact'
WHERE role_key = 'customer_escalation_contact';
