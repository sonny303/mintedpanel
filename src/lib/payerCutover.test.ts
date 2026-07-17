// E4.2 payer governance — the legacy-payer cutover rules: referenced rows can
// never be deleted before canonical re-keying, zero-reference rows are
// identifiable for the human-confirmed cleanup, the sentinel is untouchable,
// and canonical matching only proposes EXACT slug/name/alias matches (no fuzzy
// auto-match, ever).
import { describe, expect, it } from "vitest";
import {
  canDeleteLegacyPayer,
  canonicalMatchCandidates,
  isSentinelPayer,
  normalizePayerName,
  totalReferences,
  type LegacyPayerReferenceCounts,
} from "./payerCutover";
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type { Payer } from "@/types";

const ZERO: LegacyPayerReferenceCounts = {
  cases: 0,
  contracts: 0,
  routingRules: 0,
  sopTemplates: 0,
  networkTargets: 0,
  assignments: 0,
  generationExclusions: 0,
  generationRunRows: 0,
  communicationEvents: 0,
  catalogChanges: 0,
  portals: 0,
  payerSelfRefs: 0,
};

function globalPayer(over: Partial<Payer>): Payer {
  return {
    id: "gp",
    orgId: null,
    name: "Global",
    isActive: true,
    avgDecisionDays: null,
    createdAt: "2026-07-12T00:00:00Z",
    ...over,
  };
}

describe("canDeleteLegacyPayer — referenced rows are undeletable", () => {
  const legacy = { name: "BCBS of Kansas", orgId: "org-1" };

  it("blocks deletion when ANY reference table has a row", () => {
    for (const key of Object.keys(ZERO) as (keyof LegacyPayerReferenceCounts)[]) {
      const counts = { ...ZERO, [key]: 1 };
      expect(canDeleteLegacyPayer(legacy, counts)).toBe(false);
    }
  });

  it("a contract-only or SOP-only row (zero cases) still blocks", () => {
    // Rocky Mountain Health Plans in the live inventory: 0 cases but
    // 1 contract + 1 sop_template — never deletable before re-keying.
    expect(canDeleteLegacyPayer(legacy, { ...ZERO, contracts: 1, sopTemplates: 1 })).toBe(false);
  });

  it("identifies a zero-reference legacy row for the approved cleanup", () => {
    expect(canDeleteLegacyPayer(legacy, ZERO)).toBe(true);
    expect(totalReferences(ZERO)).toBe(0);
  });

  it("the Pre-Credentialing Setup sentinel is never deletable, even at zero refs", () => {
    expect(isSentinelPayer({ name: PRE_CRED_PAYER_NAME })).toBe(true);
    expect(canDeleteLegacyPayer({ name: PRE_CRED_PAYER_NAME, orgId: "org-1" }, ZERO)).toBe(false);
  });

  it("a global catalog row is not a legacy row and is never deletable here", () => {
    expect(canDeleteLegacyPayer({ name: "Aetna (CVS Health)", orgId: null }, ZERO)).toBe(false);
  });
});

describe("canonicalMatchCandidates — exact-match proposals only", () => {
  const globals = [
    globalPayer({
      id: "g-aetna",
      name: "Aetna (CVS Health)",
      payerSlug: "aetna",
      aliases: ["Aetna", "Aetna Better Health"],
    }),
    globalPayer({
      id: "g-gpma",
      name: "Great Plains Medicare Advantage",
      payerSlug: "great-plains-medicare-advantage",
      aliases: [],
    }),
    globalPayer({
      id: "g-uhc",
      name: "UnitedHealthcare",
      payerSlug: "unitedhealthcare",
      aliases: ["UHC", "UMR"],
    }),
  ];

  it("matches by exact canonical slug when the legacy row carries one", () => {
    const hits = canonicalMatchCandidates(
      { name: "Totally Different", payerSlug: "aetna" },
      globals,
    );
    expect(hits.map((p) => p.id)).toEqual(["g-aetna"]);
  });

  it("matches by exact normalized name", () => {
    const hits = canonicalMatchCandidates({ name: "UNITEDHEALTHCARE", payerSlug: null }, globals);
    expect(hits.map((p) => p.id)).toEqual(["g-uhc"]);
  });

  it("matches by exact normalized alias", () => {
    const hits = canonicalMatchCandidates({ name: "Aetna", payerSlug: null }, globals);
    expect(hits.map((p) => p.id)).toEqual(["g-aetna"]);
  });

  it("NEVER fuzzy-matches: 'Medicare' does not propose Great Plains Medicare Advantage", () => {
    expect(canonicalMatchCandidates({ name: "Medicare", payerSlug: null }, globals)).toEqual([]);
  });

  it("the sentinel never yields candidates", () => {
    expect(
      canonicalMatchCandidates({ name: PRE_CRED_PAYER_NAME, payerSlug: null }, globals),
    ).toEqual([]);
  });

  it("org-scoped rows in the pool are never proposed as canonical targets", () => {
    const pool = [...globals, globalPayer({ id: "org-row", name: "Aetna", orgId: "org-2" })];
    const hits = canonicalMatchCandidates({ name: "Aetna", payerSlug: null }, pool);
    expect(hits.map((p) => p.id)).toEqual(["g-aetna"]);
  });

  it("normalizePayerName strips punctuation/case but keeps word identity", () => {
    expect(normalizePayerName("Blue-Cross & Blue-Shield  of KANSAS ")).toBe(
      "blue cross blue shield of kansas",
    );
  });
});
