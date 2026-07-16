// E4.2 payer governance — the resolution-identifier seam's three-tier chain:
// org setting (org_payer_settings) → Minted-curated global config (payers row)
// → generic default. Each field resolves independently.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOLUTION_IDENTIFIER,
  resolveIdentifierConfig,
} from "./payerResolutionIdentifier";
import type { OrgPayerSetting, Payer } from "@/types";

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

function setting(over: Partial<OrgPayerSetting> = {}): OrgPayerSetting {
  return {
    id: "s1",
    orgId: "org-1",
    payerId: "p1",
    resolutionIdLabel: null,
    resolutionIdExpected: null,
    updatedBy: null,
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    ...over,
  };
}

describe("resolveIdentifierConfig — tier chain", () => {
  it("no payer, no setting → the generic default", () => {
    expect(resolveIdentifierConfig(null)).toEqual(DEFAULT_RESOLUTION_IDENTIFIER);
    expect(resolveIdentifierConfig(undefined, undefined)).toEqual(DEFAULT_RESOLUTION_IDENTIFIER);
  });

  it("unconfigured payer and unconfigured setting → generic default", () => {
    const config = resolveIdentifierConfig(payer(), setting());
    expect(config).toEqual(DEFAULT_RESOLUTION_IDENTIFIER);
  });

  it("org setting wins over the Minted global config", () => {
    const config = resolveIdentifierConfig(
      payer({ resolutionIdLabel: "Provider ID", resolutionIdExpected: true }),
      setting({ resolutionIdLabel: "Provider PIN", resolutionIdExpected: false }),
    );
    expect(config.individualLabel).toBe("Provider PIN");
    expect(config.expected).toBe(false);
  });

  it("falls back to the Minted global label when the org setting is unset", () => {
    const config = resolveIdentifierConfig(payer({ resolutionIdLabel: "Provider ID" }), null);
    expect(config.individualLabel).toBe("Provider ID");
  });

  it("each field falls through independently (org label unset, org expected set)", () => {
    const config = resolveIdentifierConfig(
      payer({ resolutionIdLabel: "Provider ID", resolutionIdExpected: true }),
      setting({ resolutionIdLabel: null, resolutionIdExpected: false }),
    );
    expect(config.individualLabel).toBe("Provider ID");
    expect(config.expected).toBe(false);
  });

  it("a blank/whitespace org label is unconfigured, not an override", () => {
    const config = resolveIdentifierConfig(payer(), setting({ resolutionIdLabel: "   " }));
    expect(config.individualLabel).toBe(DEFAULT_RESOLUTION_IDENTIFIER.individualLabel);
  });

  it("org setting alone works with no payer row at hand", () => {
    const config = resolveIdentifierConfig(null, setting({ resolutionIdLabel: "Payer PIN" }));
    expect(config.individualLabel).toBe("Payer PIN");
    expect(config.expected).toBe(DEFAULT_RESOLUTION_IDENTIFIER.expected);
  });
});
