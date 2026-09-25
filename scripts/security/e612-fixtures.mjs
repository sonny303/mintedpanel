// Synthetic identities and deterministic SQL helpers shared by the E6.12
// native and local HTTP verifiers. These values never leave the disposable
// test topology.
import { createHash } from "node:crypto";

export const E612 = Object.freeze({
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  groupA1: "20000000-0000-4000-8000-000000000001",
  groupA2: "20000000-0000-4000-8000-000000000002",
  groupB1: "20000000-0000-4000-8000-000000000003",
  admin: "30000000-0000-4000-8000-000000000001",
  specialist: "30000000-0000-4000-8000-000000000002",
  billing: "30000000-0000-4000-8000-000000000003",
  memberOnly: "30000000-0000-4000-8000-000000000004",
  trainer: "30000000-0000-4000-8000-000000000005",
  clientPending: "30000000-0000-4000-8000-000000000006",
  clientActive: "30000000-0000-4000-8000-000000000007",
  clientNoGrant: "30000000-0000-4000-8000-000000000008",
  clientRevoked: "30000000-0000-4000-8000-000000000009",
  dual: "30000000-0000-4000-8000-000000000010",
  wrongOrgClient: "30000000-0000-4000-8000-000000000011",
  operator: "30000000-0000-4000-8000-000000000012",
  clientEmailChange: "30000000-0000-4000-8000-000000000013",
  orgBAdmin: "30000000-0000-4000-8000-000000000015",
  provider: "70000000-0000-4000-8000-000000000001",
  accessActive: "40000000-0000-4000-8000-000000000001",
  accessNoGrant: "40000000-0000-4000-8000-000000000002",
  accessRevoked: "40000000-0000-4000-8000-000000000003",
  accessWrongOrg: "40000000-0000-4000-8000-000000000004",
  accessDual: "40000000-0000-4000-8000-000000000005",
  invitePending: "50000000-0000-4000-8000-000000000001",
  inviteExpiry: "50000000-0000-4000-8000-000000000002",
  inviteReplay: "50000000-0000-4000-8000-000000000003",
  inviteEmailChange: "50000000-0000-4000-8000-000000000004",
  inviteRace: "50000000-0000-4000-8000-000000000005",
  orgPortal: "80000000-0000-4000-8000-000000000001",
});

export const TOKENS = Object.freeze({
  pending: "e612-pending-token-aaaaaaaa",
  expiry: "e612-expired-token-bbbbbbbb",
  replay: "e612-replay-token-cccccccc",
  emailChange: "e612-email-change-dddddddd",
  race: "e612-race-token-eeeeeeee",
});

export const USERS = Object.freeze([
  [E612.admin, "admin@e612.test"],
  [E612.specialist, "specialist@e612.test"],
  [E612.billing, "billing@e612.test"],
  [E612.memberOnly, "member@e612.test"],
  [E612.trainer, "trainer@e612.test"],
  [E612.clientPending, "pending@e612.test"],
  [E612.clientActive, "active@e612.test"],
  [E612.clientNoGrant, "nogrant@e612.test"],
  [E612.clientRevoked, "revoked@e612.test"],
  [E612.dual, "dual@e612.test"],
  [E612.wrongOrgClient, "wrong-org@e612.test"],
  [E612.operator, "operator@e612.test"],
  [E612.clientEmailChange, "email-change@e612.test"],
  [E612.orgBAdmin, "orgb-admin@e612.test"],
]);

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function tokenHash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function claims(userId, role = "authenticated") {
  return `DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false); PERFORM set_config('request.jwt.claim.role', ${sqlLiteral(role)}, false); END $$;`;
}

export function asRole(role, userId, body) {
  return `SET ROLE ${role};\n${claims(userId, role)}\n${body}\nRESET ROLE;`;
}

export function baseFixtureSql() {
  return `
INSERT INTO public.organizations (id, name)
VALUES ('${E612.orgA}', 'E612 Synthetic Org A'), ('${E612.orgB}', 'E612 Synthetic Org B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name)
VALUES ${USERS.map(([id, email]) => `('${id}', ${sqlLiteral(email)}, 'E612 Synthetic User')`).join(",\n")}
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.memberships (org_id, user_id, role)
VALUES
  ('${E612.orgA}', '${E612.admin}', 'admin'),
  ('${E612.orgA}', '${E612.specialist}', 'specialist'),
  ('${E612.orgA}', '${E612.billing}', 'billing'),
  ('${E612.orgA}', '${E612.memberOnly}', 'billing'),
  ('${E612.orgA}', '${E612.dual}', 'admin'),
  ('${E612.orgB}', '${E612.admin}', 'admin'),
  ('${E612.orgB}', '${E612.orgBAdmin}', 'admin')
ON CONFLICT (user_id, org_id) DO NOTHING;

INSERT INTO public.provider_groups (id, org_id, name)
VALUES
  ('${E612.groupA1}', '${E612.orgA}', 'E612 Group A1'),
  ('${E612.groupA2}', '${E612.orgA}', 'E612 Group A2'),
  ('${E612.groupB1}', '${E612.orgB}', 'E612 Group B1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.providers
  (id, org_id, group_id, first_name, last_name, email, status)
VALUES
  ('${E612.provider}', '${E612.orgA}', '${E612.groupA1}', 'E612', 'Provider', 'provider@e612.test', 'active')
ON CONFLICT (id) DO NOTHING;
`;
}

