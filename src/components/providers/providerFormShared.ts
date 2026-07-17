// Shared constants, types, and validation for Add/Edit provider forms.
// Owned by ProviderForm.tsx and EditProviderForm.tsx.
import { isPtTaxonomyCode } from "@/lib/ptTaxonomy";

// Re-export the single mastered state list (src/lib/usStates.ts) rather than
// keep a second copy in sync — the provider Add/Edit forms and LaunchEditModal
// import US_STATES from here.
export { US_STATES } from "@/lib/usStates";

export const SSN_LAST4_RE = /^\d{4}$/;
export const NPI_RE = /^1\d{9}$/;
export const CAQH_RE = /^\d{8}$/;
export const EMAIL_RE = /^\S+@\S+\.\S+$/;

export interface LicenseRow {
  state: string;
  number: string;
  type: "full" | "compact" | "";
  issueDate: string;
  expirationDate: string;
}

export interface ProviderFormState {
  firstName: string;
  lastName: string;
  credentials: string;
  dateOfBirth: string;
  ssnLast4: string;
  email: string;
  phone: string;
  homeStreet: string;
  homeCity: string;
  homeState: string;
  homeZip: string;
  npi: string;
  caqhId: string;
  isNewGrad: boolean;
  caqhLastAttestedDate: string;
  taxonomyCode: string;
  deaNumber: string;
  licenses: LicenseRow[];
  groupId: string;
  facilityIds: string[];
  specialty: string;
  startDate: string;
  degree: string;
  schoolName: string;
  graduationDate: string;
  malpracticeCarrier: string;
  malpracticePolicyNumber: string;
  malpracticeCoverageStart: string;
  malpracticeCoverageEnd: string;
}

export const emptyProviderFormState: ProviderFormState = {
  firstName: "",
  lastName: "",
  credentials: "",
  dateOfBirth: "",
  ssnLast4: "",
  email: "",
  phone: "",
  homeStreet: "",
  homeCity: "",
  homeState: "",
  homeZip: "",
  npi: "",
  caqhId: "",
  isNewGrad: false,
  caqhLastAttestedDate: "",
  taxonomyCode: "225100000X",
  deaNumber: "",
  licenses: [{ state: "", number: "", type: "", issueDate: "", expirationDate: "" }],
  groupId: "",
  facilityIds: [],
  specialty: "",
  startDate: "",
  degree: "",
  schoolName: "",
  graduationDate: "",
  malpracticeCarrier: "",
  malpracticePolicyNumber: "",
  malpracticeCoverageStart: "",
  malpracticeCoverageEnd: "",
};

export type ProviderFormErrors = Partial<Record<string, string>>;

export type UpdateProviderField = <K extends keyof ProviderFormState>(
  key: K,
  value: ProviderFormState[K],
) => void;

export function emptyLicenseRow(): LicenseRow {
  return { state: "", number: "", type: "", issueDate: "", expirationDate: "" };
}

export function validateNames(f: ProviderFormState): ProviderFormErrors {
  const e: ProviderFormErrors = {};
  if (!f.firstName.trim()) e.firstName = "Required";
  if (!f.lastName.trim()) e.lastName = "Required";
  return e;
}

export function validatePersonal(f: ProviderFormState): ProviderFormErrors {
  const e: ProviderFormErrors = { ...validateNames(f) };
  if (f.ssnLast4 && !SSN_LAST4_RE.test(f.ssnLast4)) e.ssnLast4 = "Enter exactly 4 digits";
  if (f.email && !EMAIL_RE.test(f.email)) e.email = "Invalid email";
  return e;
}

export function validateCredentials(f: ProviderFormState): ProviderFormErrors {
  const e: ProviderFormErrors = {};
  if (f.npi && !NPI_RE.test(f.npi)) e.npi = "NPI must be 10 digits and start with 1";
  if (!f.isNewGrad && f.caqhId && !CAQH_RE.test(f.caqhId)) e.caqhId = "CAQH must be 8 digits";
  if (f.taxonomyCode && !isPtTaxonomyCode(f.taxonomyCode))
    e.taxonomyCode = "Must be a PT/PTA taxonomy code (225X series)";
  return e;
}

export function validateAll(f: ProviderFormState): ProviderFormErrors {
  return { ...validatePersonal(f), ...validateCredentials(f) };
}
