import { describe, expect, it } from "vitest";
import { filterTokenGroups, fuzzyScore, searchableTokenText } from "./tokenFuzzy";
import type { SopFieldToken, TokenGroup } from "./tokenGroups";

function t(token: string, column = "col"): SopFieldToken {
  return { token, table: "t", column };
}

function groups(): TokenGroup[] {
  return [
    {
      prefix: "provider",
      label: "Provider",
      items: [
        t("provider.npi", "npi"),
        t("provider.firstName", "first_name"),
        t("provider.lastName", "last_name"),
      ],
    },
    {
      prefix: "group",
      label: "Group",
      items: [t("group.tin", "tin"), t("group.legalName", "legal_name")],
    },
    {
      prefix: "license",
      label: "License",
      items: [t("license.licenseNumber", "license_number")],
    },
  ];
}

describe("searchableTokenText", () => {
  it("splits camelCase and dots into words", () => {
    expect(searchableTokenText("provider.firstName")).toBe("provider first name");
  });
});

describe("fuzzyScore", () => {
  it("ranks substring matches above subsequence matches", () => {
    const sub = fuzzyScore("npi", "provider.npi");
    const fuzzy = fuzzyScore("npi", "provider.namePrefix");
    expect(sub).not.toBeNull();
    expect(fuzzy).not.toBeNull();
    expect(sub!).toBeGreaterThan(fuzzy!);
  });

  it("matches camelCase words as a phrase", () => {
    expect(fuzzyScore("first name", searchableTokenText("provider.firstName"))).not.toBeNull();
  });

  it("rejects non-matches", () => {
    expect(fuzzyScore("zzz", "provider.npi")).toBeNull();
  });
});

describe("filterTokenGroups", () => {
  it("returns the catalog unchanged for a blank query", () => {
    const input = groups();
    expect(filterTokenGroups(input, "  ")).toEqual(input);
  });

  it("keeps family headings and ranks firstName for a typed field label", () => {
    const filtered = filterTokenGroups(groups(), "first name");
    expect(filtered.map((g) => g.prefix)).toEqual(["provider"]);
    expect(filtered[0].items.map((i) => i.token)).toContain("provider.firstName");
    expect(filtered[0].items[0].token).toBe("provider.firstName");
  });

  it("matches a group label so typing the family still finds its keys", () => {
    const filtered = filterTokenGroups(groups(), "license");
    expect(filtered.map((g) => g.prefix)).toEqual(["license"]);
    expect(filtered[0].items[0].token).toBe("license.licenseNumber");
  });

  it("drops empty families after filtering", () => {
    const filtered = filterTokenGroups(groups(), "tin");
    expect(filtered.map((g) => g.prefix)).toEqual(["group"]);
  });
});
