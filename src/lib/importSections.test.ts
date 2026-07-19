// E3.3 TE-12 — unit coverage for the per-section import descriptors: each
// section's exact-header gate (the download and the gate share one source), the
// TE-3 flat encoding (delimited multi-values with the escape, prefixed group
// blocks with "blank corr/cred ⇒ inherit billing"), the provider license
// repeat-row rule, the TE-6 SSN sweep carried into each section, the
// combined-template retirement signature, and the ladder-gate predicate.
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csvImport";
import { checkHeaders, headerGateMessage, SSN_REJECT_REASON } from "@/lib/rosterImport";
import {
  COMBINED_TEMPLATE_RETIRED_MESSAGE,
  FACILITY_DESCRIPTOR,
  GROUP_DESCRIPTOR,
  PAYER_ATTACH_DESCRIPTOR,
  PROVIDER_DESCRIPTOR,
  decodeDelimited,
  encodeDelimited,
  looksLikeCombinedTemplate,
  scanSectionRecord,
  sectionTemplateCsv,
  uploadLadderGate,
  type SectionDescriptor,
  type SectionScanContext,
} from "@/lib/importSections";
import { ROSTER_TEMPLATE_HEADERS } from "@/lib/rosterImport";
import type { ScannedRow } from "@/lib/rosterImport";

// Build one data record from a header→cell map (template order) and scan it.
function scanRow(descriptor: SectionDescriptor, cells: Record<string, string>): ScannedRow {
  const headerLine = descriptor.headers.join(",");
  const dataLine = descriptor.headers.map((h) => cells[h] ?? "").join(",");
  const parsed = parseCsv(`${headerLine}\n${dataLine}`);
  return scanSectionRecord(descriptor, parsed.records[0], parsed.headers);
}

/* ------------------------- delimited encode/decode ------------------------- */

describe("delimited multi-value encode/decode (TE-3)", () => {
  it("round-trips simple values", () => {
    expect(encodeDelimited(["NC", "SC", "CO"])).toBe("NC;SC;CO");
    expect(decodeDelimited("NC;SC;CO")).toEqual(["NC", "SC", "CO"]);
  });

  it("trims items and drops blanks", () => {
    expect(decodeDelimited(" NC ; ; SC ")).toEqual(["NC", "SC"]);
    expect(decodeDelimited("")).toEqual([]);
  });

  it("escapes and un-escapes an embedded semicolon", () => {
    const encoded = encodeDelimited(["a;b", "c"]);
    expect(encoded).toBe("a\\;b;c");
    expect(decodeDelimited(encoded)).toEqual(["a;b", "c"]);
  });

  it("escapes and un-escapes a literal backslash", () => {
    const encoded = encodeDelimited(["a\\b"]);
    expect(decodeDelimited(encoded)).toEqual(["a\\b"]);
  });
});

/* ------------------------- exact per-section gates ------------------------- */

describe("per-section header gates (F3.3.1 no-more-no-fewer)", () => {
  for (const descriptor of [GROUP_DESCRIPTOR, FACILITY_DESCRIPTOR, PROVIDER_DESCRIPTOR]) {
    it(`${descriptor.entityKind}: its own template passes the gate`, () => {
      const parsed = parseCsv(sectionTemplateCsv(descriptor));
      const result = checkHeaders(parsed.headers, descriptor.headers);
      expect(result.ok).toBe(true);
      expect(headerGateMessage(result)).toBeNull();
      // the template has the header row and zero data rows
      expect(parsed.records).toHaveLength(0);
    });

    it(`${descriptor.entityKind}: a missing column is rejected by name`, () => {
      const shortened = descriptor.headers.slice(1);
      const result = checkHeaders([...shortened], descriptor.headers);
      expect(result.ok).toBe(false);
      expect(result.missing).toContain(descriptor.headers[0]);
    });

    it(`${descriptor.entityKind}: an extra column is rejected`, () => {
      const result = checkHeaders([...descriptor.headers, "favorite_color"], descriptor.headers);
      expect(result.ok).toBe(false);
      expect(result.extra).toContain("favorite_color");
    });
  }

  it("the three templates are mutually exclusive (no template passes another's gate)", () => {
    const descriptors = [GROUP_DESCRIPTOR, FACILITY_DESCRIPTOR, PROVIDER_DESCRIPTOR];
    for (const a of descriptors) {
      for (const b of descriptors) {
        if (a === b) continue;
        expect(checkHeaders([...a.headers], b.headers).ok).toBe(false);
      }
    }
  });
});

