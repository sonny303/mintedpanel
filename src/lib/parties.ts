// Pure party helpers (redesign E0.3). Kept out of the service so the grouping
// and role-picker logic are unit-testable without a live DB.
import type { OrgParty, Party, PartyRoleKey, PartyRoleType } from "@/types";

// Collapse per-role assignment rows into one entry per party with its role set
// (F0.3.3 one party, many roles — no duplicate party rows). Party order is the
// order of first appearance; roles are de-duplicated.
export function groupOrgParties(
  rows: Array<{ roleKey: PartyRoleKey; party: Party; isDefault?: boolean }>,
): OrgParty[] {
  const byId = new Map<string, OrgParty>();
  const order: string[] = [];
  for (const { roleKey, party, isDefault } of rows) {
    const existing = byId.get(party.id);
    const target =
      existing ?? ({ party, roleKeys: [], defaultRoleKeys: [] } satisfies OrgParty as OrgParty);
    if (!existing) {
      byId.set(party.id, target);
      order.push(party.id);
    }
    if (!target.roleKeys.includes(roleKey)) target.roleKeys.push(roleKey);
    // D1: at most one party per (org, role) carries the default, and it is what
    // the contact token families resolve — so the flag is per ROLE, not per
    // party, and a party may be default for one role and not another.
    if (isDefault && !target.defaultRoleKeys.includes(roleKey)) {
      target.defaultRoleKeys.push(roleKey);
    }
  }
  return order.map((id) => byId.get(id) as OrgParty);
}

// Active roles a party does NOT already hold in this org, i.e. what the role
// picker should offer to add. Reserved roles are never assignable (F0.3.2/F0.3.5).
export function assignableRoles(types: PartyRoleType[], held: PartyRoleKey[]): PartyRoleType[] {
  return types.filter((t) => t.isActive && !held.includes(t.roleKey));
}

// Count how many parties hold a given role in the org. (The F0.2.2 "can't remove
// the only sales rep" guard this once fed was removed by the 2026-08-07 hotfix;
// the helper stays as a plain display/count utility.)
export function countRole(parties: OrgParty[], roleKey: PartyRoleKey): number {
  return parties.filter((p) => p.roleKeys.includes(roleKey)).length;
}
