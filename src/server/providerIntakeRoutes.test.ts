import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext } from "./guard";
import { EmailError } from "./email/sendgrid";
import { INTAKE_COOKIE, hashCode, hashToken } from "./intakeTokens";
import {
  resolveAppBaseUrl,
  handleCreateProviderInvite,
  handleIntakeRequest,
  handleResendProviderInvite,
  type IntakeConfig,
  type IntakeDeps,
} from "./providerIntakeRoutes";

const GROUP = "0b6a3a52-3c9f-4f3e-9a51-6a1d2f6e7c11";
const PROVIDER = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const NOW = new Date("2026-10-25T12:00:00Z");

const CONFIG: IntakeConfig = {
  appBaseUrl: "https://staging.example.test",
  fromEmail: "no-reply@mintedpanel.com",
  emailReady: true,
  secureCookie: true,
};

function makeDeps(overrides: Partial<IntakeDeps> = {}) {
  const send = vi.fn().mockResolvedValue({ status: 202, sandbox: false });
  const deps: IntakeDeps = { config: CONFIG, send, now: () => NOW, ...overrides };
  return { deps, send: deps.send as ReturnType<typeof vi.fn> };
}

function fakeDb(result: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: result, error: null }) };
}

function ctx(db: ReturnType<typeof fakeDb>, role: AuthContext["role"] = "admin"): AuthContext {
  return {
    userId: "u1",
    orgId: "org-1",
    role,
    userName: "Jordan Seed",
    email: "jordan@minted.example",
    userMetadata: null,
    db: db as unknown as AuthContext["db"],
    writeAudit: vi.fn(),
  };
}

const INVITE = {
  firstName: "Anita",
  lastName: "Rao",
  email: "anita.rao@example.test",
  groupId: GROUP,
};

async function body(res: Response): Promise<ApiEnvelope<Record<string, unknown>>> {
  return (await res.json()) as ApiEnvelope<Record<string, unknown>>;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/provider-invites", () => {
  it("creates the invite in one RPC, then emails a link built from APP_BASE_URL", async () => {
    const db = fakeDb({
      result: "created",
      provider_id: PROVIDER,
      practice_name: "Shelby Sports Rehab",
    });
    const { deps, send } = makeDeps();
    const res = await handleCreateProviderInvite(INVITE, ctx(db), deps);

    expect(res.status).toBe(201);
    expect((await body(res)).data).toEqual({
      outcome: "created",
      providerId: PROVIDER,
      delivery: "sent",
    });
    const [rpcName, args] = db.rpc.mock.calls[0];
    expect(rpcName).toBe("create_provider_intake_invite");
    expect(args).toMatchObject({
      p_org_id: "org-1",
      p_actor_id: "u1",
      p_actor_name: "Jordan Seed",
    });
    expect(args.p_expires_at).toBe("2026-11-24T12:00:00.000Z");
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);

    const mail = send.mock.calls[0][0];
    expect(mail).toMatchObject({
      to: "anita.rao@example.test",
      template: "provider_invitation",
      practiceName: "Shelby Sports Rehab",
      replyTo: { email: "jordan@minted.example", name: "Jordan Seed" },
    });
    const token = mail.data.link.replace("https://staging.example.test/intake/", "");
    expect(hashToken(token)).toBe(args.p_token_hash);
  });

  it("writes nothing when email is not configured", async () => {
    const db = fakeDb();
    const { deps } = makeDeps({ config: { ...CONFIG, appBaseUrl: null } });
    const res = await handleCreateProviderInvite(INVITE, ctx(db), deps);
    expect(res.status).toBe(500);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("is a 403 for billing", async () => {
    const db = fakeDb();
    expect(
      (await handleCreateProviderInvite(INVITE, ctx(db, "billing"), makeDeps().deps)).status,
    ).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects bad input with 422 before calling the database", async () => {
    const db = fakeDb();
    const res = await handleCreateProviderInvite(
      { ...INVITE, email: "nope" },
      ctx(db),
      makeDeps().deps,
    );
    expect(res.status).toBe(422);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns the existing provider for a duplicate, without sending", async () => {
    const db = fakeDb({ result: "duplicate", provider_id: PROVIDER });
    const { deps, send } = makeDeps();
    const res = await handleCreateProviderInvite(INVITE, ctx(db), deps);
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ outcome: "already_exists", providerId: PROVIDER });
    expect(send).not.toHaveBeenCalled();
  });

  it("is a 404 for a group outside the caller's org", async () => {
    const db = fakeDb({ result: "group_not_found" });
    expect((await handleCreateProviderInvite(INVITE, ctx(db), makeDeps().deps)).status).toBe(404);
  });

  it("reports a failed send as delivery failed, because the invite is already saved", async () => {
    const db = fakeDb({ result: "created", provider_id: PROVIDER, practice_name: "Shelby" });
    const send = vi.fn().mockRejectedValue(new EmailError("provider_rejected", "x", 400));
    const res = await handleCreateProviderInvite(INVITE, ctx(db), makeDeps({ send }).deps);
    expect(res.status).toBe(201);
    expect((await body(res)).data).toMatchObject({ delivery: "failed" });
  });

  it("says sandbox when SendGrid accepted the mail in sandbox mode, so nobody thinks it arrived", async () => {
    const db = fakeDb({ result: "created", provider_id: PROVIDER, practice_name: "Shelby" });
    const send = vi.fn().mockResolvedValue({ status: 200, sandbox: true });
    const res = await handleCreateProviderInvite(INVITE, ctx(db), makeDeps({ send }).deps);
    expect((await body(res)).data).toMatchObject({ delivery: "sandbox" });
  });

  it("falls back to the caller's email for the audit actor name", async () => {
    const db = fakeDb({ result: "created", provider_id: PROVIDER, practice_name: "Shelby" });
    await handleCreateProviderInvite(INVITE, { ...ctx(db), userName: null }, makeDeps().deps);
    expect(db.rpc.mock.calls[0][1].p_actor_name).toBe("jordan@minted.example");
  });

  it("falls back to the from address for reply-to when the caller has no email", async () => {
    const db = fakeDb({ result: "created", provider_id: PROVIDER, practice_name: "Shelby" });
    const { deps, send } = makeDeps();
    await handleCreateProviderInvite(INVITE, { ...ctx(db), email: null }, deps);
    expect(send.mock.calls[0][0].replyTo.email).toBe("no-reply@mintedpanel.com");
  });
});