/* ------------------------------ group section ------------------------------ */

const GROUP_ROW: Record<string, string> = {
  group_name: "Tree Hill Sports Therapy LLC",
  group_tin: "12-3456789",
  npi_type2: "1234567893",
  operating_states: "NC;SC",
  billing_street: "100 River Rd",
  billing_city: "Wilmington",
  billing_state: "nc",
  billing_zip: "28401",
  billing_contact_name: "Karen Roe",
  billing_phone: "9105550100",
  billing_email: "billing@treehill.example",
};

describe("provider_group scan (TE-2/TE-3)", () => {
  it("stages a valid row, normalizing TIN/state and encoding operating_states", () => {
    const row = scanRow(GROUP_DESCRIPTOR, GROUP_ROW);
    expect(row.rowState).toBe("staged");
    expect(row.mapped?.tin).toBe("123456789");
    expect(row.mapped?.operating_states).toBe("NC;SC");
    expect(row.mapped?.billing_state).toBe("NC");
  });

  it("blank correspondence/credentialing blocks inherit billing (TE-3)", () => {
    const row = scanRow(GROUP_DESCRIPTOR, GROUP_ROW);
    expect(row.mapped?.corr_street).toBe("100 River Rd");
    expect(row.mapped?.corr_city).toBe("Wilmington");
    expect(row.mapped?.corr_state).toBe("NC");
    expect(row.mapped?.cred_zip).toBe("28401");
  });

  it("a present correspondence block is NOT overwritten by billing", () => {
    const row = scanRow(GROUP_DESCRIPTOR, { ...GROUP_ROW, corr_street: "200 Ocean Ave" });
    expect(row.mapped?.corr_street).toBe("200 Ocean Ave");
    // its own blank fields stay blank (not inherited — the block was present)
    expect(row.mapped?.corr_city).toBeNull();
  });

  it("requires group_tin and at least one operating state", () => {
    expect(scanRow(GROUP_DESCRIPTOR, { ...GROUP_ROW, group_tin: "" }).rowState).toBe("error");
    const noStates = scanRow(GROUP_DESCRIPTOR, { ...GROUP_ROW, operating_states: "" });
    expect(noStates.rowState).toBe("error");
    expect(noStates.errorColumn).toBe("operating_states");
  });

  it("rejects a bad operating-state code", () => {
    const row = scanRow(GROUP_DESCRIPTOR, { ...GROUP_ROW, operating_states: "NC;XXX" });
    expect(row.rowState).toBe("error");
    expect(row.errorColumn).toBe("operating_states");
  });
});

/* ---------------------------- facility section ----------------------------- */

const FACILITY_ROW: Record<string, string> = {
  facility_name: "Riverside Clinic",
  group_tin: "12-3456789",
  street: "10 Dockside Dr",
  city: "Wilmington",
  state: "nc",
  zip: "28401",
  accepting_new_patients: "yes",
  languages_offered: "English;Spanish",
  ada_accessible: "no",
};

describe("facility scan (TE-2/TE-3/TE-5)", () => {
  it("stages a valid row with a group_tin parent key", () => {
    const row = scanRow(FACILITY_DESCRIPTOR, FACILITY_ROW);
    expect(row.rowState).toBe("staged");
    expect(row.mapped?.group_tin).toBe("123456789");
    expect(row.mapped?.state).toBe("NC");
    expect(row.mapped?.accepting_new_patients).toBe("true");
    expect(row.mapped?.ada_accessible).toBe("false");
    expect(row.mapped?.languages_offered).toBe("English;Spanish");
  });

  it("accepts group_name as the parent key when group_tin is blank", () => {
    const row = scanRow(FACILITY_DESCRIPTOR, {
      ...FACILITY_ROW,
      group_tin: "",
      group_name: "Tree Hill Sports Therapy LLC",
    });
    expect(row.rowState).toBe("staged");
    expect(row.mapped?.group_name).toBe("Tree Hill Sports Therapy LLC");
  });

  it("blocks a row with no parent group key at all (ladder within the row)", () => {
    const row = scanRow(FACILITY_DESCRIPTOR, { ...FACILITY_ROW, group_tin: "", group_name: "" });
    expect(row.rowState).toBe("error");
    expect(row.errorColumn).toBe("group_name");
  });

  it("has no hours column in the template (TE-3 deferral)", () => {
    expect(FACILITY_DESCRIPTOR.headers).not.toContain("hours");
    expect(FACILITY_DESCRIPTOR.headers.some((h) => h.includes("hours"))).toBe(false);
  });
});

