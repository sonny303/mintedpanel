import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CASE_SCOPED_TOKEN_TABLES,
  QUICK_CARD_EXCLUDED_FIELDS,
  QUICK_CARD_TABLE_PREFIXES,
  TOKEN_CATALOG_SKIPPED_COLUMNS,
  USER_TOKEN_FIELDS,
  buildQuickCardCatalog,
  humanizeTokenField,
  isOfferedToken,
  validateQuickCardFields,
  type TokenCatalogEntry,
} from "./quickCardCatalog";

// --- Schema-drift guard -----------------------------------------------------
//
// get_sop_field_tokens() is NOT a curated list: it reads
// information_schema.columns over nine named tables and drops only keys/FKs/
// status columns. So any column added to one of the six non-case-scoped tables
// automatically becomes a token — and, under this file's derive-then-exclude
// rule, would automatically become a selectable quick-card field with no human
// in the loop.
//
// This block is what makes the deny-list safe. It reconstructs the token set
// the RPC would emit from the CHECKED-IN generated types (regenerated from live
// after every DDL, per the CLAUDE.md ritual) and asserts every token is
// explicitly classified — offered, or named in QUICK_CARD_EXCLUDED_FIELDS.
// Add a column and regenerate types, and this test fails until someone decides
// whether the field belongs on a card. That is the intended workflow, not an
// inconvenience: do not "fix" a failure by deleting the assertion.

const TYPES_PATH = fileURLToPath(new URL("../integrations/supabase/types.ts", import.meta.url));
const TYPES_SOURCE = readFileSync(TYPES_PATH, "utf8");

/** Pull one table's Row column names out of the generated types file. */
function rowColumns(table: string): string[] {
  const match = TYPES_SOURCE.match(
    new RegExp(`\\n {6}${table}: \\{\\n {8}Row: \\{\\n([\\s\\S]*?)\\n {8}\\};`),
  );
  if (!match) {
    throw new Error(
      `could not find a Row block for "${table}" in types.ts — the generated file's shape changed, or the table was renamed/dropped`,
    );
  }
  const columns: string[] = [];
  for (const line of match[1].split("\n")) {
    const col = line.match(/^\s{10}([a-z0-9_]+)\??:/);
    if (col) columns.push(col[1]);
  }
  if (columns.length === 0) throw new Error(`parsed zero columns for "${table}"`);
  return columns;
}

/** Postgres initcap-per-part camelisation, mirroring the RPC body exactly. */
function snakeToCamel(column: string): string {
  const parts = column.split("_");
  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join("")
  );
}

/** The tokens get_sop_field_tokens() would emit for the six card-eligible
 * tables, derived from the generated schema types. */
function derivedTokens(): { table: string; token: string; column: string }[] {
  const skipped = new Set(TOKEN_CATALOG_SKIPPED_COLUMNS);
  const out: { table: string; token: string; column: string }[] = [];
  for (const [table, prefix] of Object.entries(QUICK_CARD_TABLE_PREFIXES)) {
    for (const column of rowColumns(table)) {
      if (skipped.has(column)) continue;
      out.push({ table, token: `${prefix}.${snakeToCamel(column)}`, column });
    }
  }
  return out;
}

/** SNAPSHOT of every token get_sop_field_tokens() emits for the six
 * card-eligible tables, as of the current schema. This list is the ACKNOWLEDGED
 * set: its only job is to force a human decision when the schema changes.
 *
 * Why it exists: "offered = everything minus the exclusions" is circular — a
 * brand-new column would satisfy it automatically, which is precisely the hole
 * a deny-list opens. Pinning the known tokens here means a new column makes the
 * first test below fail with the token named, and whoever regenerated types.ts
 * has to decide: put it on cards (add it here), or keep it off (add it here AND
 * to QUICK_CARD_EXCLUDED_FIELDS).
 *
 * Regenerate by listing the non-case-scoped tokens:
 *   select token from jsonb_to_recordset(get_sop_field_tokens())
 *     as t("table" text, token text, "column" text)
 *   where "table" not in ('payers','msos','contracts') order by token;
 */
