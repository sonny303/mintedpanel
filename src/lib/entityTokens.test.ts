import { describe, expect, it } from "vitest";
import {
  NON_TOKEN_ENTITY_KEYS,
  buildEntityTokenValues,
  composeAddressToken,
  composeFacilityAddressTokens,
  composeProviderNameTokens,
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

describe("canonical computed entity tokens", () => {
  it("composes the frozen provider name forms and preserves credential text", () => {
    expect(
      composeProviderNameTokens({
        firstName: "  Ana ",
        lastName: "Beck  ",
        credentials: " DPT, OCS ",
      }),
    ).toEqual({
      "provider.fullName": "Ana Beck",
      "provider.lastFirst": "Beck, Ana",
      "provider.fullNameWithCredentials": "Ana Beck, DPT, OCS",
    });
  });

  it("does not emit provider composites when a required name part is missing", () => {
    expect(composeProviderNameTokens({ firstName: "Ana", lastName: " " })).toEqual({});
  });

  it("requires street for streetAddress and full street/city/state/zip for fullAddress", () => {
    expect(
      composeFacilityAddressTokens({
        street: "  1 Main St ",
        suite: " Suite 2 ",
        city: "Austin",
        state: "Texas",
        zip: "78701",
      }),
    ).toEqual({
      "facility.address": "1 Main St, Austin, Texas, 78701",
      "facility.streetAddress": "1 Main St, Suite 2",
      "facility.fullAddress": "1 Main St, Suite 2, Austin, Texas 78701",
    });
    expect(
      composeFacilityAddressTokens({ street: "1 Main St", city: "Austin", state: "TX" }),
    ).toEqual({
      "facility.address": "1 Main St, Austin, TX",
      "facility.streetAddress": "1 Main St",
    });
    expect(composeFacilityAddressTokens({ city: "Austin", state: "TX", zip: "78701" })).toEqual({
      "facility.address": "Austin, TX, 78701",
    });
  });
});