/* ---------------------------- provider section ----------------------------- */

const PROVIDER_ROW: Record<string, string> = {
  group_tin: "12-3456789",
  provider_first_name: "Nathan",
  provider_last_name: "Scott",
  npi: "1234567893",
  license_state: "nc",
  license_number: "PT12345",
  license_expiration_date: "12/31/2026",
  ssn_last4: "6789",
};

describe("provider scan (TE-2/TE-6)", () => {
  it("stages a valid provider row without any facility columns", () => {
    const row = scanRow(PROVIDER_DESCRIPTOR, PROVIDER_ROW);
    expect(row.rowState).toBe("staged");
    expect(row.mapped?.npi).toBe("1234567893");
    expect(row.mapped?.license_state).toBe("NC");
    expect(row.mapped?.license_expiration_date).toBe("2026-12-31");
    // the provider template carries NO facility-creation columns (TE-2)
    expect(PROVIDER_DESCRIPTOR.headers).not.toContain("facility_name");
    expect(PROVIDER_DESCRIPTOR.headers.some((h) => h.startsWith("facility_"))).toBe(false);
  });

  it("license columns repeat per row — each row is one (provider, license) line", () => {
    // two rows for the same provider, different licenses (the E3.1 fold grain)
    const a = scanRow(PROVIDER_DESCRIPTOR, PROVIDER_ROW);
    const b = scanRow(PROVIDER_DESCRIPTOR, {
      ...PROVIDER_ROW,
      license_state: "sc",
      license_number: "PT98765",
    });
    expect(a.mapped?.license_state).toBe("NC");
    expect(b.mapped?.license_state).toBe("SC");
    // same provider identity across both license rows
    expect(a.mapped?.npi).toBe(b.mapped?.npi);
  });

  it("rejects a full SSN anywhere and redacts it (TE-6, verbatim from E3.0)", () => {
    const row = scanRow(PROVIDER_DESCRIPTOR, { ...PROVIDER_ROW, caqh_id: "123-45-6789" });
    expect(row.rowState).toBe("error");
    expect(row.errorReason).toBe(SSN_REJECT_REASON);
    // the offending cell is redacted from raw, and the value is never echoed
    expect(row.raw.caqh_id).toBe("");
    expect(row.errorReason).not.toContain("6789");
  });

  it("keeps the group_tin bare-9-digit exemption (dashed still rejected)", () => {
    expect(scanRow(PROVIDER_DESCRIPTOR, { ...PROVIDER_ROW, group_tin: "123456789" }).rowState).toBe(
      "staged",
    );
    expect(
      scanRow(PROVIDER_DESCRIPTOR, { ...PROVIDER_ROW, group_tin: "12-34-5678" }).rowState,
    ).toBe("error");
  });

  it("requires first/last/npi and a parent-group key", () => {
    expect(scanRow(PROVIDER_DESCRIPTOR, { ...PROVIDER_ROW, npi: "" }).rowState).toBe("error");
    expect(
      scanRow(PROVIDER_DESCRIPTOR, { ...PROVIDER_ROW, group_tin: "", group_name: "" }).rowState,
    ).toBe("error");
  });

  it("rejects a full-SSN-shaped ssn_last4 and never truncates it", () => {
    const row = scanRow(PROVIDER_DESCRIPTOR, { ...PROVIDER_ROW, ssn_last4: "123456789" });
    expect(row.rowState).toBe("error");
    // swept as a full SSN and redacted — never silently kept as a last-4
    expect(row.raw.ssn_last4).toBe("");
  });
});

/* --------------------- combined-template retirement (TE-7) ----------------- */

describe("combined-template detection (TE-7)", () => {
  it("recognizes the retired combined template signature", () => {
    expect(looksLikeCombinedTemplate([...ROSTER_TEMPLATE_HEADERS])).toBe(true);
  });

  it("does not misfire on any per-section template", () => {
    expect(looksLikeCombinedTemplate([...GROUP_DESCRIPTOR.headers])).toBe(false);
    expect(looksLikeCombinedTemplate([...FACILITY_DESCRIPTOR.headers])).toBe(false);
    expect(looksLikeCombinedTemplate([...PROVIDER_DESCRIPTOR.headers])).toBe(false);
  });

  it("has an actionable retirement message naming per-section templates", () => {
    expect(COMBINED_TEMPLATE_RETIRED_MESSAGE).toMatch(/per-section/i);
    expect(COMBINED_TEMPLATE_RETIRED_MESSAGE).toMatch(/Provider Group/);
    expect(COMBINED_TEMPLATE_RETIRED_MESSAGE).toMatch(/Facilities/);
    expect(COMBINED_TEMPLATE_RETIRED_MESSAGE).toMatch(/Providers/);
  });
});

