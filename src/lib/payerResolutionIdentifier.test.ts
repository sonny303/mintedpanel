// The resolution-identifier seam's chain (E6.7 F6.7.1a precedence): the
// provider_id_* pair → the deprecated legacy resolution_id_* pair
// (stop-write) → the generic default. The former org_payer_settings override
// tier is retired app-side. Each field resolves independently. The group
// identifier gets its own resolver (group pair → fixed default, NOT expected
// by default — today's behavior).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_IDENTIFIER,
  DEFAULT_RESOLUTION_IDENTIFIER,
  GROUP_PROVIDER_ID_LABEL,
  resolveGroupIdentifierConfig,
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

  it("E6.7: the provider pair beats the legacy pair, per field", () => {
    const config = resolveIdentifierConfig(
      payer({
        providerIdLabel: "Provider PIN",
        providerIdExpected: false,
        resolutionIdLabel: "Legacy Label",
        resolutionIdExpected: true,
      }),
    );
    expect(config.individualLabel).toBe("Provider PIN");
    expect(config.expected).toBe(false);
  });

  it("E6.7: an unset provider pair falls back to the legacy pair", () => {
    const config = resolveIdentifierConfig(
      payer({ resolutionIdLabel: "Legacy Label", resolutionIdExpected: false }),
    );
    expect(config.individualLabel).toBe("Legacy Label");
    expect(config.expected).toBe(false);
  });

  it("E6.7: a blank provider label falls through to legacy, then default", () => {
    expect(
      resolveIdentifierConfig(payer({ providerIdLabel: "  ", resolutionIdLabel: "Legacy Label" }))
        .individualLabel,
    ).toBe("Legacy Label");
    expect(resolveIdentifierConfig(payer({ providerIdLabel: "  " })).individualLabel).toBe(
      DEFAULT_RESOLUTION_IDENTIFIER.individualLabel,
    );
  });
});

describe("resolveGroupIdentifierConfig — the E6.7 group side", () => {
  it("no payer / unconfigured payer → the fixed default, NOT expected", () => {
    expect(resolveGroupIdentifierConfig(null)).toEqual(DEFAULT_GROUP_IDENTIFIER);
    expect(resolveGroupIdentifierConfig(payer())).toEqual(DEFAULT_GROUP_IDENTIFIER);
    expect(DEFAULT_GROUP_IDENTIFIER.groupLabel).toBe(GROUP_PROVIDER_ID_LABEL);
    expect(DEFAULT_GROUP_IDENTIFIER.expected).toBe(false);
  });

  it("the group pair wins when set", () => {
    const config = resolveGroupIdentifierConfig(
      payer({ groupIdLabel: "Group Number", groupIdExpected: true }),
    );
    expect(config.groupLabel).toBe("Group Number");
    expect(config.expected).toBe(true);
  });

  it("each field falls through independently (expected set, label unset)", () => {
    const config = resolveGroupIdentifierConfig(payer({ groupIdExpected: true }));
    expect(config.groupLabel).toBe(GROUP_PROVIDER_ID_LABEL);
    expect(config.expected).toBe(true);
  });

  it("a blank group label is unconfigured, not an override", () => {
    expect(resolveGroupIdentifierConfig(payer({ groupIdLabel: " " })).groupLabel).toBe(
      GROUP_PROVIDER_ID_LABEL,
    );
  });
});
