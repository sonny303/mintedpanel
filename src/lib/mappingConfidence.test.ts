import { describe, it, expect } from "vitest";
import {
  buildDictionaryMap,
  resolveConfidence,
  resolvedSuggestionToken,
  splitBatch,
} from "./mappingConfidence";
import type { FieldDictionaryEntry, PortalFieldMap } from "@/types";

function row(partial: Partial<PortalFieldMap> = {}): PortalFieldMap {
  return {
    id: partial.id ?? "row-1",
    orgId: partial.orgId ?? "org-1",
    portalKey: "availity",
    urlPattern: null,
    pageStep: null,
    mapType: "web",
    selector: "#f",
    selectorFallbacks: null,
    source: partial.source ?? "token",
    token: partial.token ?? null,
    hardcodedValue: null,
    transform: null,
    fieldType: "text",
    notes: null,
    status: partial.status ?? "proposed",
    fieldLabel: partial.fieldLabel ?? null,
    formSection: partial.formSection ?? null,
    confidence: partial.confidence ?? null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...partial,
  };
}

function dictEntry(
  labelNormalized: string,
  token: string,
  status: FieldDictionaryEntry["status"],
): FieldDictionaryEntry {
  return {
    id: `d-${labelNormalized}`,
    orgId: "org-1",
    labelNormalized,
    token,
    status,
    seenCount: 2,
    decidedAt: null,
    decidedBy: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

describe("resolveConfidence", () => {
  it("a confirmed dictionary rule is always high", () => {
    const dict = buildDictionaryMap([dictEntry("tax id number", "group.taxId", "confirmed")]);
    expect(resolveConfidence(row({ fieldLabel: "Tax ID Number", confidence: 5 }), dict)).toBe(
      "high",
    );
  });

  it("a rejected label is forced low even with a stored token/score", () => {
    const dict = buildDictionaryMap([dictEntry("remit address", "group.remit", "rejected")]);
    expect(
      resolveConfidence(row({ fieldLabel: "Remit Address", token: "group.remit", confidence: 95 }), dict),
    ).toBe("low");
  });

  it("numeric confidence buckets: >=80 high, 40-79 medium, <40 low", () => {
    const dict = buildDictionaryMap([]);
    expect(resolveConfidence(row({ confidence: 80, token: "provider.npi" }), dict)).toBe("high");
    expect(resolveConfidence(row({ confidence: 55, token: "provider.npi" }), dict)).toBe("medium");
    expect(resolveConfidence(row({ confidence: 20, token: "provider.npi" }), dict)).toBe("low");
  });

  it("no numeric score falls back to suggestion presence", () => {
    const dict = buildDictionaryMap([dictEntry("county", "facility.county", "suggested")]);
    expect(resolveConfidence(row({ token: "facility.county" }), dict)).toBe("medium");
    expect(resolveConfidence(row({ fieldLabel: "County" }), dict)).toBe("medium");
    expect(resolveConfidence(row({ fieldLabel: "Mystery Field" }), dict)).toBe("low");
  });
});

describe("resolvedSuggestionToken", () => {
  it("a confirmed rule overrides the row's own captured token", () => {
    const dict = buildDictionaryMap([dictEntry("tax id number", "group.taxId", "confirmed")]);
    expect(
      resolvedSuggestionToken(row({ fieldLabel: "Tax ID Number", token: "group.wrong" }), dict),
    ).toBe("group.taxId");
  });

  it("falls back to the row token when no confirmed rule exists", () => {
    const dict = buildDictionaryMap([]);
    expect(resolvedSuggestionToken(row({ token: "provider.npi" }), dict)).toBe("provider.npi");
    expect(resolvedSuggestionToken(row({}), dict)).toBeNull();
  });

  it("uses a suggested rule's token only when the row captured none of its own", () => {
    const dict = buildDictionaryMap([dictEntry("npi", "provider.bar", "suggested")]);
    // row has no token -> the remembered suggested token is offered
    expect(resolvedSuggestionToken(row({ fieldLabel: "NPI" }), dict)).toBe("provider.bar");
    // row has its own token -> the suggested rule does NOT override it
    expect(resolvedSuggestionToken(row({ fieldLabel: "NPI", token: "provider.foo" }), dict)).toBe(
      "provider.foo",
    );
  });
});

describe("toTrainingCard high-without-token downgrade", () => {
  it("does not batch or lead with a high-confidence row that has no token to suggest", () => {
    const rows = [
      row({ id: "highNoTok", confidence: 95 }), // high score, token null -> downgraded
      row({ id: "med", confidence: 50, token: "provider.npi" }),
    ];
    const { batch, cards } = splitBatch(rows, []);
    expect(batch).toHaveLength(0); // nothing to confirm-all
    // both are medium now; capture order preserved, so the no-token card does
    // NOT jump ahead as a "High / No suggestion" lead card
    expect(cards.map((c) => c.confidence)).toEqual(["medium", "medium"]);
    expect(cards[0].row.id).toBe("highNoTok");
    expect(cards.find((c) => c.row.id === "highNoTok")?.suggestedToken).toBeNull();
  });
});

describe("splitBatch", () => {
  it("batches only high-confidence rows that resolve to a token", () => {
    const dict = [dictEntry("first name", "provider.firstName", "confirmed")];
    const rows = [
      row({ id: "a", fieldLabel: "First Name" }), // high via dict → batch
      row({ id: "b", confidence: 85, token: "provider.npi" }), // high via score → batch
      row({ id: "c", confidence: 90 }), // high but no token → cards
      row({ id: "d", confidence: 50, token: "facility.county" }), // medium → cards
    ];
    const { batch, cards } = splitBatch(rows, dict);
    expect(batch.map((c) => c.row.id).sort()).toEqual(["a", "b"]);
    expect(cards.map((c) => c.row.id).sort()).toEqual(["c", "d"]);
  });

  it("orders cards medium before low, preserving capture order within a tier", () => {
    const rows = [
      row({ id: "low1", confidence: 10 }),
      row({ id: "med1", confidence: 60, token: "t" }),
      row({ id: "low2", confidence: 5 }),
      row({ id: "med2", confidence: 45, token: "t" }),
    ];
    const { cards } = splitBatch(rows, []);
    expect(cards.map((c) => c.row.id)).toEqual(["med1", "med2", "low1", "low2"]);
  });

  it("carries provenance for the card UI", () => {
    const dict = [dictEntry("county", "facility.county", "suggested")];
    const { cards } = splitBatch(
      [
        row({ id: "dictionary", fieldLabel: "County", confidence: 50 }),
        row({ id: "label", token: "provider.npi", confidence: 50 }),
        row({ id: "none", fieldLabel: "Mystery", confidence: 10 }),
      ],
      dict,
    );
    const byId = Object.fromEntries(cards.map((c) => [c.row.id, c.provenance]));
    expect(byId.dictionary).toBe("dictionary");
    expect(byId.label).toBe("label");
    expect(byId.none).toBe("none");
  });
});
