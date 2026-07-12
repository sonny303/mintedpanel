-- Allow 'DELETE' in audit_log.action_type (E1.4 TE-8 tech-debt note).
--
-- Assignment removal (unchecking a facility) is a hard DELETE by R3 decision
-- (current-state model, no archive). The removal is audited — but the CHECK
-- never allowed 'DELETE' even though the AuditActionType union has carried it
-- since the scaffold. Widened here following the READ-widening pattern
-- (20260705190000): additive in effect — every previously-valid value stays
-- valid; 'DELETE' is appended.
alter table public.audit_log drop constraint if exists audit_log_action_type_check;
alter table public.audit_log add constraint audit_log_action_type_check
  check (action_type = any (array[
    'CREATE'::text,
    'UPDATE'::text,
    'STATUS_CHANGE'::text,
    'TOUCH_LOGGED'::text,
    'TERMINATION'::text,
    'READ'::text,
    'DELETE'::text
  ]));
