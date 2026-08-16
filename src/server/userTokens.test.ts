import { describe, it, expect } from "vitest";
import { resolveUserTokens } from "./userTokens";
import type { AuthContext } from "./guard";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  full_name: string | null;
  email: string | null;
};

/** Minimal PostgREST-shaped fake for the ONE read this module does:
 * .from("profiles").select(...).eq("id", userId).maybeSingle().
 * `profile: null` stands for "no row / read failed", which must fall back to
 * auth metadata rather than throw. */
function ctxWith(args: {
  email: string | null;
  userMetadata: Record<string, unknown> | null;
  profile?: ProfileRow | null;
  failRead?: boolean;
}): Pick<AuthContext, "userId" | "email" | "userMetadata" | "db"> {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            args.failRead
              ? { data: null, error: { message: "boom" } }
              : { data: args.profile ?? null, error: null },
        }),
      }),
    }),
  };
  return {
    userId: "user-1",
    email: args.email,
    userMetadata: args.userMetadata,
    db: db as unknown as AuthContext["db"],
  };
}

const EMPTY_PROFILE: ProfileRow = {
  first_name: null,
  last_name: null,
  title: null,
  full_name: null,
  email: null,
};

function valueOf(tokens: { token: string; value: unknown }[], key: string) {
  return tokens.find((t) => t.token === key)?.value;
}

describe("resolveUserTokens", () => {
  it("resolves name/first/last/title from the caller's profiles row", async () => {
    const { tokens, notes } = await resolveUserTokens(
      ctxWith({
        email: "sowmya@minted.com",
        userMetadata: null,
        profile: {
          first_name: "Sowmya",
          last_name: "Surapureddy",
          title: "Credentialing Manager",
          full_name: "stale value",
          email: null,
        },
      }),
    );
    // The COMPOSED parts win over the stored full_name mirror.
    expect(valueOf(tokens, "user.name")).toBe("Sowmya Surapureddy");
    expect(valueOf(tokens, "user.firstName")).toBe("Sowmya");
    expect(valueOf(tokens, "user.lastName")).toBe("Surapureddy");
    expect(valueOf(tokens, "user.title")).toBe("Credentialing Manager");
    expect(valueOf(tokens, "user.email")).toBe("sowmya@minted.com");
    expect(notes).toEqual([]);
  });

  it("emits exactly the five keys, and never a user.fullName synonym", async () => {
    const { tokens } = await resolveUserTokens(
      ctxWith({ email: "s@minted.com", userMetadata: null, profile: EMPTY_PROFILE }),
    );
    expect(tokens.map((t) => t.token)).toEqual([
      "user.name",
      "user.firstName",
      "user.lastName",
      "user.title",
      "user.email",
    ]);
  });

  it("falls back to profiles.full_name for a row that predates the name split", async () => {
    const { tokens } = await resolveUserTokens(
      ctxWith({
        email: "s@minted.com",
        userMetadata: null,
        profile: { ...EMPTY_PROFILE, full_name: "Legacy Name" },
      }),
    );
    expect(valueOf(tokens, "user.name")).toBe("Legacy Name");
    // Unset parts stay honestly empty — never split from the display name.
    expect(valueOf(tokens, "user.firstName")).toBe("");
    expect(valueOf(tokens, "user.lastName")).toBe("");
  });

  it("falls back to auth metadata full_name, then name, when no profile row exists", async () => {
    const viaFullName = await resolveUserTokens(
      ctxWith({
        email: "s@minted.com",
        userMetadata: { full_name: "Sowmya S", name: "ignored" },
        profile: null,
      }),
    );
    expect(valueOf(viaFullName.tokens, "user.name")).toBe("Sowmya S");

    const viaName = await resolveUserTokens(
      ctxWith({ email: "s@minted.com", userMetadata: { name: "Sowmya" }, profile: null }),
    );
    expect(valueOf(viaName.tokens, "user.name")).toBe("Sowmya");
  });

  it("degrades to metadata rather than throwing when the profiles read fails", async () => {
    const { tokens } = await resolveUserTokens(
      ctxWith({
        email: "s@minted.com",
        userMetadata: { full_name: "Sowmya S" },
        failRead: true,
      }),
    );
    expect(valueOf(tokens, "user.name")).toBe("Sowmya S");
    expect(valueOf(tokens, "user.email")).toBe("s@minted.com");
  });

  it("trims whitespace and treats blank strings as absent", async () => {
    const { tokens } = await resolveUserTokens(
      ctxWith({
        email: "  s@minted.com  ",
        userMetadata: { full_name: "   ", name: " Sowmya " },
        profile: { ...EMPTY_PROFILE, first_name: "  ", title: "  Manager  " },
      }),
    );
    expect(valueOf(tokens, "user.name")).toBe("Sowmya");
    expect(valueOf(tokens, "user.firstName")).toBe("");
    expect(valueOf(tokens, "user.title")).toBe("Manager");
    expect(valueOf(tokens, "user.email")).toBe("s@minted.com");
  });

  it("ignores non-string metadata values", async () => {
    const { tokens } = await resolveUserTokens(
      ctxWith({
        email: "s@minted.com",
        userMetadata: { full_name: 42, name: { first: "S" } },
        profile: null,
      }),
    );
    expect(valueOf(tokens, "user.name")).toBe("");
  });

  it("names every empty token in notes so a coordinator knows what to go fill in", async () => {
    const { tokens, notes } = await resolveUserTokens(
      ctxWith({ email: null, userMetadata: null, profile: null }),
    );
    expect(tokens.every((t) => t.value === "")).toBe(true);
    expect(notes).toHaveLength(5);
    for (const key of [
      "user.name",
      "user.firstName",
      "user.lastName",
      "user.title",
      "user.email",
    ]) {
      expect(notes.some((n) => n.includes(key))).toBe(true);
    }
  });

  it("prefers the JWT email claim but falls back to the profile email", async () => {
    const { tokens } = await resolveUserTokens(
      ctxWith({
        email: null,
        userMetadata: null,
        profile: { ...EMPTY_PROFILE, email: "fallback@minted.com" },
      }),
    );
    expect(valueOf(tokens, "user.email")).toBe("fallback@minted.com");
  });
});