export function restrictedFixtureSql() {
  const hashes = Object.fromEntries(
    Object.entries(TOKENS).map(([key, value]) => [key, tokenHash(value)]),
  );
  return `
-- The E6.12 migration owns these private rows. Inserts intentionally use the
-- canonical columns so a contract drift fails the verifier instead of silently
-- producing an empty-set false positive.
INSERT INTO private.internal_staff
  (auth_user_id, org_id, staff_role, active, approved_by, approved_at, manifest_version)
VALUES
  ('${E612.admin}', '${E612.orgA}', 'admin', TRUE, '${E612.admin}', now(), 'e612-fixture-v1'),
  ('${E612.specialist}', '${E612.orgA}', 'specialist', TRUE, '${E612.admin}', now(), 'e612-fixture-v1'),
  ('${E612.dual}', '${E612.orgA}', 'admin', TRUE, '${E612.admin}', now(), 'e612-fixture-v1'),
  ('${E612.orgBAdmin}', '${E612.orgB}', 'admin', TRUE, '${E612.admin}', now(), 'e612-fixture-v1');

INSERT INTO private.client_identity_classifications
  (auth_user_id, org_id, email_normalized, state, expires_at)
VALUES
  ('${E612.clientPending}', '${E612.orgA}', 'pending@e612.test', 'pending', now() + interval '7 days'),
  ('${E612.clientActive}', '${E612.orgA}', 'active@e612.test', 'active', NULL),
  ('${E612.clientNoGrant}', '${E612.orgA}', 'nogrant@e612.test', 'active', NULL),
  ('${E612.clientRevoked}', '${E612.orgA}', 'revoked@e612.test', 'revoked', NULL),
  ('${E612.dual}', '${E612.orgA}', 'dual@e612.test', 'active', NULL),
  ('${E612.clientEmailChange}', '${E612.orgA}', 'email-change@e612.test', 'pending', now() + interval '7 days'),
  ('${E612.wrongOrgClient}', '${E612.orgB}', 'wrong-org@e612.test', 'active', NULL);

INSERT INTO private.client_access
  (id, auth_user_id, org_id, classification_id, state)
VALUES
  ('${E612.accessActive}', '${E612.clientActive}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}'), 'active'),
  ('${E612.accessNoGrant}', '${E612.clientNoGrant}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientNoGrant}' AND org_id = '${E612.orgA}'), 'active'),
  ('${E612.accessRevoked}', '${E612.clientRevoked}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientRevoked}' AND org_id = '${E612.orgA}'), 'revoked');
INSERT INTO private.client_access
  (id, auth_user_id, org_id, classification_id, state)
VALUES
  ('${E612.accessWrongOrg}', '${E612.wrongOrgClient}', '${E612.orgB}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.wrongOrgClient}' AND org_id = '${E612.orgB}'), 'active');
INSERT INTO private.client_access
  (id, auth_user_id, org_id, classification_id, state)
VALUES
  ('${E612.accessDual}', '${E612.dual}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.dual}' AND org_id = '${E612.orgA}'), 'active');

INSERT INTO private.client_group_grants
  (access_id, org_id, group_id)
VALUES
  ('${E612.accessActive}', '${E612.orgA}', '${E612.groupA1}'),
  ('${E612.accessActive}', '${E612.orgA}', '${E612.groupA2}'),
  ('${E612.accessWrongOrg}', '${E612.orgB}', '${E612.groupB1}'),
  ('${E612.accessDual}', '${E612.orgA}', '${E612.groupA1}');

INSERT INTO private.client_invites
  (id, auth_user_id, org_id, classification_id, email_normalized, token_hash, state, expires_at, created_by)
VALUES
  ('${E612.invitePending}', '${E612.clientPending}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientPending}' AND org_id = '${E612.orgA}'), 'pending@e612.test', '${hashes.pending}', 'pending', now() + interval '7 days', '${E612.admin}'),
  ('${E612.inviteExpiry}', '${E612.clientNoGrant}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientNoGrant}' AND org_id = '${E612.orgA}'), 'nogrant@e612.test', '${hashes.expiry}', 'pending', now() - interval '1 minute', '${E612.admin}'),
  ('${E612.inviteReplay}', '${E612.clientActive}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}'), 'active@e612.test', '${hashes.replay}', 'claimed', now() + interval '7 days', '${E612.admin}'),
  ('${E612.inviteEmailChange}', '${E612.clientEmailChange}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientEmailChange}' AND org_id = '${E612.orgA}'), 'email-change@e612.test', '${hashes.emailChange}', 'pending', now() + interval '7 days', '${E612.admin}');

INSERT INTO private.client_invites
  (id, auth_user_id, org_id, classification_id, email_normalized, token_hash, state, expires_at, created_by)
VALUES
  ('${E612.inviteRace}', '${E612.clientActive}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}'), 'active@e612.test', '${hashes.race}', 'pending', now() + interval '7 days', '${E612.admin}');

INSERT INTO private.client_invite_group_grants
  (invite_id, org_id, group_id)
VALUES
  ('${E612.invitePending}', '${E612.orgA}', '${E612.groupA1}'),
  ('${E612.invitePending}', '${E612.orgA}', '${E612.groupA2}'),
  ('${E612.inviteExpiry}', '${E612.orgA}', '${E612.groupA1}'),
  ('${E612.inviteReplay}', '${E612.orgA}', '${E612.groupA1}'),
  ('${E612.inviteEmailChange}', '${E612.orgA}', '${E612.groupA1}'),
  ('${E612.inviteRace}', '${E612.orgA}', '${E612.groupA1}');
`;
}
