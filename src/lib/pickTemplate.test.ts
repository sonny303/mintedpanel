import { describe, expect, it } from "vitest";
import {
  isFallbackTemplate,
  pickTemplate,
  resolutionTier,
  ALL_STATES_SENTINEL,
} from "./pickTemplate";
import type { SOPTemplate } from "@/types";

function tmpl(over: Partial<SOPTemplate>): SOPTemplate {
  return {
    id: over.id ?? "t1",
    orgId: "org",
    name: over.name ?? "T",
    groupId: over.groupId ?? null,
    state: over.state ?? "KS",
    specialty: null,
    payerId: over.payerId ?? "p1",
    taskDefinitions: [],
    isArchived: over.isArchived ?? false,
    archived: over.archived ?? false,
    createdAt: over.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

// A global payer-specific catalog SOP: orgId null, but payerId present.
function globalPayerTmpl(over: Partial<SOPTemplate> = {}): SOPTemplate {
  return {
    ...tmpl({ id: "gp", ...over }),
    ...({ orgId: null } as unknown as Partial<SOPTemplate>),
  };
}

// The seeded generic fallback: global (orgId null) and payerless.
function fallbackTmpl(over: Partial<SOPTemplate> = {}): SOPTemplate {
  return {
    ...tmpl({ id: "fb", payerId: null, state: null, groupId: null }),
    ...({ orgId: null } as unknown as Partial<SOPTemplate>),
    ...over,
  };
}

describe("pickTemplate — group precedence (exact beats any, order-independent)", () => {
  it("selects the exact-group template over the any-group template regardless of array order", () => {
    const exact = tmpl({ id: "grp", groupId: "g1" });
    const anyGroup = tmpl({ id: "any", groupId: null });
    expect(pickTemplate([exact, anyGroup], "p1", "KS", "g1")?.id).toBe("grp");
    // Reverse the array: the exact-group template STILL wins — no Array.find order.
    expect(pickTemplate([anyGroup, exact], "p1", "KS", "g1")?.id).toBe("grp");
  });

  it("uses the any-group (null groupId) template only when no exact-group template exists", () => {
    const anyGroup = tmpl({ id: "any", groupId: null });
    expect(pickTemplate([anyGroup], "p1", "KS", "g1")?.id).toBe("any");
  });

  it("never selects a template authored for a DIFFERENT group", () => {
    const otherGroup = tmpl({ id: "other", groupId: "g2" });
    // g2's template is not the requested group and not group-agnostic → no match.
    expect(pickTemplate([otherGroup], "p1", "KS", "g1")).toBeNull();
  });

  it("prefers the exact-group match over an any-group match regardless of order", () => {
    const exact = tmpl({ id: "grp", groupId: "g1" });
    const anyGroup = tmpl({ id: "any", groupId: null });
    expect(pickTemplate([anyGroup, exact], "p1", "KS", "g1")?.id).toBe("grp");
    expect(pickTemplate([exact, anyGroup], "p1", "KS", "g1")?.id).toBe("grp");
  });

  it("matches an any-group template for a null-group request but never a specific-group one", () => {
    const anyGroup = tmpl({ id: "any", groupId: null });
    const specific = tmpl({ id: "spec", groupId: "g5" });
    expect(pickTemplate([specific, anyGroup], "p1", "KS", null)?.id).toBe("any");
    expect(pickTemplate([specific], "p1", "KS", null)).toBeNull();
  });
});

describe("pickTemplate — D3.3-G ownership at equal specificity", () => {
  it("an organization override beats a global payer-specific SOP (same payer/state/group)", () => {
    const orgExact = tmpl({ id: "org-exact", groupId: "g1" });
    const globalExact = globalPayerTmpl({ id: "global-exact", groupId: "g1" });
    expect(pickTemplate([globalExact, orgExact], "p1", "KS", "g1")?.id).toBe("org-exact");
    expect(pickTemplate([orgExact, globalExact], "p1", "KS", "g1")?.id).toBe("org-exact");
  });

  it("a global exact-group SOP beats an org any-group SOP (group before ownership)", () => {
    const orgAny = tmpl({ id: "org-any", groupId: null });
    const globalExact = globalPayerTmpl({ id: "global-exact", groupId: "g1" });
    // Rank 2 (global exact+exact group) < rank 3 (org exact+any group).
    expect(pickTemplate([orgAny, globalExact], "p1", "KS", "g1")?.id).toBe("global-exact");
    expect(pickTemplate([globalExact, orgAny], "p1", "KS", "g1")?.id).toBe("global-exact");
  });

  it("a global payer-specific SOP beats the generic fallback", () => {
    const globalPayer = globalPayerTmpl({ id: "global-any", groupId: null });
    const fallback = fallbackTmpl();
    expect(pickTemplate([fallback, globalPayer], "p1", "KS", "g1")?.id).toBe("global-any");
    expect(pickTemplate([globalPayer, fallback], "p1", "KS", "g1")?.id).toBe("global-any");
  });

  it("a global payer exact-group SOP beats a global payer any-group SOP", () => {
    const globalExact = globalPayerTmpl({ id: "g-exact", groupId: "g1" });
    const globalAny = globalPayerTmpl({ id: "g-any", groupId: null });
    expect(pickTemplate([globalAny, globalExact], "p1", "KS", "g1")?.id).toBe("g-exact");
  });
});

describe("pickTemplate — All-states (D3.3-G)", () => {
  it("All + any-group resolves for concrete case states when nothing better exists", () => {
    const allAny = tmpl({ id: "all-any", state: ALL_STATES_SENTINEL, groupId: null });
    expect(pickTemplate([allAny], "p1", "NC", "g1")?.id).toBe("all-any");
    expect(pickTemplate([allAny], "p1", "SC", "g1")?.id).toBe("all-any");
  });

  it("exact state beats All for the same ownership + group grain", () => {
    const exact = tmpl({ id: "nc", state: "NC", groupId: "g1" });
    const all = tmpl({ id: "all", state: ALL_STATES_SENTINEL, groupId: "g1" });
    expect(pickTemplate([all, exact], "p1", "NC", "g1")?.id).toBe("nc");
    expect(pickTemplate([exact, all], "p1", "SC", "g1")?.id).toBe("all");
  });

  it("global exact + exact group beats org All + exact group (state before ownership)", () => {
    const orgAll = tmpl({ id: "org-all", state: ALL_STATES_SENTINEL, groupId: "g1" });
    const globalExact = globalPayerTmpl({ id: "g-nc", state: "NC", groupId: "g1" });
    expect(pickTemplate([orgAll, globalExact], "p1", "NC", "g1")?.id).toBe("g-nc");
  });

  it("exact group beats any-group at All-states across ownership", () => {
    const orgAllAny = tmpl({ id: "org-all-any", state: ALL_STATES_SENTINEL, groupId: null });
    const globalAllExact = globalPayerTmpl({
      id: "g-all-g1",
      state: ALL_STATES_SENTINEL,
      groupId: "g1",
    });
    expect(pickTemplate([orgAllAny, globalAllExact], "p1", "NC", "g1")?.id).toBe("g-all-g1");
  });

  it("org All beats global All at equal group specificity", () => {
    const orgAll = tmpl({ id: "org-all", state: ALL_STATES_SENTINEL, groupId: null });
    const globalAll = globalPayerTmpl({ id: "g-all", state: ALL_STATES_SENTINEL, groupId: null });
    expect(pickTemplate([globalAll, orgAll], "p1", "NC", "g1")?.id).toBe("org-all");
  });

  it("All never masquerades as the generic fallback", () => {
    const all = tmpl({ id: "all", state: ALL_STATES_SENTINEL, groupId: null });
    const fallback = fallbackTmpl();
    expect(pickTemplate([fallback, all], "p1", "NC", "g1")?.id).toBe("all");
  });

  it("All for a different group never resolves", () => {
    const allOther = tmpl({ id: "all-g2", state: ALL_STATES_SENTINEL, groupId: "g2" });
    expect(pickTemplate([allOther], "p1", "NC", "g1")).toBeNull();
  });
});

describe("pickTemplate — wrong payer / state / archived never match", () => {
  it("does not match a template with a different payer", () => {
    expect(pickTemplate([tmpl({ id: "wp", payerId: "p2" })], "p1", "KS", "g1")).toBeNull();
  });

  it("does not match a template with a different state (and not All)", () => {
    expect(pickTemplate([tmpl({ id: "ws", state: "MO" })], "p1", "KS", "g1")).toBeNull();
  });

  it("excludes an archived exact-group template", () => {
    const archived = tmpl({ id: "a", groupId: "g1", archived: true, isArchived: true });
    expect(pickTemplate([archived], "p1", "KS", "g1")).toBeNull();
  });

  it("skips an archived exact-group match in favour of a live any-group template", () => {
    const archivedExact = tmpl({ id: "ax", groupId: "g1", archived: true, isArchived: true });
    const liveAny = tmpl({ id: "lany", groupId: null });
    expect(pickTemplate([archivedExact, liveAny], "p1", "KS", "g1")?.id).toBe("lany");
  });

  it("returns null when there are no templates", () => {
    expect(pickTemplate([], "p1", "KS", "g1")).toBeNull();
  });

  // 3M Slice 6 / D6.5: widening sop_templates_select made every GLOBAL row
  // readable without an org_payer_assignments row, so listTemplates now hands
  // this resolver templates for payers the org has not adopted. That is safe
  // only because payer match is exact — the extra rows are, by construction,
  // for other payers, and a case can only exist for an adopted one.
  it("ignores newly visible global SOPs for payers this case is not for", () => {
    const unadopted = globalPayerTmpl({ id: "unadopted", payerId: "p-unadopted", groupId: null });
    const mine = tmpl({ id: "mine", groupId: "g1" });
    expect(pickTemplate([unadopted, mine], "p1", "KS", "g1")?.id).toBe("mine");
    // And with nothing of the org's own, an unrelated payer's SOP is still
    // not a candidate — the fallback tier decides, exactly as before.
    expect(pickTemplate([unadopted], "p1", "KS", "g1")).toBeNull();
  });
});

// The global-fallback tier (E1.7b F1.7b.4 / TE-8). The fallback is a global
// (orgId null) payerless template; it is selected only when every payer tier
// misses.
describe("pickTemplate — generic fallback tier", () => {
  it("selects the fallback when no template matches the payer", () => {
    expect(pickTemplate([fallbackTmpl()], "p1", "KS", "g1")?.id).toBe("fb");
  });

  it("selects the fallback when the payer matches but the state does not", () => {
    const otherState = tmpl({ id: "ws", state: "MO" });
    expect(pickTemplate([otherState, fallbackTmpl()], "p1", "KS", "g1")?.id).toBe("fb");
  });

  it("selects the fallback when only a DIFFERENT-group payer SOP exists (it is not a candidate)", () => {
    const otherGroup = tmpl({ id: "other", groupId: "g2" });
    // g2's template does not resolve for g1, so the fallback wins — a
    // different group's SOP never stands in for the requested group.
    expect(pickTemplate([otherGroup, fallbackTmpl()], "p1", "KS", "g1")?.id).toBe("fb");
  });

  it("never selects the fallback over an exact payer+state+group match", () => {
    const exact = tmpl({ id: "grp", groupId: "g1" });
    expect(pickTemplate([fallbackTmpl(), exact], "p1", "KS", "g1")?.id).toBe("grp");
  });

  it("never selects the fallback over an any-group payer+state match", () => {
    const anyGroup = tmpl({ id: "any", groupId: null });
    expect(pickTemplate([fallbackTmpl(), anyGroup], "p1", "KS", "g1")?.id).toBe("any");
  });

  it("does not treat an ORG payerless template as the fallback", () => {
    const orgPayerless = tmpl({ id: "orgnull", payerId: null, state: null });
    expect(pickTemplate([orgPayerless], "p1", "KS", "g1")).toBeNull();
  });

  it("excludes an archived fallback", () => {
    const archivedFallback = fallbackTmpl({ archived: true, isArchived: true });
    expect(pickTemplate([archivedFallback], "p1", "KS", "g1")).toBeNull();
  });

  it("returns null when nothing matches and no fallback exists", () => {
    expect(pickTemplate([tmpl({ id: "wp", payerId: "p2" })], "p1", "KS", "g1")).toBeNull();
  });
});

describe("pickTemplate — deterministic tiebreak within a tier", () => {
  it("selects the same template regardless of array order when two candidates share a tier", () => {
    // Two org any-group candidates (a uniqueness-constraint violation in
    // practice) still resolve deterministically by createdAt then id.
    const older = tmpl({ id: "b-older", groupId: null, createdAt: "2026-01-01T00:00:00Z" });
    const newer = tmpl({ id: "a-newer", groupId: null, createdAt: "2026-06-01T00:00:00Z" });
    expect(pickTemplate([older, newer], "p1", "KS", "g1")?.id).toBe("b-older");
    expect(pickTemplate([newer, older], "p1", "KS", "g1")?.id).toBe("b-older");
  });
});

describe("isFallbackTemplate", () => {
  it("is true only for a global (orgId null) payerless template", () => {
    expect(isFallbackTemplate(fallbackTmpl())).toBe(true);
    expect(isFallbackTemplate(tmpl({ payerId: null }))).toBe(false); // org payerless
    expect(isFallbackTemplate(fallbackTmpl({ payerId: "p1" }))).toBe(false); // global payer
  });
});

describe("resolutionTier", () => {
  it("classifies an org-owned template as 'organization'", () => {
    expect(resolutionTier(tmpl({ id: "o", groupId: "g1" }))).toBe("organization");
    expect(resolutionTier(tmpl({ id: "o2", groupId: null }))).toBe("organization");
  });

  it("classifies a global payer-specific template as 'global_payer'", () => {
    expect(resolutionTier(globalPayerTmpl())).toBe("global_payer");
  });

  it("classifies the payerless global fallback as 'generic_fallback'", () => {
    expect(resolutionTier(fallbackTmpl())).toBe("generic_fallback");
  });
});