const ACKNOWLEDGED_TOKENS: readonly string[] = [
  // providers
  "provider.additionalCertifications",
  "provider.ageGroupsServed",
  "provider.boardCertified",
  "provider.caqhId",
  "provider.caqhLastAttestedDate",
  "provider.credentials",
  "provider.culturalCompetencyTraining",
  "provider.dateOfBirth",
  "provider.deaExpirationDate",
  "provider.deaNumber",
  "provider.degree",
  "provider.email",
  "provider.ethnicity",
  "provider.firstName",
  "provider.gender",
  "provider.graduationDate",
  "provider.homeCity",
  "provider.homeState",
  "provider.homeStreet",
  "provider.homeZip",
  "provider.isTestProvider",
  "provider.languages",
  "provider.lastName",
  "provider.launchId",
  "provider.licenseExpirationDate",
  "provider.licenseIssueDate",
  "provider.licenseNumber",
  "provider.licenseState",
  "provider.malpracticeCarrier",
  "provider.malpracticeCoverageEnd",
  "provider.malpracticeCoverageStart",
  "provider.malpracticePolicyNumber",
  "provider.medicaidAttested",
  "provider.middleInitial",
  "provider.npi",
  "provider.phone",
  "provider.referenceOnly",
  "provider.schoolName",
  "provider.specialty",
  "provider.ssnLast4",
  "provider.startDate",
  "provider.subSpecialty",
  "provider.suffix",
  "provider.taxonomyCode",
  "provider.terminatedDate",
  "provider.verificationState",
  // provider_groups
  "group.billingCity",
  "group.billingContactName",
  "group.billingEmail",
  "group.billingFax",
  "group.billingPhone",
  "group.billingState",
  "group.billingStreet",
  "group.billingSuite",
  "group.billingZip",
  "group.contractSignerEmail",
  "group.contractSignerName",
  "group.contractingContactEmail",
  "group.contractingContactName",
  "group.contractingContactTitle",
  "group.correspondenceCity",
  "group.correspondenceContactName",
  "group.correspondenceEmail",
  "group.correspondenceFax",
  "group.correspondencePhone",
  "group.correspondenceState",
  "group.correspondenceStreet",
  "group.correspondenceSuite",
  "group.correspondenceZip",
  "group.credentialingCity",
  "group.credentialingContactName",
  "group.credentialingEmail",
  "group.credentialingFax",
  "group.credentialingPhone",
  "group.credentialingState",
  "group.credentialingStreet",
  "group.credentialingSuite",
  "group.credentialingZip",
  "group.name",
  "group.npiType2",
  "group.preferredContactMethod",
  "group.states",
  "group.taxIdType",
  "group.tin",
  "group.websiteUrl",
  // facilities
  "facility.acceptingNewPatients",
  "facility.adaCompliance",
  "facility.appointmentPhone",
  "facility.city",
  "facility.contactName",
  "facility.county",
  "facility.effectiveDate",
  "facility.email",
  "facility.fax",
  "facility.hours",
  "facility.interpreterLanguages",
  "facility.languageLine",
  "facility.languagesOffered",
  "facility.name",
  "facility.phone",
  "facility.referenceOnly",
  "facility.serviceTypes",
  "facility.state",
  "facility.statusId",
  "facility.street",
  "facility.suite",
  "facility.treatingCategories",
  "facility.zip",
  // state_licenses
  "license.expirationDate",
  "license.issueDate",
  "license.licenseNumber",
  "license.licenseType",
  "license.state",
  "license.verificationSourceUrl",
  "license.verifiedAt",
  "license.verifiedBy",
  "license.verifiedStatus",
  // provider_facility_assignments
  "assignment.isPrimary",
  "assignment.practiceFrequency",
  "assignment.startDate",
  // group_insurance_policies
  "groupInsurance.insuranceType",
  "groupInsurance.insurerName",
  "groupInsurance.notes",
  "groupInsurance.policyEndDate",
  "groupInsurance.policyNumber",
  "groupInsurance.policyStartDate",
];

