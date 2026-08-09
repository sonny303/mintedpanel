// 3M Slice 6 / D6.4 (F24) — the ghost-portal predicate. Each case is a shape
// the global registry actually accumulates.
import { describe, expect, it } from "vitest";
import { isListableRegistryPortal, isListableSharedPortal } from "./portalVisibility";

const LIVE = { status: "active", archivedAt: null, mergedIntoId: null };

describe("isListableSharedPortal", () => {
  it("lists a global portal whose payer is live", () => {
    expect(isListableSharedPortal({ payerId: "p1", payer: LIVE })).toBe(true);
  });

  it("drops a portal with no payer — nothing can ever join it to work", () => {
    expect(isListableSharedPortal({ payerId: null, payer: LIVE })).toBe(false);
    expect(isListableSharedPortal({ payer: LIVE })).toBe(false);
    // An empty string is a payer_id nobody set, not one that resolves.
    expect(isListableSharedPortal({ payerId: "", payer: LIVE })).toBe(false);
  });

  it("drops retired and merged payers", () => {
    expect(isListableSharedPortal({ payerId: "p1", payer: { ...LIVE, status: "retired" } })).toBe(
      false,
    );
    expect(isListableSharedPortal({ payerId: "p1", payer: { ...LIVE, status: "merged" } })).toBe(
      false,
    );
    // Half-marked (merged_into_id set, status somehow still active) drops too.
    expect(
      isListableSharedPortal({ payerId: "p1", payer: { ...LIVE, mergedIntoId: "successor" } }),
    ).toBe(false);
  });

  it("drops an archived payer", () => {
    expect(
      isListableSharedPortal({
        payerId: "p1",
        payer: { ...LIVE, archivedAt: "2026-08-01T00:00:00Z" },
      }),
    ).toBe(false);
  });

  it("fails closed when the payer embed is missing or unreadable", () => {
    expect(isListableSharedPortal({ payerId: "p1", payer: null })).toBe(false);
    expect(isListableSharedPortal({ payerId: "p1" })).toBe(false);
    // A payer row that came back without its lifecycle columns is not proof
    // of life — "unknown" must not read as "active".
    expect(isListableSharedPortal({ payerId: "p1", payer: {} })).toBe(false);
    expect(isListableSharedPortal({ payerId: "p1", payer: { status: null } })).toBe(false);
  });
});

describe("isListableRegistryPortal — Work registry", () => {
  it("passes every own-org row through, whatever its payer looks like", () => {
    expect(isListableRegistryPortal({ orgId: "org-1", payerId: null, payer: null })).toBe(true);
    expect(
      isListableRegistryPortal({
        orgId: "org-1",
        payerId: "p1",
        payer: { ...LIVE, status: "retired" },
      }),
    ).toBe(true);
  });

  it("holds global rows to the shared-tier rule", () => {
    expect(isListableRegistryPortal({ orgId: null, payerId: "p1", payer: LIVE })).toBe(true);
    expect(isListableRegistryPortal({ orgId: null, payerId: null, payer: LIVE })).toBe(false);
    expect(
      isListableRegistryPortal({
        orgId: null,
        payerId: "p1",
        payer: { ...LIVE, status: "merged" },
      }),
    ).toBe(false);
  });

  it("treats an absent orgId key as global (the E6.5 tier shape)", () => {
    expect(isListableRegistryPortal({ payerId: null, payer: LIVE })).toBe(false);
  });
});
