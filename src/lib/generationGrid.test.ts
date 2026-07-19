// E6.3 — the grid's trust invariant: every provider × target lands in exactly
// one bucket and the buckets always sum; skip-for-now is selection-only (no
// persistence, no reason); the reconciliation line matches the epic's wording.
import { describe, expect, it } from "vitest";
import {
  bucketGridRows,
  filterGridRows,
  groupGridRows,
  reconcileGrid,
  splitGridSelection,
} from "@/lib/generationGrid";
import type { GenerationPreviewRow, PreviewDisposition } from "@/lib/generationPreview";

const row = (
  payerId: string,
  disposition: PreviewDisposition,
  over: Partial<GenerationPreviewRow> = {},
): GenerationPreviewRow => ({
  providerId: "prov1",
  groupId: "g1",
  payerId,
  state: "NC",
  providerName: "Dr. Chen",
  groupName: "Outer Banks",
  payerName: payerId.toUpperCase(),
  disposition,
  reason: "",
  existingCase:
    disposition === "existing"
      ? { caseId: `c-${payerId}`, statusLabel: "In Progress", complete: false }
      : null,
  exclusion:
    disposition === "excluded"
      ? { exclusionId: `x-${payerId}`, reason: "panel_closed", note: null }
      : null,
  ...over,
});

const liveFact = (payerId: string) => ({
  providerId: "prov1",
  groupId: "g1",
  payerId,
  state: "NC",
  expiredAt: null,
});

// The gherkin state: 7 targets — 4 candidates, 2 enrolled by fact, 1 excluded.
function gherkinRows() {
  return bucketGridRows(
    [
      row("p1", "proposed"),
      row("p2", "proposed"),
      row("p3", "proposed"),
      row("p4", "proposed"),
      row("p5", "proposed"),
      row("p6", "proposed"),
      row("p7", "excluded"),
    ],
    [liveFact("p5"), liveFact("p6")],
  );
}

describe("bucketGridRows", () => {
  it("assigns exactly one bucket per row; live facts only override proposed", () => {
    const rows = bucketGridRows(
      [row("a", "proposed"), row("b", "existing"), row("c", "excluded")],
      [liveFact("a"), liveFact("b"), liveFact("c")],
    );
    expect(rows.map((r) => r.bucket)).toEqual(["enrolled", "existing", "excluded"]);
  });

  it("an expired fact never buckets a row enrolled", () => {
    const rows = bucketGridRows(
      [row("a", "proposed")],
      [{ ...liveFact("a"), expiredAt: "2026-07-18T00:00:00Z" }],
    );
    expect(rows[0].bucket).toBe("candidate");
  });
});

describe("reconcileGrid — the sum invariant", () => {
  it("matches the epic's gherkin line with one skip", () => {
    const rows = gherkinRows();
    const selected = new Set(rows.filter((r) => r.bucket === "candidate").map((r) => r.key));
    const all = reconcileGrid(rows, selected);
    expect(all.line).toBe("Create 4 · 1 excluded · 2 enrolled — 7 of 7 accounted for");
    expect(all.create + all.skipped + all.excluded + all.enrolled + all.existing).toBe(all.total);

    // Skip one — no reason demanded, the bucket sum still reconciles.
    const one = [...selected][0];
    selected.delete(one);
    const withSkip = reconcileGrid(rows, selected);
    expect(withSkip.line).toBe(
      "Create 3 · 1 skipped · 1 excluded · 2 enrolled — 7 of 7 accounted for",
    );
    expect(
      withSkip.create +
        withSkip.skipped +
        withSkip.excluded +
        withSkip.enrolled +
        withSkip.existing,
    ).toBe(withSkip.total);
  });
});

describe("splitGridSelection", () => {
  it("splits candidates by selection and the other buckets verbatim", () => {
    const rows = gherkinRows();
    const candidates = rows.filter((r) => r.bucket === "candidate");
    const selected = new Set(candidates.slice(0, 3).map((r) => r.key));
    const split = splitGridSelection(rows, selected);
    expect(split.selectedRows).toHaveLength(3);
    expect(split.skippedRows).toHaveLength(1);
    expect(split.enrolledRows).toHaveLength(2);
    expect(split.excludedRows).toHaveLength(1);
    expect(split.existingRows).toHaveLength(0);
  });
});

describe("groupGridRows — pivots", () => {
  it("groups by payer or provider with per-group candidate check-all keys; selection is key-stable across pivots", () => {
    const rows = bucketGridRows(
      [
        row("cigna", "proposed", { providerId: "prov2", providerName: "Dr. Adams" }),
        row("cigna", "proposed"),
        row("aetna", "proposed"),
      ],
      [],
    );
    const byPayer = groupGridRows(rows, "payer");
    expect(byPayer.map((g) => g.label)).toEqual(["AETNA", "CIGNA"]);
    expect(byPayer[1].candidateKeys).toHaveLength(2);
    expect(byPayer[1].rows.map((r) => r.row.providerName)).toEqual(["Dr. Adams", "Dr. Chen"]);

    const byProvider = groupGridRows(rows, "provider");
    expect(byProvider.map((g) => g.label)).toEqual(["Dr. Adams", "Dr. Chen"]);
    // The same underlying keys appear under both pivots — flipping the pivot
    // can never lose a selection (TS-125).
    const keysA = new Set(byPayer.flatMap((g) => g.rows.map((r) => r.key)));
    const keysB = new Set(byProvider.flatMap((g) => g.rows.map((r) => r.key)));
    expect([...keysA].sort()).toEqual([...keysB].sort());
  });
});

describe("filterGridRows — scoped entries", () => {
  it("filters by group/payer/provider and by facility via the provider→facility map", () => {
    const rows = bucketGridRows(
      [
        row("a", "proposed"),
        row("a", "proposed", { providerId: "prov2", providerName: "Dr. Adams" }),
        row("b", "proposed", { groupId: "g2", groupName: "Other" }),
      ],
      [],
    );
    expect(filterGridRows(rows, { providerId: "prov1" })).toHaveLength(2);
    expect(filterGridRows(rows, { groupId: "g1" })).toHaveLength(2);
    expect(filterGridRows(rows, { payerId: "b" })).toHaveLength(1);
    const providerFacilities = new Map([["prov1", new Set(["f1"])]]);
    expect(filterGridRows(rows, { facilityId: "f1" }, providerFacilities)).toHaveLength(2);
    expect(filterGridRows(rows, { facilityId: "f2" }, providerFacilities)).toHaveLength(0);
  });
});
