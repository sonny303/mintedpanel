// The resolution-identifier seam's two-tier chain (2026-07-20 re-scope):
// Minted-curated payer config (payers row) → generic default. The former
// org_payer_settings override tier is retired app-side. Each field resolves
// independently.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOLUTION_IDENTIFIER,
  resolveIdentifierConfig,
} from "./payerResolutionIdentifier";
import type { Payer } from "@/types";

function payer(over: Partial<Payer> = {}): Payer {
  return {
    id: "p1",
    orgId: null,
    name: "Aetna (CVS Health)",
    isActive: true,
    avgDecisionDays: null,
    createdAt: "2026-07-12T00:00:00Z",
    ...over,
  };
}

describe("resolveIdentifierConfig — tier chain", () => {
  it("no payer → the generic default", () => {
    expect(resolveIdentifierConfig(null)).toEqual(DEFAULT_RESOLUTION_IDENTIFIER);
    expect(resolveIdentifierConfig(undefined)).toEqual(DEFAULT_RESOLUTION_IDENTIFIER);
  });

  it("unconfigured payer → generic default", () => {
    expect(resolveIdentifierConfig(payer())).toEqual(DEFAULT_RESOLUTION_IDENTIFIER);
  });

  it("the Minted-curated label + expectedness win when set", () => {
    const config = resolveIdentifierConfig(
      payer({ resolutionIdLabel: "Provider ID", resolutionIdExpected: false }),
    );
    expect(config.individualLabel).toBe("Provider ID");
    expect(config.expected).toBe(false);
  });

  it("each field falls through independently (label set, expected unset)", () => {
    const config = resolveIdentifierConfig(payer({ resolutionIdLabel: "Medicare PTAN" }));
    expect(config.individualLabel).toBe("Medicare PTAN");
    expect(config.expected).toBe(DEFAULT_RESOLUTION_IDENTIFIER.expected);
  });

  it("a blank/whitespace curated label is unconfigured, not an override", () => {
    const config = resolveIdentifierConfig(payer({ resolutionIdLabel: "   " }));
    expect(config.individualLabel).toBe(DEFAULT_RESOLUTION_IDENTIFIER.individualLabel);
  });
});
