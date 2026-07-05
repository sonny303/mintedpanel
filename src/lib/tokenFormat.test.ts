import { describe, it, expect } from "vitest";
import { normalizeTokenKey } from "./tokenFormat";

describe("normalizeTokenKey", () => {
  it("strips a {{...}} wrapper down to the bare catalog form", () => {
    expect(normalizeTokenKey("{{provider.firstName}}")).toBe("provider.firstName");
  });

  it("tolerates whitespace inside and around the braces", () => {
    expect(normalizeTokenKey("  {{ provider.firstName }}  ")).toBe("provider.firstName");
  });

  it("leaves a bare token unchanged", () => {
    expect(normalizeTokenKey("provider.firstName")).toBe("provider.firstName");
    expect(normalizeTokenKey("user.email")).toBe("user.email");
  });

  it("trims a bare token", () => {
    expect(normalizeTokenKey(" group.tin ")).toBe("group.tin");
  });

  it("passes null/undefined through as null (manual field-map rows have no token)", () => {
    expect(normalizeTokenKey(null)).toBeNull();
    expect(normalizeTokenKey(undefined)).toBeNull();
  });

  it("does not mangle a partially-braced or non-token string", () => {
    expect(normalizeTokenKey("{{provider.firstName")).toBe("{{provider.firstName");
    expect(normalizeTokenKey("provider.firstName}}")).toBe("provider.firstName}}");
  });
});