describe("POST /api/provider-invites/:id/resend", () => {
  it("maps not_found to 404 and cooldown to 429, sending nothing", async () => {
    for (const [result, status] of [
      ["not_found", 404],
      ["cooldown", 429],
    ] as const) {
      const { deps, send } = makeDeps();
      const res = await handleResendProviderInvite(PROVIDER, ctx(fakeDb({ result })), deps);
      expect(res.status).toBe(status);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("emails the new link to the address the RPC chose, and tells staff which one", async () => {
    const db = fakeDb({
      result: "resent",
      email: "anita.rao@example.test",
      first_name: "Anita",
      practice_name: "Shelby",
    });
    const { deps, send } = makeDeps();
    const res = await handleResendProviderInvite(PROVIDER, ctx(db), deps);
    expect(res.status).toBe(200);
    // The record's current email, not what staff typed, so the toast must say.
    expect((await body(res)).data).toEqual({ delivery: "sent", email: "anita.rao@example.test" });
    expect(send.mock.calls[0][0]).toMatchObject({ to: "anita.rao@example.test" });
    const token = send.mock.calls[0][0].data.link.split("/intake/")[1];
    expect(hashToken(token)).toBe(db.rpc.mock.calls[0][1].p_token_hash);
  });

  it("is a 404 for a malformed provider id, without a database call", async () => {
    const db = fakeDb();
    expect((await handleResendProviderInvite("x", ctx(db), makeDeps().deps)).status).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

function intake(path: string, init: { json?: unknown; headers?: Record<string, string> } = {}) {
  const { json, headers = {} } = init;
  const request = new Request(`https://x.test/api/intake/${path}`, {
    method: json === undefined ? "GET" : "POST",
    headers: json === undefined ? headers : { "content-type": "application/json", ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  return { request, readBody: async () => json };
}

async function call(
  path: string,
  db: ReturnType<typeof fakeDb>,
  init: { json?: unknown; headers?: Record<string, string> } = {},
  deps = makeDeps().deps,
) {
  const { request, readBody } = intake(path, init);
  return handleIntakeRequest(request, readBody, deps, db as never);
}

describe("/api/intake/*", () => {
  it("refuses a POST that isn't application/json", async () => {
    const db = fakeDb();
    const { request } = intake("code", {
      json: { t: "x" },
      headers: { "content-type": "text/plain" },
    });
    const res = await handleIntakeRequest(
      request,
      async () => ({ t: "x" }),
      makeDeps().deps,
      db as never,
    );
    expect(res.status).toBe(415);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("link: a live token returns the practice and invited email; anything else one 404", async () => {
    const live = await call("link", fakeDb({ practice_name: "Shelby", email: "a@b.test" }), {
      json: { t: "tok" },
    });
    expect((await body(live)).data).toEqual({ practiceName: "Shelby", email: "a@b.test" });
    expect(live.headers.get("cache-control")).toContain("no-store");

    const dead = await call("link", fakeDb(null), { json: { t: "tok" } });
    const missing = await call("link", fakeDb(null), { json: {} });
    expect(dead.status).toBe(404);
    expect(await dead.text()).toBe(await missing.text());
  });

  it("code: always answers sent, and emails the code only when the database says so", async () => {
    const { deps, send } = makeDeps();
    const db = fakeDb({ send: true, email: "a@b.test", practice_name: "Shelby" });
    const res = await call("code", db, { json: { t: "tok" } }, deps);
    expect((await body(res)).data).toEqual({ sent: true });

    const [, args] = db.rpc.mock.calls[0];
    const code = send.mock.calls[0][0].data.code;
    expect(code).toMatch(/^\d{6}$/);
    expect(args).toEqual({
      p_token_hash: hashToken("tok"),
      p_code_hash: hashCode(hashToken("tok"), code),
    });

    const quiet = makeDeps();
    const refused = await call("code", fakeDb({ send: false }), { json: { t: "tok" } }, quiet.deps);
    expect(await refused.text()).toBe(
      await (await call("code", db, { json: { t: "tok" } })).text(),
    );
    expect(quiet.send).not.toHaveBeenCalled();
  });

  it("code: a missing email env is a 500 before any database call, never a quiet sent", async () => {
    const db = fakeDb({ send: true, email: "a@b.test", practice_name: "Shelby" });
    const unconfigured = makeDeps({ config: { ...CONFIG, emailReady: false, fromEmail: null } });
    const res = await call("code", db, { json: { t: "tok" } }, unconfigured.deps);
    expect(res.status).toBe(500);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(unconfigured.send).not.toHaveBeenCalled();

    // The code email needs no link origin, so APP_BASE_URL alone doesn't block it.
    const noBaseUrl = makeDeps({ config: { ...CONFIG, appBaseUrl: null } });
    const sent = await call("code", db, { json: { t: "tok" } }, noBaseUrl.deps);
    expect(sent.status).toBe(200);
    expect(noBaseUrl.send).toHaveBeenCalledOnce();
  });

  it("session: a right code sets the HttpOnly cookie; a wrong one gets one generic 400", async () => {
    const good = await call("session", fakeDb("ok"), { json: { t: "tok", code: "012345" } });
    expect(good.status).toBe(200);
    const cookie = good.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(
      new RegExp(`^${INTAKE_COOKIE}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict`),
    );
    expect(await good.text()).not.toContain(cookie.split(";")[0].split("=")[1]);

    const bad = await call("session", fakeDb("invalid"), { json: { t: "tok", code: "999999" } });
    const malformed = await call("session", fakeDb(), { json: { t: "tok", code: "12ab" } });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe(await malformed.text());
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("me: needs the cookie and the link, and returns only display fields", async () => {
    expect((await call("me", fakeDb(), { json: { t: "tok" } })).status).toBe(401);
    const noLink = await call("me", fakeDb(), {
      json: {},
      headers: { cookie: `${INTAKE_COOKIE}=sess` },
    });
    expect(noLink.status).toBe(401);

    const db = fakeDb({
      practice_name: "Shelby",
      first_name: "Anita",
      last_name: "Rao",
      email: "a@b.test",
    });
    const res = await call("me", db, {
      json: { t: "tok" },
      headers: { cookie: `${INTAKE_COOKIE}=sess` },
    });
    expect((await body(res)).data).toEqual({
      practiceName: "Shelby",
      firstName: "Anita",
      lastName: "Rao",
      email: "a@b.test",
    });
    expect(db.rpc).toHaveBeenCalledWith("read_intake_session", {
      p_session_hash: hashToken("sess"),
      p_token_hash: hashToken("tok"),
    });

    const otherLink = await call("me", fakeDb(null), {
      json: { t: "someone-elses-link" },
      headers: { cookie: `${INTAKE_COOKIE}=sess` },
    });
    expect(otherLink.status).toBe(401);
  });

  it("signout: revokes the session and clears the cookie", async () => {
    const db = fakeDb();
    const res = await call("signout", db, {
      json: {},
      headers: { cookie: `${INTAKE_COOKIE}=sess` },
    });
    expect(db.rpc).toHaveBeenCalledWith("revoke_intake_session", {
      p_session_hash: hashToken("sess"),
    });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("resolveAppBaseUrl", () => {
  it("accepts a bare https origin and normalizes a trailing slash", () => {
    expect(resolveAppBaseUrl("https://staging.mintedpanel.com/", false)).toBe(
      "https://staging.mintedpanel.com",
    );
  });

  it("treats anything else as missing, so a typo fails closed instead of mailing a bad link", () => {
    for (const raw of [
      undefined,
      "",
      "http://staging.mintedpanel.com",
      "staging.mintedpanel.com",
      "https://staging.mintedpanel.com/intake",
      "https://x.test/?a=1",
    ]) {
      expect(resolveAppBaseUrl(raw, false)).toBeNull();
    }
    expect(resolveAppBaseUrl("http://localhost:8080", false)).toBeNull();
    expect(resolveAppBaseUrl("http://localhost:8080", true)).toBe("http://localhost:8080");
  });
});