/* ---------------------------- ladder gate (TE-5) --------------------------- */

describe("upload ladder gate (TE-5)", () => {
  it("provider_group upload has no prerequisite", () => {
    expect(uploadLadderGate("provider_group", { activeGroupCount: 0 }).allowed).toBe(true);
  });

  it("facility and provider uploads require ≥1 provider group", () => {
    for (const kind of ["facility", "provider"] as const) {
      const blocked = uploadLadderGate(kind, { activeGroupCount: 0 });
      expect(blocked.allowed).toBe(false);
      expect(blocked.prerequisite).toBe("provider_group");
      expect(uploadLadderGate(kind, { activeGroupCount: 1 }).allowed).toBe(true);
    }
  });
});

/* ----------------------- payer attach descriptor (E6.2) -------------------- */

describe("payer attach descriptor (E6.2 F6.2.4)", () => {
  const context: SectionScanContext = {
    payerAttach: {
      groups: [{ id: "g1", name: "Outer Banks Rehab Group", tin: "123456789", states: ["NC", "CO"] }],
      payers: [
        { id: "pay1", name: "Aetna", payerSlug: "aetna", aliases: [], states: ["NC", "SC"], status: "active" },
      ],
    },
  };

  function scanAttachRow(cells: Record<string, string>, ctx = context): ScannedRow {
    const headerLine = PAYER_ATTACH_DESCRIPTOR.headers.join(",");
    const dataLine = PAYER_ATTACH_DESCRIPTOR.headers.map((h) => cells[h] ?? "").join(",");
    const parsed = parseCsv(`${headerLine}\n${dataLine}`);
    return scanSectionRecord(PAYER_ATTACH_DESCRIPTOR, parsed.records[0], parsed.headers, ctx);
  }

  it("template is exactly group_name, group_tin, payer, states", () => {
    expect([...PAYER_ATTACH_DESCRIPTOR.headers]).toEqual([
      "group_name",
      "group_tin",
      "payer",
      "states",
    ]);
    expect(sectionTemplateCsv(PAYER_ATTACH_DESCRIPTOR).trim()).toBe("group_name,group_tin,payer,states");
  });

  it("the template documents eligibility and the ';' states encoding", () => {
    expect(PAYER_ATTACH_DESCRIPTOR.helperText).toMatch(/one row per group × payer/i);
    expect(PAYER_ATTACH_DESCRIPTOR.helperText).toMatch(/operating states/i);
  });

  it("a valid row stages with resolved group_id/payer_id stamped into mapped", () => {
    const row = scanAttachRow({ group_tin: "12-3456789", payer: "aetna", states: "NC" });
    expect(row.rowState).toBe("staged");
    expect(row.mapped).toMatchObject({ group_id: "g1", payer_id: "pay1", states: "NC" });
  });

  it("eligibility errors are named per row at scan time", () => {
    const outOfCoverage = scanAttachRow({ group_tin: "123456789", payer: "Aetna", states: "TX" });
    expect(outOfCoverage.rowState).toBe("error");
    expect(outOfCoverage.errorReason).toBe("Aetna does not cover TX");

    const outsideGroup = scanAttachRow({ group_tin: "123456789", payer: "Aetna", states: "SC" });
    expect(outsideGroup.rowState).toBe("error");
    expect(outsideGroup.errorReason).toMatch(/operating states/);

    const unknownPayer = scanAttachRow({ group_tin: "123456789", payer: "ghost", states: "NC" });
    expect(unknownPayer.rowState).toBe("error");
    expect(unknownPayer.errorColumn).toBe("payer");
  });

  it("states is required and must be 2-letter codes", () => {
    const missing = scanAttachRow({ group_tin: "123456789", payer: "Aetna" });
    expect(missing.rowState).toBe("error");
    expect(missing.errorColumn).toBe("states");

    const bad = scanAttachRow({ group_tin: "123456789", payer: "Aetna", states: "North Carolina" });
    expect(bad.rowState).toBe("error");
  });

  it("a missing scan context blocks the row instead of skipping eligibility", () => {
    const row = scanAttachRow({ group_tin: "123456789", payer: "Aetna", states: "NC" }, {});
    expect(row.rowState).toBe("error");
    expect(row.errorReason).toMatch(/catalog unavailable/i);
  });
});
