import type { RosterGrain, RosterSourceField, RosterTransform, RosterValueType } from "@/types";

export const ROSTER_SOURCE_FIELDS: ReadonlyArray<{
  value: RosterSourceField;
  label: string;
  source: string;
}> = [
  { value: "provider.first_name", label: "First name", source: "providers.first_name" },
  { value: "provider.last_name", label: "Last name", source: "providers.last_name" },
  { value: "provider.npi", label: "Individual NPI", source: "providers.npi" },
  { value: "provider.taxonomy_code", label: "Taxonomy", source: "providers.taxonomy_code" },
  { value: "provider.date_of_birth", label: "Date of birth", source: "providers.date_of_birth" },
  { value: "provider.ssn_last4", label: "SSN last 4", source: "providers.ssn_last4" },
  { value: "facility.name", label: "Practice name", source: "facilities.name" },
  { value: "facility.street", label: "Practice address", source: "facilities.street" },
  { value: "facility.suite", label: "Address suite", source: "facilities.suite" },
  { value: "facility.city", label: "Practice city", source: "facilities.city" },
  { value: "facility.state", label: "Practice state", source: "facilities.state" },
  { value: "facility.zip", label: "Practice ZIP", source: "facilities.zip" },
  { value: "facility.phone", label: "Practice phone", source: "facilities.phone" },
  { value: "group.name", label: "Group legal name", source: "provider_groups.name" },
  { value: "group.npi_type2", label: "Group NPI", source: "provider_groups.npi_type2" },
  { value: "group.tin", label: "Billing TIN", source: "facilities.group_id → provider_groups.tin" },
  {
    value: "license.license_number",
    label: "State license number",
    source: "state_licenses.license_number",
  },
  { value: "license.issue_date", label: "License issue date", source: "state_licenses.issue_date" },
  {
    value: "license.expiration_date",
    label: "License expiration",
    source: "state_licenses.expiration_date",
  },
];

export const ROSTER_TRANSFORM_OPTIONS: ReadonlyArray<{ value: RosterTransform; label: string }> = [
  { value: "uppercase", label: "Uppercase" },
  { value: "date_yyyy_mm_dd", label: "Date: YYYY-MM-DD" },
  { value: "date_mm_dd_yyyy", label: "Date: MM/DD/YYYY" },
  { value: "phone_strip", label: "Phone digits only" },
  { value: "npi_check", label: "Validate NPI format" },
];

export const ROSTER_GRAIN_LABELS: Readonly<Record<RosterGrain, string>> = {
  provider: "Provider",
  provider_location: "Provider + location",
  provider_location_tin: "Provider + location + TIN",
};

const TRANSFORMS_BY_TYPE: Readonly<Record<RosterValueType, readonly RosterTransform[]>> = {
  text: ["uppercase"],
  date: ["date_yyyy_mm_dd", "date_mm_dd_yyyy"],
  phone: ["phone_strip"],
  npi: ["npi_check"],
  zip_plus_4: [],
};

export function getRosterTransformsForTarget(targetType: RosterValueType): RosterTransform[] {
  return [...(TRANSFORMS_BY_TYPE[targetType] ?? [])];
}

const SOURCE_FIELDS_BY_TYPE: Readonly<Record<RosterValueType, readonly RosterSourceField[]>> = {
  text: [
    "provider.first_name",
    "provider.last_name",
    "provider.taxonomy_code",
    "provider.ssn_last4",
    "facility.name",
    "facility.street",
    "facility.suite",
    "facility.city",
    "facility.state",
    "group.name",
    "group.tin",
    "license.license_number",
  ],
  date: ["provider.date_of_birth", "license.issue_date", "license.expiration_date"],
  phone: ["facility.phone"],
  npi: ["provider.npi", "group.npi_type2"],
  zip_plus_4: ["facility.zip"],
};

export function getRosterSourceFieldsForTarget(targetType: RosterValueType): RosterSourceField[] {
  const supported = new Set(SOURCE_FIELDS_BY_TYPE[targetType] ?? []);
  return ROSTER_SOURCE_FIELDS.filter((field) => supported.has(field.value)).map(
    (field) => field.value,
  );
}

export function isRosterSourceCompatibleWithTarget(
  sourceField: RosterSourceField,
  targetType: RosterValueType,
): boolean {
  return (SOURCE_FIELDS_BY_TYPE[targetType] ?? []).includes(sourceField);
}

export function isValidNpi(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const digits = String(value).trim();
  if (!/^\d{10}$/.test(digits)) return false;
  // NPI's Luhn check digit is calculated with the CMS 80840 prefix.
  const prefixed = `80840${digits.slice(0, 9)}`;
  let sum = Number(digits[9]);
  let double = true;
  for (let index = prefixed.length - 1; index >= 0; index -= 1) {
    let digit = Number(prefixed[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function formatRosterDate(
  value: unknown,
  transform: "date_yyyy_mm_dd" | "date_mm_dd_yyyy",
): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  let iso = raw;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us) iso = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  if (!validIsoDate(iso)) return null;
  if (transform === "date_yyyy_mm_dd") return iso;
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

export function transformRosterValue(
  value: unknown,
  transform: RosterTransform | null,
): string | null {
  if (value == null || value === "") return null;
  const raw = String(value);
  switch (transform) {
    case "uppercase":
      return raw.toLocaleUpperCase("en-US");
    case "date_yyyy_mm_dd":
    case "date_mm_dd_yyyy":
      return formatRosterDate(raw, transform);
    case "phone_strip":
      return raw.replace(/\D/g, "");
    case "npi_check":
      return raw.trim();
    default:
      return raw;
  }
}

export function isZipPlus4(value: unknown): boolean {
  return typeof value === "string" && /^\d{5}-\d{4}$/.test(value.trim());
}

export function isSsnLast4(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

export function getRosterSourceValue(source: unknown, field: RosterSourceField): unknown {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const [root, key] = field.split(".");
  const rootValue = (source as Record<string, unknown>)[root];
  if (root === "license") {
    const licenseRows = (source as Record<string, unknown>).licenses;
    if (!Array.isArray(licenseRows)) return null;
    const license = licenseRows.find(
      (entry) => !!entry && typeof entry === "object" && !Array.isArray(entry),
    );
    if (!license) return null;
    const fieldMap: Record<string, string> = {
      license_number: "license_number",
      issue_date: "issue_date",
      expiration_date: "expiration_date",
    };
    return (license as Record<string, unknown>)[fieldMap[key] ?? key];
  }
  if (!rootValue || typeof rootValue !== "object" || Array.isArray(rootValue)) return null;
  const fieldMap: Record<string, string> = {
    date_of_birth: "date_of_birth",
    taxonomy_code: "taxonomy_code",
    npi_type2: "npi_type2",
    ssn_last4: "ssn_last4",
  };
  const value = (rootValue as Record<string, unknown>)[fieldMap[key] ?? key] ?? null;
  if (field === "provider.ssn_last4") return isSsnLast4(value) ? value : null;
  return value;
}
