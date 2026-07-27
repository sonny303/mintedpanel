// E6.7 F6.7.3 — the near-match helpers the "+ Set up payer" dialog consumes.
// normalizePayerName mirrors the SQL _payer_norm_name key; an exact match
// here is exactly what create_payer's payer_duplicate guard rejects.
import { describe, expect, it } from "vitest";
import { findPayerNearMatches, hasBlockingPayerMatch, normalizePayerName } from "./payerNearMatch";
import type { Payer } from "@/types";

function payer(over: Partial<Payer> & Pick<Payer, "id" | "name">): Payer {
  return {
    orgId: null,
    isActive: true,
    avgDecisionDays: null,
    createdAt: "2026-07-12T00:00:00Z",
    status: "active",
    ...over,
  };
}

const AETNA = payer({ id: "aetna", name: "Aetna (CVS Health)", aliases: ["Aetna", "CVS Aetna"] });
const BCBS = payer({ id: "bcbs", name: "BCBS of Kansas", aliases: ["Blue Cross Kansas"] });
const SUCCESSOR = payer({ id: "uhc", name: "UnitedHealthcare" });
const MERGED = payer({
  id: "optum",
  name: "Optum Health Plan",
  status: "merged",
  mergedIntoId: "uhc",
});
const RETIRED = payer({ id: "old", name: "Defunct Mutual", status: "retired" });

const POOL: Payer[] = [AETNA, BCBS, MERGED, SUCCESSOR, RETIRED];

describe("normalizePayerName — the SQL-mirrored key", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizePayerName("  Aetna   (CVS   Health) ")).toBe("aetna (cvs health)");
  });

  it("keeps punctuation (only whitespace/case fold — never a slugify)", () => {
    expect(normalizePayerName("BCBS-KS, Inc.")).toBe("bcbs-ks, inc.");
  });

  it("blank input normalizes to the empty string", () => {
    expect(normalizePayerName("   ")).toBe("");
  });
});

describe("findPayerNearMatches", () => {
  it("blank query matches nothing", () => {
    expect(findPayerNearMatches("   ", POOL)).toEqual([]);
  });

  it("exact normalized name match, case/whitespace-insensitive", () => {
    const matches = findPayerNearMatches("  aetna   (cvs HEALTH) ", POOL);
    expect(matches[0]).toMatchObject({ matchKind: "exact_name" });
    expect(matches[0].payer.id).toBe("aetna");
  });

  it("exact alias match is a blocking kind of its own", () => {
    const matches = findPayerNearMatches("blue cross  kansas", POOL);
    expect(matches[0]).toMatchObject({ matchKind: "exact_alias" });
    expect(matches[0].payer.id).toBe("bcbs");
  });

  it("substring overlap is a non-blocking partial match", () => {
    const matches = findPayerNearMatches("Kansas", POOL);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ matchKind: "partial" });
    expect(matches[0].payer.id).toBe("bcbs");
  });

  it("short queries never produce partial noise (but exacts still hit)", () => {
    expect(findPayerNearMatches("ae", POOL)).toEqual([]);
  });

  it("retired rows never match — their names are re-registrable", () => {
    expect(findPayerNearMatches("Defunct Mutual", POOL)).toEqual([]);
  });

  it("a merged row surfaces its successor for the 'add that instead' redirect", () => {
    const matches = findPayerNearMatches("Optum Health Plan", POOL);
    expect(matches[0].matchKind).toBe("exact_name");
    expect(matches[0].successor?.id).toBe("uhc");
  });

  it("a merged row with an unknown successor id degrades to null, never throws", () => {
    const orphan = payer({
      id: "orphan",
      name: "Orphaned Merged Plan",
      status: "merged",
      mergedIntoId: "gone",
    });
    const matches = findPayerNearMatches("Orphaned Merged Plan", [orphan]);
    expect(matches[0].successor).toBeNull();
  });

  it("orders exact_name → exact_alias → partial, then A→Z", () => {
    const exactAlias = payer({ id: "x1", name: "Something Else", aliases: ["Acme Health"] });
    const exactName = payer({ id: "x2", name: "Acme Health" });
    const partialB = payer({ id: "x3", name: "B Acme Health Partners" });
    const partialA = payer({ id: "x4", name: "A Acme Health Partners" });
    const kinds = findPayerNearMatches("Acme Health", [partialB, exactAlias, partialA, exactName]);
    expect(kinds.map((m) => m.payer.id)).toEqual(["x2", "x1", "x4", "x3"]);
  });

  it("a status-less fixture row is treated as active (matches)", () => {
    const legacy = payer({ id: "legacy", name: "Legacy Fixture Plan", status: undefined });
    expect(findPayerNearMatches("Legacy Fixture Plan", [legacy])).toHaveLength(1);
  });
});

describe("hasBlockingPayerMatch — the pre-submit gate", () => {
  it("true for an exact name or alias collision", () => {
    expect(hasBlockingPayerMatch("AETNA (cvs health)", POOL)).toBe(true);
    expect(hasBlockingPayerMatch("cvs aetna", POOL)).toBe(true);
  });

  it("false for a mere partial resemblance", () => {
    expect(hasBlockingPayerMatch("Kansas", POOL)).toBe(false);
  });

  it("false when nothing matches", () => {
    expect(hasBlockingPayerMatch("Entirely New Plan", POOL)).toBe(false);
  });
});
