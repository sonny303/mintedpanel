// The provider fields the Fix-it queue can collect inline (Surface 1). Scoped
// to the provider.* tokens that map to columns present in the provider LIST
// projection (src/services/providers.ts PROVIDER_LIST_COLUMNS) — reading a
// column the list omits would read undefined and flag a gap for everyone.
// PHI-entry fields (ssn_last4, DOB, home address) deliberately stay on the
// full provider form, never here.
import type { Provider } from "@/types";
import type { ProviderInput } from "@/services/providers";

export interface FixitFieldDef {
  // Provider camelCase key — also the ProviderInput patch key.
  column: keyof Provider & keyof ProviderInput;
  label: string;
  placeholder: string;
  hint: string;
  inputType?: "text" | "date";
  validate?: (value: string) => string | null;
}

// Keyed by the BARE token (provider.<field>).
export const FIXIT_FIELDS: Record<string, FixitFieldDef> = {
  "provider.caqhId": {
    column: "caqhId",
    label: "CAQH ID",
    placeholder: "e.g. 14382950",
    hint: "From CAQH ProView → provider record. Saves straight to the provider profile.",
    validate: (v) => (/^\d{6,12}$/.test(v.trim()) ? null : "CAQH IDs are 6–12 digits."),
  },
  "provider.npi": {
    column: "npi",
    label: "Individual NPI",
    placeholder: "10-digit NPI",
    hint: "The provider's individual (type 1) NPI.",
    validate: (v) => (/^\d{10}$/.test(v.trim()) ? null : "An NPI is exactly 10 digits."),
  },
  "provider.taxonomyCode": {
    column: "taxonomyCode",
    label: "Taxonomy code",
    placeholder: "e.g. 2251X0800X",
    hint: "The NUCC provider taxonomy code for this specialty.",
  },
  "provider.caqhLastAttestedDate": {
    column: "caqhLastAttestedDate",
    label: "CAQH last attested",
    placeholder: "YYYY-MM-DD",
    hint: "The most recent CAQH attestation date.",
    inputType: "date",
  },
  "provider.email": {
    column: "email",
    label: "Email",
    placeholder: "name@practice.com",
    hint: "The provider's work email, used on enrollment forms.",
    validate: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? null : "Enter a valid email."),
  },
};

export function hasProviderValue(provider: Provider, token: string): boolean {
  if (!token.startsWith("provider.")) return true; // out of v1 gap scope → treat as present
  const key = token.slice("provider.".length);
  const value = (provider as unknown as Record<string, unknown>)[key];
  return value !== null && value !== undefined && String(value).trim() !== "";
}
