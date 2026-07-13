import { describe, expect, it } from "vitest";
import { isFallbackTemplate, pickTemplate } from "./pickTemplate";
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
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("pickTemplate", () => {
  it("returns the first exact (group-match or group-agnostic) template in array order", () => {
    const groupSpecific = tmpl({ id: "grp", groupId: "g1" });
    const agnostic = tmpl({ id: "any", groupId: null });
    // Both qualify as exact (g1 match, or a null group), so find() returns the
    // first — group-specific does not outrank group-agnostic.
    expect(pickTemplate([groupSpecific, agnostic], "p1", "KS", "g1")?.id).toBe("grp");
    expect(pickTemplate([agnostic, groupSpecific], "p1", "KS", "g1")?.id).toBe("any");
  });

  it("matches a group-agnostic (null groupId) template as an exact match", () => {
    const agnostic = tmpl({ id: "any", groupId: null });
    expect(pickTemplate([agnostic], "p1", "KS", "g1")?.id).toBe("any");
  });

  it("prefers an exact match over a different-group fallback regardless of order", () => {
    const otherGroup = tmpl({ id: "other", groupId: "g2" });
    const agnostic = tmpl({ id: "any", groupId: null });
    // otherGroup (g2) is only a payer+state fallback; the null-group exact wins
    // even though it appears later in the array.
    expect(pickTemplate([otherGroup, agnostic], "p1", "KS", "g1")?.id).toBe("any");
  });

  it("falls back to a payer+state template for a different group when no exact exists", () => {
    const otherGroup = tmpl({ id: "other", groupId: "g2" });
    expect(pickTemplate([otherGroup], "p1", "KS", "g1")?.id).toBe("other");
  });

  it("does not match a template with a different payer", () => {
    expect(pickTemplate([tmpl({ id: "wp", payerId: "p2" })], "p1", "KS", "g1")).toBeNull();
  });

  it("does not match a template with a different state", () => {
    expect(pickTemplate([tmpl({ id: "ws", state: "MO" })], "p1", "KS", "g1")).toBeNull();
  });

  it("excludes archived templates", () => {
    const archived = tmpl({ id: "a", groupId: "g1", archived: true, isArchived: true });
    expect(pickTemplate([archived], "p1", "KS", "g1")).toBeNull();
  });

  it("skips an archived exact match in favour of a live fallback", () => {
    const archivedExact = tmpl({ id: "ax", groupId: "g1", archived: true, isArchived: true });
    const liveFallback = tmpl({ id: "lf", groupId: "g2" });
    expect(pickTemplate([archivedExact, liveFallback], "p1", "KS", "g1")?.id).toBe("lf");
  });

  it("returns null when there are no templates", () => {
    expect(pickTemplate([], "p1", "KS", "g1")).toBeNull();
  });
});

// E1.7b F1.7b.4 / TE-8 — the global-fallback tier. The fallback is a global
// (orgId null) payerless template; it is selected only when both payer tiers
// (exact, payer+state) miss.
function fallbackTmpl(over: Partial<SOPTemplate> = {}): SOPTemplate {
  return {
    ...tmpl({ id: "fb", payerId: null, state: null, groupId: null }),
    ...({ orgId: null } as unknown as Partial<SOPTemplate>),
    ...over,
  };
}

describe("pickTemplate fallback tier (E1.7b)", () => {
  it("selects the fallback when no template matches the payer", () => {
    const fallback = fallbackTmpl();
    expect(pickTemplate([fallback], "p1", "KS", "g1")?.id).toBe("fb");
  });

  it("selects the fallback when the payer matches but the state does not", () => {
    const otherState = tmpl({ id: "ws", state: "MO" });
    const fallback = fallbackTmpl();
    expect(pickTemplate([otherState, fallback], "p1", "KS", "g1")?.id).toBe("fb");
  });

  it("never selects the fallback over an exact payer+state+group match", () => {
    const exact = tmpl({ id: "grp", groupId: "g1" });
    const fallback = fallbackTmpl();
    expect(pickTemplate([fallback, exact], "p1", "KS", "g1")?.id).toBe("grp");
  });

  it("never selects the fallback over a payer+state (different group) match", () => {
    const otherGroup = tmpl({ id: "other", groupId: "g2" });
    const fallback = fallbackTmpl();
    expect(pickTemplate([fallback, otherGroup], "p1", "KS", "g1")?.id).toBe("other");
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

describe("isFallbackTemplate", () => {
  it("is true only for a global (orgId null) payerless template", () => {
    expect(isFallbackTemplate(fallbackTmpl())).toBe(true);
    expect(isFallbackTemplate(tmpl({ payerId: null }))).toBe(false);
    expect(isFallbackTemplate(fallbackTmpl({ payerId: "p1" }))).toBe(false);
  });
});
