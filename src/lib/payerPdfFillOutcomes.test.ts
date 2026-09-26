import { describe, expect, it } from "vitest";
import { createPayerPdfFillEventV2, type PdfWriterDisposition } from "@/lib/payerPdfFillOutcomes";
import type { PayerFormFillPlan } from "@/lib/payerFormFill";

const MAP_ID_1 = "11111111-2222-4333-8444-555555555555";
const MAP_ID_2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function plan(): PayerFormFillPlan {
  const base = {
    selector: "opaque-in-memory-only",
    label: "synthetic label",
    token: null,
    value: "synthetic value",
    fieldType: "text",
    controlOptions: null,
  };
  return {
    fill: [
      { ...base, mapId: MAP_ID_1, outcome: "token" },
      { ...base, mapId: MAP_ID_2, outcome: "fixed" },
    ],
    entries: [
      { ...base, mapId: MAP_ID_1, outcome: "token" },
      { ...base, mapId: MAP_ID_2, outcome: "fixed" },
      { ...base, mapId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", outcome: "manual", value: null },
    ],
    fieldsFilled: 2,
    fieldsSkipped: [],
    manualLabels: [],
  };
}

describe("createPayerPdfFillEventV2", () => {
  it("keeps accepted PDF writes unverified and emits no labels, selectors, or values", () => {
    const outcomes: PdfWriterDisposition[] = [
      { mapId: MAP_ID_1, kind: "accepted" },
      { mapId: MAP_ID_2, kind: "option_mismatch" },
    ];
    const metadata = createPayerPdfFillEventV2(plan(), outcomes);

    expect(metadata).toMatchObject({
      schemaVersion: 2,
      fieldsAttempted: 1,
      fieldsVerified: 0,
      fieldsRejected: 0,
    });
    expect(metadata.fieldOutcomes.map((outcome) => outcome.outcome)).toEqual([
      "unverified",
      "option_mismatch",
      "manual",
    ]);
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain("synthetic label");
    expect(serialized).not.toContain("synthetic value");
    expect(serialized).not.toContain("opaque-in-memory-only");
  });

  it("counts a post-write rejection but does not count preflight option mismatch", () => {
    const metadata = createPayerPdfFillEventV2(plan(), [
      { mapId: MAP_ID_1, kind: "rejected" },
      { mapId: MAP_ID_2, kind: "option_mismatch" },
    ]);
    expect(metadata.fieldsAttempted).toBe(1);
    expect(metadata.fieldsRejected).toBe(1);
  });
});
