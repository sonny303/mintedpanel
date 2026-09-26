import { describe, expect, it } from "vitest";
import { deriveProviderDiscipline } from "./providerDiscipline";

describe("deriveProviderDiscipline NUCC crosswalk", () => {
  it("maps PT base and specializations to PT", () => {
    expect(deriveProviderDiscipline("225100000X")).toBe("PT");
    expect(deriveProviderDiscipline("2251C2600X")).toBe("PT");
    expect(deriveProviderDiscipline("2251X0800X")).toBe("PT");
    expect(deriveProviderDiscipline("2251S0007X")).toBe("PT");
    expect(deriveProviderDiscipline(" 225100000x ")).toBe("PT");
  });

  it("maps PTA code to PTA", () => {
    expect(deriveProviderDiscipline("225200000X")).toBe("PTA");
    expect(deriveProviderDiscipline("225200000x")).toBe("PTA");
  });

  it("maps OT base and specializations to OT", () => {
    expect(deriveProviderDiscipline("225X00000X")).toBe("OT");
    expect(deriveProviderDiscipline("225XC0400X")).toBe("OT");
    expect(deriveProviderDiscipline("225XR0403X")).toBe("OT");
    expect(deriveProviderDiscipline("225XP0200X")).toBe("OT");
  });

  it("maps OTA base and specializations to OTA", () => {
    expect(deriveProviderDiscipline("224Z00000X")).toBe("OTA");
    expect(deriveProviderDiscipline("224ZR0403X")).toBe("OTA");
  });

  it("maps SLP codes to SLP", () => {
    expect(deriveProviderDiscipline("235Z00000X")).toBe("SLP");
    expect(deriveProviderDiscipline("2355A2700X")).toBe("SLP");
  });

  it("maps recognized non-therapy taxonomy codes to Other", () => {
    expect(deriveProviderDiscipline("133V00000X")).toBe("Other"); // Dietitian
  });

  it("maps empty, null, or unrecognized codes to Unknown", () => {
    expect(deriveProviderDiscipline(null)).toBe("Unknown");
    expect(deriveProviderDiscipline(undefined)).toBe("Unknown");
    expect(deriveProviderDiscipline("")).toBe("Unknown");
    expect(deriveProviderDiscipline("   ")).toBe("Unknown");
    expect(deriveProviderDiscipline("999999999X")).toBe("Unknown");
    expect(deriveProviderDiscipline("invalid-code")).toBe("Unknown");
  });
});
