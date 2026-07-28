import { describe, it, expect } from "vitest";
import {
  suggestTokenForLabel,
  suggestionEvidence,
  type DictionaryEntry,
  type ObservedMapping,
} from "./labelLearning";

const observed: ObservedMapping[] = [
  { label: "npi", token: "provider.npi", portalKey: "availity" },
  { label: "npi", token: "provider.npi", portalKey: "bcbs_ks" },
  { label: "npi", token: "group.npiType2", portalKey: "cigna" },
  { label: "tax id", token: "group.tin", portalKey: "availity" },
];

describe("suggestTokenForLabel (S5.3)", () => {
  it("proposes a mapping learned on OTHER payers", () => {
    // The whole point: a mapping made on Availity/BCBS surfaces on a payer
    // we've never captured.
    expect(suggestTokenForLabel("npi", [], observed, "humana")).toEqual({
      token: "provider.npi",
      portalCount: 2,
      fromDictionary: false,
    });
  });

  it("never counts the portal being captured as its own evidence", () => {
    // Excluding availity leaves one other portal for provider.npi.
    expect(suggestTokenForLabel("npi", [], observed, "availity")?.portalCount).toBe(1);
    // Excluding both leaves group.npiType2 (1 portal) as the winner.
    const narrowed = observed.filter((o) => o.portalKey !== "bcbs_ks");
    expect(suggestTokenForLabel("npi", [], narrowed, "availity")?.token).toBe("group.npiType2");
  });

  it("lets an explicit dictionary decision beat observed practice", () => {
    const dictionary: DictionaryEntry[] = [
      { label: "npi", token: "group.npiType2", status: "confirmed" },
    ];
    const result = suggestTokenForLabel("npi", dictionary, observed, null);
    expect(result?.token).toBe("group.npiType2");
    expect(result?.fromDictionary).toBe(true);
    // Evidence still counts the portals backing the CHOSEN token.
    expect(result?.portalCount).toBe(1);
  });

  it("treats a rejected dictionary entry as a decision NOT to suggest it", () => {
    const dictionary: DictionaryEntry[] = [
      { label: "npi", token: "group.npiType2", status: "rejected" },
    ];
    // Falls through to observed practice rather than honoring the rejection.
    expect(suggestTokenForLabel("npi", dictionary, observed, null)?.token).toBe("provider.npi");
  });

  it("returns null when nothing backs a guess — an honest blank", () => {
    expect(suggestTokenForLabel("mystery field", [], observed, null)).toBeNull();
    expect(suggestTokenForLabel("", [], observed, null)).toBeNull();
  });

  it("breaks ties on the token so results are stable across reads", () => {
    const tied: ObservedMapping[] = [
      { label: "x", token: "b.token", portalKey: "p1" },
      { label: "x", token: "a.token", portalKey: "p2" },
    ];
    expect(suggestTokenForLabel("x", [], tied, null)?.token).toBe("a.token");
  });
});

describe("suggestionEvidence", () => {
  it("states the payer count, singular and plural", () => {
    expect(suggestionEvidence({ token: "t", portalCount: 1, fromDictionary: false })).toBe(
      "Mapped this way on 1 other payer",
    );
    expect(suggestionEvidence({ token: "t", portalCount: 3, fromDictionary: false })).toBe(
      "Mapped this way on 3 other payers",
    );
  });

  it("falls back to the dictionary provenance when no portal backs it", () => {
    expect(suggestionEvidence({ token: "t", portalCount: 0, fromDictionary: true })).toBe(
      "Your organization mapped this label before",
    );
  });

  it("shows nothing when there is no evidence to show", () => {
    expect(suggestionEvidence({ token: "t", portalCount: 0, fromDictionary: false })).toBeNull();
  });
});
