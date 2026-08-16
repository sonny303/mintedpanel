// Org contact token families (decisions D9–D12, 2026-08-07).
//
// WHY THIS IS CODE-OWNED AND NOT IN get_sop_field_tokens().
// That RPC derives tokens from information_schema.columns, so adding `parties`
// to it would emit `party.email` — useless, because the whole point is *whose*
// email. This family is inherently ROLE × FIELD and has no schema derivation, so
// it is appended in code exactly the way the {{user.*}} family is
// (src/server/userTokens.ts). The RPC stays honestly uncurated.
//
// NAMING IS EFFECTIVELY IRREVERSIBLE (D10). Token keys join portal_field_maps ↔
// the profile response ↔ extension quick cards by LITERAL STRING MATCH, so a
// rename orphans every trained mapping. Flat camelCase families, matching the
// existing groupInsurance.* style: billingContact.email, not
// party.billingContact.email or contact.billing.email.
//
// RESOLUTION (D1, D11): the holder is the `is_default` assignment of that role
// in the caller's org — many people may hold a role, exactly one is the default.
// Resolution happens at PROFILE time (unlike payer.*/mso.*/contract.*, which are
// case-scoped and always come back null): the org is already on the guard ctx.
//
// NOT IN SOP BODIES (D12). These are deliberately absent from
// sopResolver.buildTokenMap, so they never reach the authoring picker and never
// get baked into tasks.sop_content at case creation — a snapshot that would go
// stale the moment the contact changed. Fill-time only.
//
// NOT EMAIL RECIPIENTS (D13). isEmailValuedToken() gates on the entity families
// resolution holds a row for, so a contact email never qualifies however it is
// spelled; a contact is a value you type into a form, not someone the system
// emails.
import type { Party, PartyRoleKey } from "@/types";
import { composeFullName } from "@/lib/personName";

/** The three roles that carry a token family, and the family prefix each one
 * emits. Adding a fourth is one entry here plus its ACKNOWLEDGED classification
 * in quickCardCatalog. */
export const CONTACT_TOKEN_FAMILIES: ReadonlyArray<{ roleKey: PartyRoleKey; prefix: string }> = [
  { roleKey: "billing_contact", prefix: "billingContact" },
  { roleKey: "credentialing_contact", prefix: "credentialingContact" },
  { roleKey: "contracting_signer", prefix: "contractingSigner" },
];

/** The field set every family emits. `fullName` is a COMPOSITE (D6 follow-on):
 * a payer form with one name box gets a single token instead of forcing
 * mapping-time concatenation, which portal_field_maps cannot express (one token
 * per row). Precedent: buildTokenMap already emits facility.address that way. */
export const CONTACT_TOKEN_FIELDS: ReadonlyArray<{
  field: string;
  read: (p: Party) => string | null;
}> = [
  { field: "firstName", read: (p) => p.firstName },
  { field: "lastName", read: (p) => p.lastName },
  { field: "fullName", read: (p) => composeFullName(p) || p.name || null },
  { field: "title", read: (p) => p.title },
  { field: "email", read: (p) => p.email },
  { field: "phoneOffice", read: (p) => p.phoneOffice },
  { field: "phoneExtension", read: (p) => p.phoneExtension },
  { field: "phoneMobile", read: (p) => p.phoneMobile },
  { field: "fax", read: (p) => p.fax },
  { field: "addressLine1", read: (p) => p.addressLine1 },
  { field: "addressLine2", read: (p) => p.addressLine2 },
  { field: "city", read: (p) => p.city },
  { field: "state", read: (p) => p.state },
  { field: "postalCode", read: (p) => p.postalCode },
  { field: "country", read: (p) => p.country },
];

export interface ResolvedToken {
  token: string;
  value: string | null;
}

export interface UnresolvedToken {
  token: string;
  reason: string;
}

/** Every key this family emits, in a stable order (families outer, fields
 * inner). The quick-card catalog and the profile response both read this. */
export function orgContactTokenKeys(): string[] {
  const keys: string[] = [];
  for (const family of CONTACT_TOKEN_FAMILIES) {
    for (const { field } of CONTACT_TOKEN_FIELDS) keys.push(`${family.prefix}.${field}`);
  }
  return keys;
}

/** Human label for a role's family, used by the field picker. */
export function contactFamilyLabel(prefix: string): string {
  switch (prefix) {
    case "billingContact":
      return "Billing contact";
    case "credentialingContact":
      return "Credentialing contact";
    case "contractingSigner":
      return "Contracting signer";
    default:
      return prefix;
  }
}

/**
 * Resolve every contact token against the org's DEFAULT holder per role.
 *
 * A role with no default holder resolves every one of its tokens to null with an
 * honest reason — never a guess, and never silently omitted, so the extension's
 * unresolved list tells a coordinator exactly which contact to go fill in. Same
 * for a holder whose individual field is blank.
 */
export function resolveOrgContactTokens(defaultsByRole: Map<PartyRoleKey, Party | null>): {
  tokens: ResolvedToken[];
  unresolved: UnresolvedToken[];
} {
  const tokens: ResolvedToken[] = [];
  const unresolved: UnresolvedToken[] = [];

  for (const family of CONTACT_TOKEN_FAMILIES) {
    const party = defaultsByRole.get(family.roleKey) ?? null;
    for (const { field, read } of CONTACT_TOKEN_FIELDS) {
      const token = `${family.prefix}.${field}`;
      if (!party) {
        tokens.push({ token, value: null });
        unresolved.push({
          token,
          reason: `no default ${contactFamilyLabel(family.prefix).toLowerCase()} set for this organization`,
        });
        continue;
      }
      const raw = read(party);
      const value = typeof raw === "string" && raw.trim() ? raw.trim() : null;
      tokens.push({ token, value });
      if (value === null) {
        unresolved.push({
          token,
          reason: `${contactFamilyLabel(family.prefix)} has no ${field} on file`,
        });
      }
    }
  }

  return { tokens, unresolved };
}