describe("quick-card catalog — schema drift guard", () => {
  it("finds every card-eligible table in the generated types", () => {
    for (const table of Object.keys(QUICK_CARD_TABLE_PREFIXES)) {
      expect(() => rowColumns(table), `${table} missing from types.ts`).not.toThrow();
    }
  });

  it("matches the acknowledged token snapshot (fails when the schema drifts)", () => {
    const live = derivedTokens()
      .map((t) => t.token)
      .sort();
    const acknowledged = [...ACKNOWLEDGED_TOKENS].sort();

    const added = live.filter((t) => !acknowledged.includes(t));
    const removed = acknowledged.filter((t) => !live.includes(t));

    // ADDED: a column landed on one of the six source tables and types.ts was
    // regenerated, so it is now a token. Decide whether it belongs on a quick
    // card, then add it to ACKNOWLEDGED_TOKENS (and to
    // QUICK_CARD_EXCLUDED_FIELDS if it should stay off). Do NOT delete this
    // assertion — it is the only thing standing between a new sensitive column
    // and the field picker.
    expect(added, `new schema tokens needing a decision: ${added.join(", ")}`).toEqual([]);
    // REMOVED: a column was dropped or renamed. Prune it here (and from the
    // exclusions if listed) so the snapshot stays honest.
    expect(removed, `tokens no longer in the schema: ${removed.join(", ")}`).toEqual([]);
  });

  it("classifies every acknowledged token as offered or explicitly excluded", () => {
    const excluded = new Set(QUICK_CARD_EXCLUDED_FIELDS);
    const offered = new Set(buildQuickCardCatalog(derivedTokens()).map((f) => f.key));
    const unclassified = ACKNOWLEDGED_TOKENS.filter(
      (token) => !offered.has(token) && !excluded.has(token),
    );
    expect(unclassified, `unclassified tokens: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("has no stale exclusions (every excluded token still exists in the schema)", () => {
    const live = new Set(derivedTokens().map((t) => t.token));
    const stale = QUICK_CARD_EXCLUDED_FIELDS.filter((token) => !live.has(token));
    expect(stale, `excluded tokens no longer in the schema: ${stale.join(", ")}`).toEqual([]);
  });

  it("offers substantially more than the retired 75-key hand-written allowlist", () => {
    const catalog = buildQuickCardCatalog(derivedTokens());
    // The hand-list carried 75 keys against a 151-token catalog. Deriving
    // recovers the group's correspondence block, the provider's home address,
    // facility email/hours/effective date, and the CAQH extras. This asserts
    // the regression can't silently come back; it is a floor, not a pin.
    expect(catalog.length).toBeGreaterThan(100);
  });
});

describe("quick-card catalog — exclusion policy", () => {
  it("excludes every case-scoped payer/mso/contract token", () => {
    for (const table of CASE_SCOPED_TOKEN_TABLES) {
      expect(isOfferedToken(table, "payer.name")).toBe(false);
    }
    const catalog = buildQuickCardCatalog([
      { table: "payers", token: "payer.name", column: "name" },
      { table: "msos", token: "mso.name", column: "name" },
      { table: "contracts", token: "contract.state", column: "state" },
      { table: "providers", token: "provider.npi", column: "npi" },
    ]);
    expect(catalog.map((f) => f.key)).toEqual(["provider.npi", ...USER_TOKEN_FIELDS]);
  });

  it("offers ssnLast4 (product decision 2026-07-28) but no full-SSN token exists", () => {
    const catalog = buildQuickCardCatalog(derivedTokens());
    const keys = new Set(catalog.map((f) => f.key));
    expect(keys.has("provider.ssnLast4")).toBe(true);
    // The vault (provider_ssn_vault) is not a table get_sop_field_tokens()
    // sweeps, so no token can name the full value — there is nothing to
    // exclude, and nothing a hand-crafted PUT could reach.
    expect(Object.keys(QUICK_CARD_TABLE_PREFIXES)).not.toContain("provider_ssn_vault");
    expect([...keys].filter((k) => /ssn/i.test(k))).toEqual(["provider.ssnLast4"]);
  });

  it("excludes internal/audit columns", () => {
    const catalog = buildQuickCardCatalog(derivedTokens());
    const keys = new Set(catalog.map((f) => f.key));
    for (const key of [
      "provider.launchId",
      "provider.isTestProvider",
      "provider.verificationState",
      "facility.statusId",
      "license.verifiedBy",
    ]) {
      expect(keys.has(key), `${key} should be excluded`).toBe(false);
    }
  });

  it("recovers the fields the hand-written allowlist was missing", () => {
    const catalog = buildQuickCardCatalog(derivedTokens());
    const keys = new Set(catalog.map((f) => f.key));
    for (const key of [
      // the group's entire correspondence block was unreachable
      "group.correspondenceStreet",
      "group.correspondenceCity",
      "group.correspondenceState",
      "group.correspondenceZip",
      // provider home address (homeState was offered; the rest were not)
      "provider.homeStreet",
      "provider.homeCity",
      "provider.homeZip",
      // facility fields a payer form asks for
      "facility.email",
      "facility.hours",
      "facility.effectiveDate",
      // CAQH extras
      "provider.culturalCompetencyTraining",
      "provider.additionalCertifications",
      "provider.ageGroupsServed",
    ]) {
      expect(keys.has(key), `${key} should now be offered`).toBe(true);
    }
  });

  it("appends the two {{user.*}} tokens the profile route resolves", () => {
    const catalog = buildQuickCardCatalog([
      { table: "providers", token: "provider.npi", column: "npi" },
    ]);
    expect(catalog.map((f) => f.key)).toContain("user.name");
    expect(catalog.map((f) => f.key)).toContain("user.email");
    expect(catalog.find((f) => f.key === "user.name")?.group).toBe("user");
  });

  it("normalizes a braced token to the bare join form", () => {
    const catalog = buildQuickCardCatalog([
      { table: "providers", token: "{{provider.npi}}", column: "npi" },
    ]);
    expect(catalog[0].key).toBe("provider.npi");
  });

  it("de-duplicates repeated tokens", () => {
    const entries: TokenCatalogEntry[] = [
      { table: "providers", token: "provider.npi", column: "npi" },
      { table: "providers", token: "provider.npi", column: "npi" },
    ];
    expect(buildQuickCardCatalog(entries).filter((f) => f.key === "provider.npi")).toHaveLength(1);
  });
});

describe("humanizeTokenField", () => {
  it("sentence-cases camelCase and uppercases known acronyms", () => {
    expect(humanizeTokenField("firstName")).toBe("First name");
    expect(humanizeTokenField("caqhLastAttestedDate")).toBe("CAQH last attested date");
    expect(humanizeTokenField("dateOfBirth")).toBe("Date of birth");
    expect(humanizeTokenField("websiteUrl")).toBe("Website URL");
    expect(humanizeTokenField("adaCompliance")).toBe("ADA compliance");
    expect(humanizeTokenField("zip")).toBe("ZIP");
  });

  it("splits digit boundaries", () => {
    expect(humanizeTokenField("npiType2")).toBe("NPI type 2");
  });

  it("applies the small override table where the derived form is unhelpful", () => {
    const catalog = buildQuickCardCatalog([
      { table: "providers", token: "provider.npi", column: "npi" },
      { table: "provider_groups", token: "group.tin", column: "tin" },
    ]);
    expect(catalog.find((f) => f.key === "provider.npi")?.label).toBe("NPI (Type 1)");
    expect(catalog.find((f) => f.key === "group.tin")?.label).toBe("Tax ID (TIN)");
  });

  it("groups fields under their section heading", () => {
    const catalog = buildQuickCardCatalog(derivedTokens());
    const facility = catalog.find((f) => f.key === "facility.street");
    expect(facility?.groupLabel).toBe("Practice location");
  });
});

describe("validateQuickCardFields", () => {
  const allowed = new Set(["license.licenseNumber", "provider.npi", "group.tin", "user.name"]);

  it("accepts a deduped, ordered list of catalog keys and preserves order", () => {
    const fields = ["license.licenseNumber", "provider.npi", "group.tin"];
    expect(validateQuickCardFields(fields, allowed)).toEqual({ ok: true, fields });
  });

  it("accepts an empty list (clears the layout)", () => {
    expect(validateQuickCardFields([], allowed)).toEqual({ ok: true, fields: [] });
  });

  it("rejects a non-array", () => {
    expect(validateQuickCardFields("provider.npi", allowed).ok).toBe(false);
    expect(validateQuickCardFields(null, allowed).ok).toBe(false);
    expect(validateQuickCardFields({ 0: "provider.npi" }, allowed).ok).toBe(false);
  });

  it("rejects a non-string element", () => {
    expect(validateQuickCardFields(["provider.npi", 42], allowed).ok).toBe(false);
  });

  it("rejects a key outside the derived catalog", () => {
    const result = validateQuickCardFields(["provider.npi", "provider.launchId"], allowed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/launchId/);
  });

  it("rejects a duplicate key", () => {
    const result = validateQuickCardFields(["provider.npi", "provider.npi"], allowed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/duplicate/);
  });

  it("accepts a long layout (no arbitrary length cap)", () => {
    const catalog = buildQuickCardCatalog(derivedTokens());
    const many = catalog.slice(0, 60).map((f) => f.key);
    const result = validateQuickCardFields(many, new Set(catalog.map((f) => f.key)));
    expect(result.ok).toBe(true);
  });
});
