import { describe, expect, it } from "vitest";
import {
  humanizeFieldName,
  payerFormFamilyFromPortalKey,
  pdfFieldImportRows,
  pdfFieldLabel,
  pdfFieldSection,
  pdfFormPortalKey,
  proposePdfImportRows,
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

  it("does not show broken PDF metadata as a field label", () => {
    expect(pdfFieldLabel(field({ name: "undefined_5", tooltip: "undefined" }), 65)).toBe(
      "Unlabeled PDF field 65",
    );
    expect(pdfFieldLabel(field({ name: "E Á   šv", tooltip: "E Á >}  š]}v" }), 8)).toBe(
      "Unlabeled PDF field 8",
    );
    expect(pdfFieldLabel(field({ name: "French", tooltip: "French \u0006 P" }))).toBe("French");
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

  it("locates flat PDF fields by page while preserving their selectors", () => {
    const [row] = pdfFieldImportRows("fam", [
      field({ name: "undefined_5", tooltip: "undefined", pageNumber: 2 }),
    ]);
    expect(row.selector).toBe("undefined_5");
    expect(row.fieldLabel).toBe("Unlabeled PDF field 1");
    expect(row.pageStep).toBe("Page 2");
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

describe("proposePdfImportRows", () => {
  it("reports partial failures after attempting every field, with bounded concurrency", async () => {
    const rows = pdfFieldImportRows(
      "fam",
      Array.from({ length: 11 }, (_, index) => field({ name: `Field${index + 1}` })),
    );
    let active = 0;
    let maximum = 0;
    const attempted: string[] = [];
    const result = await proposePdfImportRows(rows, async (row) => {
      active += 1;
      maximum = Math.max(maximum, active);
      attempted.push(row.selector);
      await Promise.resolve();
      active -= 1;
      if (row.selector === "Field9") throw new Error("temporary RPC failure");
    });
    expect(result).toEqual({ imported: 10, failed: 1 });
    expect(attempted).toHaveLength(11);
    expect(maximum).toBe(8);
  });
});
