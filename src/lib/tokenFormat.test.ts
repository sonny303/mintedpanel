import { describe, it, expect } from "vitest";
import { normalizeTokenKey, normalizeFieldLabel } from "./tokenFormat";

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

describe("normalizeFieldLabel", () => {
  it("lowercases and collapses inner whitespace", () => {
    expect(normalizeFieldLabel("Tax  ID   Number")).toBe("tax id number");
  });

  it("strips a trailing colon or required-field asterisk", () => {
    expect(normalizeFieldLabel("First Name:")).toBe("first name");
    expect(normalizeFieldLabel("Individual NPI *")).toBe("individual npi");
    expect(normalizeFieldLabel("County of Practice: *")).toBe("county of practice");
  });

  it("makes casing/punctuation variants collide on one key", () => {
    expect(normalizeFieldLabel(" TAX ID number ")).toBe(normalizeFieldLabel("Tax ID Number"));
  });

  it("passes null/undefined through as null", () => {
    expect(normalizeFieldLabel(null)).toBeNull();
    expect(normalizeFieldLabel(undefined)).toBeNull();
  });
});
