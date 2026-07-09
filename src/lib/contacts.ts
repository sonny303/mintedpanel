// Shared CRM-contact constants (E0.2). The Zeb default mirrors the
// create_organization RPC's server-side sales-rep default and the redesign seed
// — keep the three in sync (like canonicalStatuses mirrors the RPC).
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

// Zeb Loewenstine — the sales rep pre-filled on every new org (E0.2 FR-1).
export const DEFAULT_SALES_REP: ContactInput = {
  name: "Zeb Loewenstine",
  email: "zeb@mintedpanel.example.test",
  phoneOffice: "704-555-0100",
  phoneMobile: "",
  addressLine1: "101 S Tryon St",
  addressLine2: "Suite 400",
  city: "Charlotte",
  state: "NC",
  postalCode: "28280",
  country: "US",
};

// Display labels for the governed role list (mirrors party_role_types.label).
// E0.3's role picker reads the live reference table; this covers E0.2 display.
export const PARTY_ROLE_LABELS: Record<PartyRoleKey, string> = {
  owner: "Owner",
  customer_escalation_contact: "Customer Escalation Contact",
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
