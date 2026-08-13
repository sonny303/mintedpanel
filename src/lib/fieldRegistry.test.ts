import { describe, it, expect } from "vitest";
import {
  classifyFieldMap,
  displayNameOf,
  sectionNameOf,
  sectionRenamePatches,
  groupRegistryRows,
  registryCoverage,
  isManualSelector,
  newManualSelector,
  DEFAULT_SECTION,
  type RegistryRow,
} from "./fieldRegistry";

const row = (over: Partial<RegistryRow> = {}): RegistryRow => ({
  id: "r1",
  selector: "#npi",
  status: "proposed",
  source: "manual",
  token: null,
  hardcodedValue: null,
  ...over,
});

describe("classifyFieldMap — exhaustive over (status, source)", () => {
  it("treats a captured proposed+manual row as undecided, not as a manual decision", () => {
    // THE bug this classifier exists to fix: capture writes exactly this shape,
    // and the old dry run filtered source==='manual' before checking status, so
    // 19 undecided rows disappeared and the run passed at 4 of 23.
    const c = classifyFieldMap(row({ status: "proposed", source: "manual" }));
    expect(c.decision).toBe("undecided");
    expect(c.needsDecision).toBe(true);
    expect(c.mapped).toBe(false);
  });

  it("counts an approved token row as mapped and autofillable", () => {
    const c = classifyFieldMap(row({ status: "approved", source: "token", token: "provider.npi" }));
    expect(c).toMatchObject({ decision: "token", mapped: true, autofillable: true });
    expect(c.needsDecision).toBe(false);
  });

  it("counts manual_partial as a token mapping (it carries one)", () => {
    const c = classifyFieldMap(
      row({ status: "approved", source: "manual_partial", token: "provider.npi" }),
    );
    expect(c.decision).toBe("token");
    expect(c.mapped).toBe(true);
  });

  it("counts an approved hardcoded row with a literal as mapped", () => {
    const c = classifyFieldMap(
      row({ status: "approved", source: "hardcoded", hardcodedValue: "Credentialing Coordinator" }),
    );
    expect(c).toMatchObject({ decision: "fixed", mapped: true, autofillable: true });
    expect(c.reason).toContain("Credentialing Coordinator");
  });

  it("treats approved+manual as a decided human-fill: not mapped, not a gap", () => {
    const c = classifyFieldMap(row({ status: "approved", source: "manual" }));
    expect(c.decision).toBe("human");
    expect(c.mapped).toBe(false);
    expect(c.autofillable).toBe(false);
    // The distinction that makes coverage honest: decided, but not mapped.
    expect(c.needsDecision).toBe(false);
  });

  it("fails closed when an approved token row has no token", () => {
    const c = classifyFieldMap(row({ status: "approved", source: "token", token: null }));
    expect(c.decision).toBe("invalid");
    expect(c.needsDecision).toBe(true);
    expect(c.mapped).toBe(false);
  });

  it("fails closed when an approved hardcoded row has an empty literal", () => {
    for (const value of [null, "", "   "]) {
      const c = classifyFieldMap(
        row({ status: "approved", source: "hardcoded", hardcodedValue: value }),
      );
      expect(c.decision).toBe("invalid");
      expect(c.mapped).toBe(false);
    }
  });

  it("never infers a fixed value from a stray hardcodedValue on another source", () => {
    // The panel used to infer "fixed" from `hardcodedValue != null`
    // (HARDCODED_PSEUDO_TOKEN) while the extension keyed off source. One rule
    // now: the SOURCE decides.
    const c = classifyFieldMap(
      row({ status: "approved", source: "manual", hardcodedValue: "leftover" }),
    );
    expect(c.decision).toBe("human");
    expect(c.autofillable).toBe(false);
  });

  it("classifies retired and stale rows out of the working set", () => {
    expect(classifyFieldMap(row({ status: "retired" })).decision).toBe("stale");
    expect(
      classifyFieldMap(row({ status: "approved", source: "token", token: "t" }), { stale: true })
        .decision,
    ).toBe("stale");
  });

  it("stale rows never count as mapped or as a gap", () => {
    const c = classifyFieldMap(
      row({ status: "approved", source: "token", token: "provider.npi" }),
      { stale: true },
    );
    expect(c.mapped).toBe(false);
    expect(c.needsDecision).toBe(false);
  });
});

