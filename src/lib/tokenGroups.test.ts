import { describe, it, expect } from "vitest";
import { groupTokens, TOKEN_GROUP_ORDER } from "./tokenGroups";
import type { SopFieldToken } from "@/lib/tokenGroups";

const t = (token: string): SopFieldToken => ({ table: "x", token, column: "c" }) as SopFieldToken;

describe("groupTokens", () => {
  it("orders known families by the curated order, not alphabetically", () => {
    const groups = groupTokens([t("user.name"), t("provider.npi"), t("group.tin")]);
    expect(groups.map((g) => g.prefix)).toEqual(["provider", "group", "user"]);
  });

  it("labels families for display", () => {
    expect(groupTokens([t("groupInsurance.carrier")])[0].label).toBe("Group Insurance");
  });

  it("keeps an unknown family selectable rather than dropping it", () => {
    // A new column becoming a token must never be silently unmappable.
    const groups = groupTokens([t("provider.npi"), t("zebra.field")]);
    expect(groups.map((g) => g.prefix)).toEqual(["provider", "zebra"]);
    expect(groups[1].label).toBe("zebra");
  });

  it("sorts unknown families alphabetically after the known ones", () => {
    const groups = groupTokens([t("beta.a"), t("alpha.a"), t("provider.npi")]);
    expect(groups.map((g) => g.prefix)).toEqual(["provider", "alpha", "beta"]);
  });

  it("keeps every token in its family", () => {
    const groups = groupTokens([t("provider.npi"), t("provider.firstName")]);
    expect(groups[0].items.map((i) => i.token)).toEqual(["provider.npi", "provider.firstName"]);
  });

  it("covers the contact families the 2026-08-07 token work added", () => {
    for (const p of ["billingContact", "credentialingContact", "contractingSigner"]) {
      expect(TOKEN_GROUP_ORDER).toContain(p);
    }
  });
});
