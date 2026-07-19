// E6.5 F6.5.3 — the mock-data fill profile for in-editor dry runs.
//
// A dry run proves the MAPPING (every live field map resolves to a value), not
// any provider's data. It therefore fills from this versioned synthetic
// profile and NEVER reads provider/group/facility tables — no PHI is involved,
// no designated test-provider row is required (the F4.2.7 test-provider seam
// this replaces), and a mapped token can never come back empty_token, so
// "pass" reduces to exactly "zero unmapped fields".
//
// Values are deliberately, visibly fake (a real form filled from this profile
// would read "Sample …" everywhere). Bump MOCK_FILL_PROFILE_VERSION when the
// curated values or the heuristics change materially — recorded dry runs are
// interpreted against the profile that produced them.

export const MOCK_FILL_PROFILE_VERSION = 1;

// Curated values for the common catalog tokens (bare form, the extension join
// contract). Everything else falls through to the field-name heuristics below.
export const MOCK_FILL_VALUES: Readonly<Record<string, string>> = {
  "provider.firstName": "Sample",
  "provider.lastName": "Provider",
  "provider.email": "sample.provider@example.com",
  "provider.phone": "5555550100",
  "provider.npi": "1999999984",
  "provider.caqhId": "12345678",
  "provider.caqhLastAttestedDate": "2026-01-15",
  "provider.taxonomyCode": "225100000X",
  "provider.deaNumber": "AB1234563",
  "provider.specialty": "Physical Therapy",
  "provider.credentials": "PT, DPT",
  "provider.dateOfBirth": "1980-01-15",
  "provider.ssnLast4": "0000",
  "provider.homeStreet": "123 Sample St",
  "provider.homeCity": "Sampleville",
  "provider.homeState": "NC",
  "provider.homeZip": "27601",
  "provider.startDate": "2026-01-15",
  "provider.licenseNumber": "SAMPLE-12345",
  "license.licenseNumber": "SAMPLE-12345",
  "license.state": "NC",
  "license.licenseType": "PT",
  "license.issueDate": "2020-01-15",
  "license.expirationDate": "2027-01-15",
  "group.name": "Sample Provider Group",
  "group.tin": "123456789",
  "group.npi": "1999999984",
  "facility.name": "Sample Clinic",
  "facility.street": "456 Sample Ave",
  "facility.city": "Sampleville",
  "facility.state": "NC",
  "facility.zip": "27601",
  "user.name": "Sample Operator",
  "user.email": "sample.operator@example.com",
};

// Field-name heuristics for tokens outside the curated map, keyed on the part
// after the last dot (camelCase). Deterministic; always non-empty.
export function mockValueForToken(token: string): string {
  const curated = MOCK_FILL_VALUES[token];
  if (curated) return curated;
  const field = token.slice(token.lastIndexOf(".") + 1);
  const lower = field.toLowerCase();
  if (lower.includes("date")) return "2026-01-15";
  if (lower.includes("email")) return "sample@example.com";
  if (lower.includes("phone") || lower.includes("fax")) return "5555550100";
  if (lower === "state" || lower.endsWith("state")) return "NC";
  if (lower.includes("zip")) return "27601";
  if (lower.includes("npi")) return "1999999984";
  const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `Sample ${words}`;
}

/** Build the resolved-token record a dry run feeds computeTestRun — one entry
 * per distinct mapped token, every value synthetic and non-empty. */
export function buildMockTokenMap(
  tokens: Iterable<string | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tokens) {
    const token = t?.trim();
    if (!token || out[token]) continue;
    out[token] = mockValueForToken(token);
  }
  return out;
}
