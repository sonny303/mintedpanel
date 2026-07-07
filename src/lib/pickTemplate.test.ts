import { describe, expect, it } from "vitest";
import { pickTemplate } from "./pickTemplate";
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
