// 3M Slice 6 / D6.5 — the Template Editor's payer universe.
import { describe, expect, it } from "vitest";
import { mergeAuthoringPayers } from "./authoringPayers";
import type { Payer } from "@/types";

function payer(id: string, name: string, orgId: string | null = null): Payer {
  return { id, orgId, name } as Payer;
}

describe("mergeAuthoringPayers", () => {
  it("surfaces a catalog payer the org has NOT adopted — the D6.1 case", () => {
    // listPayers (RLS, assignment-gated) cannot see it; the catalog read can.
    const merged = mergeAuthoringPayers([], [payer("unadopted", "Banner Health Plans")]);
    expect(merged.map((p) => p.id)).toEqual(["unadopted"]);
  });

  it("keeps org-visible rows that are not in the catalog (legacy org payers)", () => {
    const merged = mergeAuthoringPayers([payer("legacy", "Legacy Plan", "org-1")], []);
    expect(merged.map((p) => p.id)).toEqual(["legacy"]);
  });

  it("de-duplicates by id — an adopted catalog payer appears once", () => {
    const merged = mergeAuthoringPayers([payer("p1", "Aetna")], [payer("p1", "Aetna")]);
    expect(merged).toHaveLength(1);
  });

  it("lets the catalog row win a collision (it is the canonical identity)", () => {
    const merged = mergeAuthoringPayers([payer("p1", "Stale Name")], [payer("p1", "Aetna")]);
    expect(merged[0].name).toBe("Aetna");
  });

  it("sorts by name so the picker reads the same either way round", () => {
    const merged = mergeAuthoringPayers([payer("b", "Beta")], [payer("a", "Alpha")]);
    expect(merged.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
  });

  it("tolerates either side being undefined mid-load", () => {
    expect(mergeAuthoringPayers(undefined, undefined)).toEqual([]);
    expect(mergeAuthoringPayers(undefined, [payer("a", "Alpha")]).map((p) => p.id)).toEqual(["a"]);
    expect(mergeAuthoringPayers([payer("b", "Beta")], undefined).map((p) => p.id)).toEqual(["b"]);
  });

  it("degrades instead of throwing when a read hands back a non-array", () => {
    // This runs during render: `for (… of 0)` is a TypeError that takes the
    // Template Editor down through the router error boundary, so a malformed
    // response must cost a shorter payer list and nothing else.
    const bad = 0 as unknown as Payer[];
    expect(() => mergeAuthoringPayers([payer("b", "Beta")], bad)).not.toThrow();
    expect(mergeAuthoringPayers([payer("b", "Beta")], bad).map((p) => p.id)).toEqual(["b"]);
    expect(mergeAuthoringPayers(bad, bad)).toEqual([]);
  });
});
