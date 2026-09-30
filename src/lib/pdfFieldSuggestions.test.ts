import { describe, expect, it } from "vitest";
import { pdfLabelIsUnique, suggestPdfFieldMappings } from "@/lib/pdfFieldSuggestions";
import type { PortalFieldMap } from "@/types";

type Row = Pick<PortalFieldMap, "id" | "portalKey" | "fieldLabel" | "status" | "source" | "token">;
const row = (over: Partial<Row> = {}): Row => ({
  id: "target",
  portalKey: "payer-form:optum",
  fieldLabel: "TAX ID NUMBER: *Required",
  status: "proposed",
  source: "manual",
  token: null,
  ...over,
});

describe("suggestPdfFieldMappings", () => {
  it("uses a prior approved mapping without approving the PDF field", () => {
    const suggestions = suggestPdfFieldMappings(
      [row()],
      [
        row({
          id: "prior",
          portalKey: "other",
          fieldLabel: "Tax ID Number",
          status: "approved",
          source: "token",
          token: "group.tin",
        }),
      ],
      [],
      new Set(["group.tin"]),
    );
    expect(suggestions.get("target")).toEqual({
      token: "group.tin",
      portalCount: 1,
      fromDictionary: false,
    });
  });

  it("matches a confirmed dictionary label without the PDF required marker", () => {
    const suggestions = suggestPdfFieldMappings(
      [row()],
      [],
      [{ labelNormalized: "tax id number", token: "group.tin", status: "confirmed" }],
      new Set(["group.tin"]),
    );
    expect(suggestions.get("target")?.token).toBe("group.tin");
    expect(
      pdfLabelIsUnique("Tax ID Number", [
        row(),
        row({ id: "second", fieldLabel: "Tax ID Number" }),
      ]),
    ).toBe(false);
  });

  it("withholds a dictionary token contradicted by an approved payer mapping", () => {
    const suggestions = suggestPdfFieldMappings(
      [row()],
      [
        row({
          id: "prior",
          portalKey: "other",
          fieldLabel: "Tax ID Number",
          status: "approved",
          source: "token",
          token: "provider.npi",
        }),
      ],
      [{ labelNormalized: "tax id number", token: "group.tin", status: "confirmed" }],
      new Set(["group.tin", "provider.npi"]),
    );
    expect(suggestions.size).toBe(0);
  });

  it("withholds ambiguous, broken, conflicting, and unreachable matches", () => {
    const cases = [
      row({ fieldLabel: "undefined" }),
      row({ fieldLabel: "Group:" }),
      row({ id: "duplicate", fieldLabel: "Group:" }),
    ];
    const evidence = [
      row({ id: "a", portalKey: "a", status: "approved", source: "token", token: "group.tin" }),
      row({ id: "b", portalKey: "b", status: "approved", source: "token", token: "provider.npi" }),
    ];
    expect(
      suggestPdfFieldMappings(cases, evidence, [], new Set(["group.tin", "provider.npi"])).size,
    ).toBe(0);
    expect(
      suggestPdfFieldMappings([row()], evidence, [], new Set(["group.tin", "provider.npi"])).size,
    ).toBe(0);
    expect(
      suggestPdfFieldMappings([row()], [evidence[0]], [], new Set(["provider.npi"])).size,
    ).toBe(0);
  });
});
