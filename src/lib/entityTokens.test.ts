import { describe, expect, it } from "vitest";
import {
  NON_TOKEN_ENTITY_KEYS,
  buildEntityTokenValues,
  composeAddressToken,
  entityTokenValues,
} from "./entityTokens";

describe("entityTokenValues", () => {
  it("keys every populated column as <prefix>.<camelColumn>", () => {
    const tokens = entityTokenValues("provider", {
      firstName: "Jordan",
      deaNumber: "BJ1234563",
      malpracticeCarrier: "  MedPro  ",
    });
    expect(tokens).toEqual({
      "provider.firstName": "Jordan",
      "provider.deaNumber": "BJ1234563",
      "provider.malpracticeCarrier": "MedPro",
    });
  });

  it("omits absent and blank columns instead of blanking them", () => {
    const tokens = entityTokenValues("provider", {
      firstName: "Jordan",
      lastName: null,
      suffix: undefined,
      credentials: "   ",
    });
    expect(Object.keys(tokens)).toEqual(["provider.firstName"]);
  });

  it("omits the keys the token catalog never emits", () => {
    const entity: Record<string, unknown> = { name: "Riverbend Clinic" };
    for (const key of NON_TOKEN_ENTITY_KEYS) entity[key] = "leaked";
    expect(entityTokenValues("facility", entity)).toEqual({ "facility.name": "Riverbend Clinic" });
  });

  it("renders booleans, numbers, and primitive arrays as an answer a form can carry", () => {
    const tokens = entityTokenValues("provider", {
      boardCertified: true,
      medicaidAttested: false,
      yearsPracticing: 12,
      languages: ["Spanish", "ASL"],
    });
    expect(tokens["provider.boardCertified"]).toBe("Yes");
    expect(tokens["provider.medicaidAttested"]).toBe("No");
    expect(tokens["provider.yearsPracticing"]).toBe("12");
    expect(tokens["provider.languages"]).toBe("Spanish, ASL");
  });

  it("omits a jsonb blob rather than resolving it to [object Object]", () => {
    const tokens = entityTokenValues("facility", {
      name: "Riverbend Clinic",
      hours: { mon: "9-5" },
      accessibility: [{ ada: true }],
    });
    expect(tokens).toEqual({ "facility.name": "Riverbend Clinic" });
  });

  it("returns nothing for an entity that is not in hand", () => {
    expect(entityTokenValues("mso", null)).toEqual({});
  });
});

describe("buildEntityTokenValues", () => {
  it("unions the families, each under its own prefix", () => {
    const tokens = buildEntityTokenValues({
      provider: { firstName: "Jordan", name: "ignored-by-prefix" },
      group: { name: "BEST Physical Therapy" },
      facility: null,
    });
    expect(tokens["provider.firstName"]).toBe("Jordan");
    expect(tokens["group.name"]).toBe("BEST Physical Therapy");
    expect(tokens["provider.name"]).toBe("ignored-by-prefix");
    expect(Object.keys(tokens).some((k) => k.startsWith("facility."))).toBe(false);
  });
});

describe("composeAddressToken", () => {
  it("joins the populated parts and skips the gaps", () => {
    expect(composeAddressToken(["101 Main St", null, "TX", "  "])).toBe("101 Main St, TX");
  });

  it("is null when no part is populated", () => {
    expect(composeAddressToken([null, undefined, ""])).toBeNull();
  });
});
