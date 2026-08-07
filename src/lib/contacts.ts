// Shared CRM-contact constants (E0.2). NB there is deliberately NO default sales
// rep here anymore: intake used to pre-fill (and the RPC used to substitute) a
// placeholder person, which put an unasked-for Sales Rep on every new org's
// People list. A sales rep is added through the People surface like any other
// party — see migration 20260807120000_org_intake_no_default_sales_rep.sql.
import type { ContactInput, Party, PartyRoleKey } from "@/types";

export const EMPTY_CONTACT: ContactInput = {
  name: "",
  email: "",
  phoneOffice: "",
  phoneMobile: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

// Display labels for the governed role list (mirrors party_role_types.label).
// E0.3's role picker reads the live reference table; this covers E0.2 display.
// Static fallback labels — the LIVE governed list (party_role_types.label) is
// consulted first wherever chips render; this map mirrors it (migration
// 20260721120000 aligned owner/customer with the E0.8 terminology).
export const PARTY_ROLE_LABELS: Record<PartyRoleKey, string> = {
  owner: "Authorized contact",
  customer_escalation_contact: "Organization contact",
  sales_rep: "Sales Rep",
  billing_contact: "Billing Contact",
  contracting_signer: "Contracting Signer",
  credentialing_contact: "Credentialing Contact",
};

// Party (nullable columns) → an editable ContactInput (empty strings, not null).
export function partyToContactInput(p: Party): ContactInput {
  return {
    name: p.name ?? "",
    email: p.email ?? "",
    phoneOffice: p.phoneOffice ?? "",
    phoneMobile: p.phoneMobile ?? "",
    addressLine1: p.addressLine1 ?? "",
    addressLine2: p.addressLine2 ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    postalCode: p.postalCode ?? "",
    country: p.country ?? "US",
  };
}
