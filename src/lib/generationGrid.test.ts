// E6.3 — the grid's trust invariant: every provider × target lands in exactly
// one bucket and the buckets always sum; skip-for-now is selection-only (no
// persistence, no reason); the reconciliation line matches the epic's wording.
// MINT-97 — a blocked candidate is its own bucket inside the denominator.
import { describe, expect, it } from "vitest";
import {
  bucketGridRows,
  filterGridRows,
  groupGridRows,
  reconcileGrid,
  splitGridSelection,
  type GridBlocker,
} from "@/lib/generationGrid";
import {
  previewRowKey,
  type GenerationPreviewRow,
  type PreviewDisposition,
} from "@/lib/generationPreview";

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

// payer id → blocker, keyed the way the grid keys rows.
const blockersFor = (entries: Record<string, GridBlocker>) =>
  new Map(
    Object.entries(entries).map(([payerId, b]) => [previewRowKey(row(payerId, "proposed")), b]),
  );

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

  it("a blocker buckets a proposed row blocked; a live fact still wins over it", () => {
    const blockers = blockersFor({ a: "unmatched", b: "gated", c: "ambiguous" });
    const rows = bucketGridRows(
      [row("a", "proposed"), row("b", "proposed"), row("c", "proposed"), row("d", "existing")],
      [liveFact("b")],
      blockers,
    );
    expect(rows.map((r) => r.bucket)).toEqual(["blocked", "enrolled", "blocked", "existing"]);
    expect(rows.map((r) => r.blocker)).toEqual(["unmatched", undefined, "ambiguous", undefined]);
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

describe("reconcileGrid — blocked candidates (MINT-97)", () => {
  it("counts a no-SOP candidate beside an existing case — 2 of 2, never 1 of 1", () => {
    // The Oct 19 pass: one existing case + one candidate with no matching SOP.
    const rows = bucketGridRows(
      [row("p1", "existing"), row("p2", "proposed")],
      [],
      blockersFor({ p2: "unmatched" }),
    );
    const result = reconcileGrid(rows, new Set());
    expect(result.line).toBe("Create 0 · 1 blocked · 1 existing — 2 of 2 accounted for");
    expect(result.blocked).toBe(1);
    expect(result.total).toBe(2);
  });

  it("names the blocked bucket in the gherkin line and the sum still reconciles", () => {
    const rows = bucketGridRows(
      [
        row("p1", "proposed"),
        row("p2", "proposed"),
        row("p3", "proposed"),
        row("p4", "proposed"),
        row("p5", "proposed"),
        row("p6", "proposed"),
        row("p7", "excluded"),
        row("p8", "proposed"),
      ],
      [liveFact("p5"), liveFact("p6")],
      blockersFor({ p8: "gated" }),
    );
    const selected = new Set(rows.filter((r) => r.bucket === "candidate").map((r) => r.key));
    const all = reconcileGrid(rows, selected);
    expect(all.line).toBe("Create 4 · 1 blocked · 1 excluded · 2 enrolled — 8 of 8 accounted for");
    expect(
      all.create + all.skipped + all.blocked + all.excluded + all.enrolled + all.existing,
    ).toBe(all.total);
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

  it("a blocked row rides none of the confirm inputs and is never a check-all key", () => {
    const rows = bucketGridRows(
      [row("a", "proposed"), row("b", "proposed")],
      [],
      blockersFor({ b: "unmatched" }),
    );
    const split = splitGridSelection(rows, new Set(rows.map((r) => r.key)));
    const confirmed = [
      ...split.selectedRows,
      ...split.skippedRows,
      ...split.enrolledRows,
      ...split.existingRows,
      ...split.excludedRows,
    ];
    expect(confirmed.map((r) => r.payerId)).toEqual(["a"]);
    expect(groupGridRows(rows, "provider")[0].candidateKeys).toEqual([rows[0].key]);
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
