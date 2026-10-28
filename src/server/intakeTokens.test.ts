import { describe, expect, it } from "vitest";
import {
  INTAKE_COOKIE,
  clearSessionCookie,
  hashCode,
  hashToken,
  isJsonRequest,
  newCode,
  newToken,
  readSessionToken,
  sessionCookie,
  validateInviteInput,
} from "./intakeTokens";

describe("tokens and codes", () => {
  it("makes 256-bit url-safe tokens that never repeat", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });

  it("makes six-digit codes, keeping leading zeros", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it("hashes to sha256 hex, and binds a code to its link", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashCode("link-a", "123456")).not.toBe(hashCode("link-b", "123456"));
    expect(hashCode("link-a", "123456")).toBe(hashToken("link-a:123456"));
  });
});

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Strict, scoped to /api/intake and two hours long", () => {
    const cookie = sessionCookie("tok", { secure: true });
    expect(cookie).toBe(
      `${INTAKE_COOKIE}=tok; HttpOnly; SameSite=Strict; Path=/api/intake; Max-Age=7200; Secure`,
    );
    expect(sessionCookie("tok", { secure: false })).not.toContain("Secure");
    expect(clearSessionCookie({ secure: true })).toContain("Max-Age=0");
  });

  it("reads only its own cookie from the header", () => {
    const request = new Request("https://x.test/api/intake/me", {
      headers: { cookie: `other=1; ${INTAKE_COOKIE}=abc_-123; theme=dark` },
    });
    expect(readSessionToken(request)).toBe("abc_-123");
    expect(readSessionToken(new Request("https://x.test/"))).toBeNull();
    const junk = new Request("https://x.test/", { headers: { cookie: `${INTAKE_COOKIE}=a;b` } });
    expect(readSessionToken(junk)).toBe("a");
  });
});

describe("isJsonRequest", () => {
  it("accepts application/json with or without a charset, and nothing else", () => {
    const req = (type?: string) =>
      new Request("https://x.test/", {
        method: "POST",
        headers: type ? { "content-type": type } : {},
      });
    expect(isJsonRequest(req("application/json"))).toBe(true);
    expect(isJsonRequest(req("application/json; charset=utf-8"))).toBe(true);
    expect(isJsonRequest(req("text/plain"))).toBe(false);
    expect(isJsonRequest(req("application/x-www-form-urlencoded"))).toBe(false);
    expect(isJsonRequest(req())).toBe(false);
  });
});

describe("validateInviteInput", () => {
  const GROUP = "0b6a3a52-3c9f-4f3e-9a51-6a1d2f6e7c11";
  const good = {
    firstName: " Anita ",
    lastName: "Rao",
    email: "Anita.Rao@Example.test",
    groupId: GROUP,
  };

  it("trims, lowercases the email and maps to the RPC's snake_case input", () => {
    expect(validateInviteInput({ ...good, npi: "1234567893", startDate: "2026-11-03" })).toEqual({
      ok: true,
      input: {
        first_name: "Anita",
        last_name: "Rao",
        email: "anita.rao@example.test",
        group_id: GROUP,
        npi: "1234567893",
        start_date: "2026-11-03",
      },
    });
    expect(validateInviteInput(good)).toMatchObject({
      ok: true,
      input: { npi: null, start_date: null },
    });
  });

  it("rejects missing names, a bad email, a non-uuid group, a bad NPI or date", () => {
    for (const body of [
      null,
      "x",
      { ...good, firstName: "  " },
      { ...good, lastName: undefined },
      { ...good, email: "nope" },
      { ...good, email: "a@b.com\r\nbcc: c@d.com" },
      { ...good, email: "a@.example.com" },
      { ...good, email: "a@b..com" },
      { ...good, email: ".a@example.com" },
      { ...good, email: "a.@example.com" },
      { ...good, email: "a@-example.com" },
      { ...good, groupId: "not-a-uuid" },
      { ...good, npi: "12345" },
      { ...good, startDate: "11/03/2026" },
      { ...good, startDate: "2026-02-30" },
    ]) {
      expect(validateInviteInput(body)).toMatchObject({ ok: false });
    }
  });
});
