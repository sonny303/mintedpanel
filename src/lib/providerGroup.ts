// Pure provider-group entity helpers (E1.1 TE-5/TE-7). Format-level-only
// validation in v1 (no external TIN/NPI registry check — deferred to R5),
// mirroring the contactValidation/stateCode pattern. The address+contact
// blocks are BLOCK-SHAPED here — one object per purpose (billing /
// correspondence / credentialing) folded to the flat `provider_groups`
// columns in this single mapping module — so the planned post-R1
// `group_addresses`/`group_contacts` normalization repoints one boundary
// instead of rewriting the form (table-register sprawl-target note).
import type { ProviderGroup } from "@/types";
import type { ProviderGroupInput } from "@/services/orgSettings";

// ---------- TIN / NPI (format-level only, v1) ----------

/** Strip everything but digits (TIN is stored as bare digits). */
export function normalizeTin(value: string): string {
  return value.replace(/\D/g, "");
}

/** 9 digits, displayed XX-XXXXXXX; anything else renders as typed. */
export function formatTin(value: string | null | undefined): string {
  const digits = normalizeTin(value ?? "");
  if (digits.length !== 9) return value ?? "";
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export function isValidTin(value: string): boolean {
  return normalizeTin(value).length === 9;
}

export function normalizeNpi(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidNpi(value: string): boolean {
  return normalizeNpi(value).length === 10;
}

/** Trim; prefix https:// when the value has no scheme. Empty → "". */
export function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isValidWebsiteUrl(value: string): boolean {
  const normalized = normalizeWebsiteUrl(value);
  if (!normalized) return true;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------- address + contact blocks ----------

export type GroupBlockKey = "billing" | "correspondence" | "credentialing";

export interface GroupContactBlock {
  street: string;
  suite: string;
  city: string;
  state: string;
  zip: string;
  contactName: string;
  phone: string;
  fax: string;
  email: string;
}

export const EMPTY_GROUP_BLOCK: GroupContactBlock = {
  street: "",
  suite: "",
  city: "",
  state: "",
  zip: "",
  contactName: "",
  phone: "",
  fax: "",
  email: "",
};

export interface GroupFormValue {
  name: string;
  tin: string;
  npiType2: string;
  states: string[];
  websiteUrl: string;
  billing: GroupContactBlock;
  correspondence: GroupContactBlock;
  credentialing: GroupContactBlock;
}

export const EMPTY_GROUP_FORM: GroupFormValue = {
  name: "",
  tin: "",
  npiType2: "",
  states: [],
  websiteUrl: "",
  billing: EMPTY_GROUP_BLOCK,
  correspondence: EMPTY_GROUP_BLOCK,
  credentialing: EMPTY_GROUP_BLOCK,
};

const s = (v: string | null | undefined): string => v ?? "";

/** A saved row → editable block-shaped form value. */
export function groupToFormValue(g: ProviderGroup): GroupFormValue {
  return {
    name: g.name,
    tin: formatTin(g.tin),
    npiType2: s(g.npiType2),
    states: g.states ?? [],
    websiteUrl: s(g.websiteUrl),
    billing: {
      street: s(g.billingStreet),
      suite: s(g.billingSuite),
      city: s(g.billingCity),
      state: s(g.billingState),
      zip: s(g.billingZip),
      contactName: s(g.billingContactName),
      phone: s(g.billingPhone),
      fax: s(g.billingFax),
      email: s(g.billingEmail),
    },
    correspondence: {
      street: s(g.correspondenceStreet),
      suite: s(g.correspondenceSuite),
      city: s(g.correspondenceCity),
      state: s(g.correspondenceState),
      zip: s(g.correspondenceZip),
      contactName: s(g.correspondenceContactName),
      phone: s(g.correspondencePhone),
      fax: s(g.correspondenceFax),
      email: s(g.correspondenceEmail),
    },
    credentialing: {
      street: s(g.credentialingStreet),
      suite: s(g.credentialingSuite),
      city: s(g.credentialingCity),
      state: s(g.credentialingState),
      zip: s(g.credentialingZip),
      contactName: s(g.credentialingContactName),
      phone: s(g.credentialingPhone),
      fax: s(g.credentialingFax),
      email: s(g.credentialingEmail),
    },
  };
}

const t = (v: string): string | null => v.trim() || null;

/** Block-shaped form value → the flat service input (single fold point). */
export function formValueToInput(v: GroupFormValue): ProviderGroupInput {
  return {
    name: v.name.trim(),
    tin: normalizeTin(v.tin) || null,
    npiType2: normalizeNpi(v.npiType2) || null,
    states: v.states.length > 0 ? v.states : null,
    websiteUrl: t(normalizeWebsiteUrl(v.websiteUrl)),
    billingStreet: t(v.billing.street),
    billingSuite: t(v.billing.suite),
    billingCity: t(v.billing.city),
    billingState: t(v.billing.state),
    billingZip: t(v.billing.zip),
    billingContactName: t(v.billing.contactName),
    billingPhone: t(v.billing.phone),
    billingFax: t(v.billing.fax),
    billingEmail: t(v.billing.email),
    correspondenceStreet: t(v.correspondence.street),
    correspondenceSuite: t(v.correspondence.suite),
    correspondenceCity: t(v.correspondence.city),
    correspondenceState: t(v.correspondence.state),
    correspondenceZip: t(v.correspondence.zip),
    correspondenceContactName: t(v.correspondence.contactName),
    correspondencePhone: t(v.correspondence.phone),
    correspondenceFax: t(v.correspondence.fax),
    correspondenceEmail: t(v.correspondence.email),
    credentialingStreet: t(v.credentialing.street),
    credentialingSuite: t(v.credentialing.suite),
    credentialingCity: t(v.credentialing.city),
    credentialingState: t(v.credentialing.state),
    credentialingZip: t(v.credentialing.zip),
    credentialingContactName: t(v.credentialing.contactName),
    credentialingPhone: t(v.credentialing.phone),
    credentialingFax: t(v.credentialing.fax),
    credentialingEmail: t(v.credentialing.email),
  };
}

// ---------- validation (F1.1.1 acceptance criteria) ----------

export interface GroupFormErrors {
  name?: string;
  tin?: string;
  npiType2?: string;
  states?: string;
  websiteUrl?: string;
  billingStreet?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingEmail?: string;
}

// Required: legal name, TIN (9 digits), ≥1 operating state, and the billing
// address (the required block; correspondence/credentialing are optional with
// a same-as-billing quick-fill). Type 2 NPI is optional but must be 10 digits
// when present.
export function groupFormErrors(v: GroupFormValue): GroupFormErrors {
  const e: GroupFormErrors = {};
  if (!v.name.trim()) e.name = "Legal name is required";
  if (!v.tin.trim()) e.tin = "TIN is required";
  else if (!isValidTin(v.tin)) e.tin = "TIN must be 9 digits";
  if (v.npiType2.trim() && !isValidNpi(v.npiType2)) e.npiType2 = "Type 2 NPI must be 10 digits";
  if (v.states.length === 0) e.states = "Select at least one operating state";
  if (v.websiteUrl.trim() && !isValidWebsiteUrl(v.websiteUrl)) {
    e.websiteUrl = "Enter a valid website URL";
  }
  if (!v.billing.street.trim()) e.billingStreet = "Billing street is required";
  if (!v.billing.city.trim()) e.billingCity = "Billing city is required";
  if (!v.billing.state.trim()) e.billingState = "Billing state is required";
  if (!v.billing.zip.trim()) e.billingZip = "Billing ZIP is required";
  return e;
}

export function hasGroupFormErrors(e: GroupFormErrors): boolean {
  return Object.keys(e).length > 0;
}
