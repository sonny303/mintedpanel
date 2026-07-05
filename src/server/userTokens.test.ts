import { describe, it, expect } from "vitest";
import { resolveUserTokens } from "./userTokens";

describe("resolveUserTokens", () => {
  it("resolves user.name from user_metadata.full_name and user.email from the claim", () => {
    const { tokens, notes } = resolveUserTokens({
      email: "sowmya@minted.com",
      userMetadata: { full_name: "Sowmya S", name: "ignored" },
    });
    expect(tokens).toEqual([
      { token: "user.name", value: "Sowmya S" },
      { token: "user.email", value: "sowmya@minted.com" },
    ]);
    expect(notes).toEqual([]);
  });

  it("falls back to user_metadata.name when full_name is absent", () => {
    const { tokens, notes } = resolveUserTokens({
      email: "s@minted.com",
      userMetadata: { name: "Sowmya" },
    });
    expect(tokens[0]).toEqual({ token: "user.name", value: "Sowmya" });
    expect(notes).toEqual([]);
  });

  it("trims whitespace and treats blank strings as absent", () => {
    const { tokens, notes } = resolveUserTokens({
      email: "  s@minted.com  ",
      userMetadata: { full_name: "   ", name: " Sowmya " },
    });
    expect(tokens).toEqual([
      { token: "user.name", value: "Sowmya" },
      { token: "user.email", value: "s@minted.com" },
    ]);
    expect(notes).toEqual([]);
  });

  it("resolves absent metadata to empty strings and says so in notes", () => {
    const { tokens, notes } = resolveUserTokens({ email: null, userMetadata: null });
    expect(tokens).toEqual([
      { token: "user.name", value: "" },
      { token: "user.email", value: "" },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("user.name");
    expect(notes[1]).toContain("user.email");
  });

  it("ignores non-string metadata values", () => {
    const { tokens, notes } = resolveUserTokens({
      email: "s@minted.com",
      userMetadata: { full_name: 42, name: { first: "S" } },
    });
    expect(tokens[0]).toEqual({ token: "user.name", value: "" });
    expect(notes).toHaveLength(1);
  });
});
