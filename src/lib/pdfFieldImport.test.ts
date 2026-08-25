import { describe, expect, it } from "vitest";
import {
  humanizeFieldName,
  payerFormFamilyFromPortalKey,
  pdfFieldImportRows,
  pdfFieldLabel,
  pdfFieldSection,
  pdfFormPortalKey,
  summarizePdfImport,
  type PdfAcroFieldDescriptor,
} from "@/lib/pdfFieldImport";

const field = (over: Partial<PdfAcroFieldDescriptor> = {}): PdfAcroFieldDescriptor => ({
  name: "form1[0].Page1[0].ProviderName[0]",
  type: "text",
  tooltip: null,
  options: null,
  ...over,
});

describe("pdfFormPortalKey", () => {
  it("keys on the family, lowercased, and round-trips", () => {
    const key = pdfFormPortalKey("  AbC-123 ");
    expect(key).toBe("payer-form:abc-123");
    expect(payerFormFamilyFromPortalKey(key)).toBe("abc-123");
  });

  it("does not claim a web portal key", () => {
    expect(payerFormFamilyFromPortalKey("availity")).toBeNull();
    expect(payerFormFamilyFromPortalKey("payer-form:")).toBeNull();
    expect(payerFormFamilyFromPortalKey(null)).toBeNull();
  });
});

describe("humanizeFieldName", () => {
  it("splits camel case, acronyms and trailing digits", () => {
    expect(humanizeFieldName("PhysicalCity")).toBe("Physical City");
    expect(humanizeFieldName("TINNumber")).toBe("TIN Number");
    expect(humanizeFieldName("CAQH1")).toBe("CAQH 1");
    expect(humanizeFieldName("provider_last_name")).toBe("provider last name");
    expect(humanizeFieldName("Fax[0]")).toBe("Fax");
  });
});

describe("pdfFieldLabel", () => {
  it("prefers the /TU tooltip a payer authored", () => {
    expect(pdfFieldLabel(field({ tooltip: "  Provider legal name  " }))).toBe(
      "Provider legal name",
    );
  });

  it("falls back to the camel-split leaf, never the whole path", () => {
    expect(pdfFieldLabel(field())).toBe("Provider Name");
    expect(pdfFieldLabel(field({ tooltip: "   " }))).toBe("Provider Name");
  });
});

describe("pdfFieldSection", () => {
  it("uses the subform path without indices or the generic root", () => {
    expect(pdfFieldSection("form1[0].PracticeInfo[0].GroupTIN[0]")).toBe("Practice Info");
    expect(pdfFieldSection("topmostSubform[0].Page2[0].Billing[0].Npi[0]")).toBe(
      "Page 2 › Billing",
    );
  });

  it("is null for a flat name (nothing to group by)", () => {
    expect(pdfFieldSection("ProviderName")).toBeNull();
    expect(pdfFieldSection("form1[0].ProviderName[0]")).toBeNull();
  });
});

describe("pdfFieldImportRows", () => {
  it("maps control types onto the registry's own field types", () => {
    const rows = pdfFieldImportRows("fam", [
      field({ name: "Text1", type: "text" }),
      field({ name: "Accept", type: "checkbox", options: ["Yes"] }),
      field({ name: "Gender", type: "radio", options: ["M", "F"] }),
      field({ name: "State", type: "dropdown", options: ["NC", "SC"] }),
      field({ name: "Langs", type: "optionlist", options: ["EN"] }),
    ]);
    expect(rows.map((r) => r.fieldType)).toEqual(["text", "checkbox", "radio", "select", "select"]);
    expect(rows.every((r) => r.portalKey === "payer-form:fam")).toBe(true);
  });

  it("keeps the raw hierarchical field name as the selector", () => {
    const [row] = pdfFieldImportRows("fam", [field()]);
    expect(row.selector).toBe("form1[0].Page1[0].ProviderName[0]");
  });

  it("captures a control's option vocabulary, and nothing for a bare text box", () => {
    const [dropdown, text] = pdfFieldImportRows("fam", [
      field({ name: "State", type: "dropdown", options: ["NC", " ", "SC"] }),
      field({ name: "Text1", type: "text" }),
    ]);
    expect(dropdown.controlOptions).toEqual([
      { value: "NC", label: "NC" },
      { value: "SC", label: "SC" },
    ]);
    expect(text.controlOptions).toBeNull();
  });

  it("drops what cannot be filled: buttons, signatures and unnamed fields", () => {
    const summary = summarizePdfImport("fam", [
      field({ name: "Text1", type: "text" }),
      field({ name: "Print", type: "button" }),
      field({ name: "Sign", type: "signature" }),
      field({ name: "   ", type: "text" }),
    ]);
    expect(summary.rows.map((r) => r.selector)).toEqual(["Text1"]);
    expect(summary.totalFields).toBe(4);
    expect(summary.skipped).toBe(3);
  });

  it("keeps a repeated name once — selector is unique per tier", () => {
    const rows = pdfFieldImportRows("fam", [
      field({ name: "Npi", type: "text" }),
      field({ name: "Npi", type: "text" }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("orders rows in document order, densely, so a re-import is a refresh", () => {
    const fields = [
      field({ name: "A", type: "text" }),
      field({ name: "Print", type: "button" }),
      field({ name: "B", type: "text" }),
      field({ name: "C", type: "text" }),
    ];
    const first = pdfFieldImportRows("fam", fields);
    expect(first.map((r) => [r.selector, r.sortOrder])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
    expect(pdfFieldImportRows("fam", fields)).toEqual(first);
  });

  it("returns nothing for a flat scan, which is a real answer not a failure", () => {
    expect(pdfFieldImportRows("fam", [])).toEqual([]);
    expect(summarizePdfImport("fam", []).totalFields).toBe(0);
  });
});