describe("display name and section fallbacks", () => {
  it("prefers the admin rename but never loses the raw captured label", () => {
    const r = row({ displayLabel: "Group NPI", fieldLabel: "Text field 3" });
    expect(displayNameOf(r)).toBe("Group NPI");
    expect(r.fieldLabel).toBe("Text field 3");
  });

  it("falls back raw label → selector when nothing is named", () => {
    expect(displayNameOf(row({ fieldLabel: "Tax ID" }))).toBe("Tax ID");
    expect(displayNameOf(row({ fieldLabel: null }))).toBe("#npi");
  });

  it("walks the locked section fallback chain", () => {
    expect(
      sectionNameOf(row({ section: "Tax ID", formSection: "Billing", pageStep: "Page 2" })),
    ).toBe("Tax ID");
    expect(sectionNameOf(row({ formSection: "Billing", pageStep: "Page 2" }))).toBe("Billing");
    expect(sectionNameOf(row({ pageStep: "Page 2" }))).toBe("Page 2");
    expect(sectionNameOf(row())).toBe(DEFAULT_SECTION);
  });

  it("ignores whitespace-only names rather than rendering a blank heading", () => {
    expect(sectionNameOf(row({ section: "   ", formSection: "Billing" }))).toBe("Billing");
    expect(displayNameOf(row({ displayLabel: "  ", fieldLabel: "Tax ID" }))).toBe("Tax ID");
  });

  it("sectionRenamePatches writes every row id and clears on blank", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    expect(sectionRenamePatches(rows, "Provider info")).toEqual([
      { id: "a", section: "Provider info" },
      { id: "b", section: "Provider info" },
    ]);
    expect(sectionRenamePatches(rows, "   ")).toEqual([
      { id: "a", section: null },
      { id: "b", section: null },
    ]);
    expect(sectionRenamePatches(rows, null)).toEqual([
      { id: "a", section: null },
      { id: "b", section: null },
    ]);
  });
});

describe("groupRegistryRows", () => {
  it("groups by section in capture order and counts mapped per section", () => {
    const rows = [
      row({
        id: "a",
        section: "Tax ID",
        sortOrder: 1,
        status: "approved",
        source: "token",
        token: "group.tin",
      }),
      row({ id: "b", section: "Tax ID", sortOrder: 2 }),
      row({ id: "c", section: "Contact", sortOrder: 3 }),
    ];
    const sections = groupRegistryRows(rows);
    expect(sections.map((s) => s.name)).toEqual(["Tax ID", "Contact"]);
    expect(sections[0]).toMatchObject({ mapped: 1, total: 2 });
    expect(sections[1]).toMatchObject({ mapped: 0, total: 1 });
  });

  it("orders by sort_order, not by decision — deciding never moves a row", () => {
    const before = groupRegistryRows([
      row({ id: "a", sortOrder: 1 }),
      row({ id: "b", sortOrder: 2 }),
      row({ id: "c", sortOrder: 3 }),
    ])[0].rows.map((r) => r.id);

    const after = groupRegistryRows([
      row({ id: "a", sortOrder: 1 }),
      row({ id: "b", sortOrder: 2, status: "approved", source: "token", token: "provider.npi" }),
      row({ id: "c", sortOrder: 3 }),
    ])[0].rows.map((r) => r.id);

    expect(after).toEqual(before);
  });

  it("sorts rows with no sort_order last, stably by id", () => {
    const rows = groupRegistryRows([
      row({ id: "z", sortOrder: null }),
      row({ id: "a", sortOrder: null }),
      row({ id: "m", sortOrder: 1 }),
    ])[0].rows;
    expect(rows.map((r) => r.id)).toEqual(["m", "a", "z"]);
  });

  it("does not count a stale row toward its section's mapped total", () => {
    const rows = [
      row({ id: "a", sortOrder: 1, status: "approved", source: "token", token: "t" }),
      row({ id: "b", sortOrder: 2, status: "approved", source: "token", token: "t" }),
    ];
    expect(groupRegistryRows(rows).at(0)?.mapped).toBe(2);
    expect(groupRegistryRows(rows, new Set(["b"])).at(0)?.mapped).toBe(1);
  });
});

describe("registryCoverage", () => {
  it("reports the honest split for the Aetna shape: 4 of 23, 19 undecided", () => {
    const rows: RegistryRow[] = [
      ...Array.from({ length: 4 }, (_, i) =>
        row({ id: `ok${i}`, status: "approved", source: "token", token: "provider.npi" }),
      ),
      ...Array.from({ length: 19 }, (_, i) => row({ id: `todo${i}` })),
    ];
    expect(registryCoverage(rows)).toMatchObject({ mapped: 4, total: 23, needsDecision: 19 });
  });

  it("counts human-fill rows in the denominator but never as mapped", () => {
    const rows = [
      row({ id: "a", status: "approved", source: "token", token: "provider.npi" }),
      row({ id: "b", status: "approved", source: "manual" }),
    ];
    // The intentional distinction: 1 of 2 mapped, and nothing needs a decision.
    expect(registryCoverage(rows)).toMatchObject({ mapped: 1, total: 2, needsDecision: 0 });
  });

  it("counts distinct captured pages", () => {
    const rows = [
      row({ id: "a", pageStep: "Page 1" }),
      row({ id: "b", pageStep: "Page 1" }),
      row({ id: "c", pageStep: "Page 2" }),
      row({ id: "d", pageStep: null }),
    ];
    expect(registryCoverage(rows).pages).toBe(2);
  });
});

describe("manual selectors", () => {
  it("recognizes the manual prefix so fill and drift can skip those rows", () => {
    expect(isManualSelector("manual:abc")).toBe(true);
    expect(isManualSelector("#npi")).toBe(false);
    expect(isManualSelector(null)).toBe(false);
  });

  it("mints unique selectors for new manual rows", () => {
    const a = newManualSelector();
    const b = newManualSelector();
    expect(a).not.toBe(b);
    expect(isManualSelector(a)).toBe(true);
  });
});
