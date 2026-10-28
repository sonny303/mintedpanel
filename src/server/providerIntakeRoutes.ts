// Provider onboarding slice 1 routes (docs/provider-onboarding/slice-1-invite-to-form.md §5).
//
// Staff side (full authenticate(), writers only): create and resend invites.
// Provider side (/api/intake/*, no JWT): the link, the emailed code and the
// HttpOnly session cookie. Every write is one SECURITY DEFINER RPC that is
// EXECUTE-granted to service_role only and writes its own audit rows, so these
// handlers never call writeAudit. Nothing here logs a body, email, code or token.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ok, fail } from "./envelope";
import { isWriter, type AuthContext } from "./guard";
import { getServiceClient } from "./serviceClient";
import { resolveEmailEnv } from "./email/env";
import { EmailError, sendEmail } from "./email/sendgrid";
import type { SendEmailInput } from "./email/sendgrid";
import type { TemplateKey } from "./email/templates";
import {
  INVITE_TTL_DAYS,
  SESSION_TTL_SECONDS,
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

export interface IntakeConfig {
  appBaseUrl: string | null;
  fromEmail: string | null;
  emailReady: boolean;
  secureCookie: boolean;
}

// The origin the invite email links to. Anything but a bare https origin (or
// http://localhost in dev) counts as missing, so a typo is a 500, not a bad link.
export function resolveAppBaseUrl(raw: string | undefined, dev: boolean): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(dev && local && url.protocol === "http:")) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveIntakeConfig(): IntakeConfig {
  const email = resolveEmailEnv();
  return {
    appBaseUrl: resolveAppBaseUrl(process.env.APP_BASE_URL, Boolean(import.meta.env.DEV)),
    fromEmail: email.fromEmail ?? null,
    emailReady: Boolean(email.apiKey && email.fromEmail),
    // Safari drops Secure cookies on http://localhost.
    secureCookie: !import.meta.env.DEV,
  };
}

export interface IntakeDeps {
  config: IntakeConfig;
  send: <K extends TemplateKey>(input: SendEmailInput<K>) => Promise<{ sandbox: boolean }>;
  now: () => Date;
}

function defaultDeps(): IntakeDeps {
  return {
    config: resolveIntakeConfig(),
    send: (input) => sendEmail(input),
    now: () => new Date(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function inviteExpiry(now: Date): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  return response;
}

// What staff are told about the email. "sandbox" means SendGrid accepted it
// in sandbox mode (SENDGRID_SANDBOX is exactly "true"), so nothing was
// delivered. A failure is never an error, because the invite is already saved.
export type Delivery = "sent" | "sandbox" | "failed";

async function trySend<K extends TemplateKey>(
  deps: IntakeDeps,
  input: SendEmailInput<K>,
): Promise<Delivery> {
  try {
    const { sandbox } = await deps.send(input);
    return sandbox ? "sandbox" : "sent";
  } catch (error) {
    if (!(error instanceof EmailError)) throw error;
    console.warn("[intake] email not sent:", error.kind, error.status ?? "");
    return "failed";
  }
}

function notConfigured(config: IntakeConfig): boolean {
  return !config.emailReady || !config.appBaseUrl || !config.fromEmail;
}

function actorName(ctx: AuthContext): string {
  return ctx.userName ?? ctx.email ?? "";
}

function replyToFor(ctx: AuthContext, config: IntakeConfig) {
  return { email: ctx.email ?? (config.fromEmail as string), name: ctx.userName ?? undefined };
}

type RpcResult = Record<string, unknown> | null;

export async function handleCreateProviderInvite(
  body: unknown,
  ctx: AuthContext,
  deps: IntakeDeps = defaultDeps(),
): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Only admins and specialists can invite providers");
  if (notConfigured(deps.config)) return fail(500, "Provider invites are not configured");
  const parsed = validateInviteInput(body);
  if (!parsed.ok) return fail(422, parsed.error);

  const token = newToken();
  const { data, error } = await ctx.db.rpc("create_provider_intake_invite", {
    p_org_id: ctx.orgId,
    p_actor_id: ctx.userId,
    p_actor_name: actorName(ctx),
    p_input: { ...parsed.input },
    p_token_hash: hashToken(token),
    p_expires_at: inviteExpiry(deps.now()),
  });
  if (error) throw error;
  const result = data as RpcResult;

  switch (result?.result) {
    case "invalid_input":
      return fail(422, "First name, last name, email and group are required");
    case "group_not_found":
      return fail(404, "Group not found");
    case "duplicate":
      return ok({ outcome: "already_exists", providerId: result.provider_id as string });
    case "created": {
      const practiceName = String(result.practice_name ?? "");
      const delivery = await trySend(deps, {
        to: parsed.input.email,
        template: "provider_invitation",
        data: {
          practiceName,
          firstName: parsed.input.first_name,
          link: `${deps.config.appBaseUrl}/intake/${token}`,
        },
        practiceName,
        replyTo: replyToFor(ctx, deps.config),
      });
      return ok(
        { outcome: "created", providerId: result.provider_id as string, delivery },
        null,
        201,
      );
    }
    default:
      throw new Error("create_provider_intake_invite returned an unknown result");
  }
}

export async function handleResendProviderInvite(
  providerId: string,
  ctx: AuthContext,
  deps: IntakeDeps = defaultDeps(),
): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Only admins and specialists can resend invites");
  if (notConfigured(deps.config)) return fail(500, "Provider invites are not configured");
  if (!UUID.test(providerId)) return fail(404, "Invite not found");

  const token = newToken();
  const { data, error } = await ctx.db.rpc("resend_provider_intake_invite", {
    p_org_id: ctx.orgId,
    p_actor_id: ctx.userId,
    p_actor_name: actorName(ctx),
    p_provider_id: providerId,
    p_token_hash: hashToken(token),
    p_expires_at: inviteExpiry(deps.now()),
  });
  if (error) throw error;
  const result = data as RpcResult;

  switch (result?.result) {
    case "not_found":
      return fail(404, "Invite not found");
    case "cooldown":
      return fail(429, "An invite was sent in the last 10 minutes. Try again shortly.");
    case "resent": {
      const practiceName = String(result.practice_name ?? "");
      // The RPC picks the address (the record's current email), which may not
      // be what staff typed into the dialog, so the response says which it was.
      const email = String(result.email);
      const delivery = await trySend(deps, {
        to: email,
        template: "provider_invitation",
        data: {
          practiceName,
          firstName: String(result.first_name ?? ""),
          link: `${deps.config.appBaseUrl}/intake/${token}`,
        },
        practiceName,
        replyTo: replyToFor(ctx, deps.config),
      });
      return ok({ delivery, email });
    }
    default:
      throw new Error("resend_provider_intake_invite returned an unknown result");
  }
}

const INTAKE_ROUTE = /^\/api\/intake\/(link|code|session|me|signout)\/?$/;
const CODE = /^\d{6}$/;

function field(body: unknown, key: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

// The provider side. `readBody` is api.ts's bounded JSON reader.
export async function handleIntakeRequest(
  request: Request,
  readBody: () => Promise<unknown>,
  deps: IntakeDeps = defaultDeps(),
  injectedDb?: SupabaseClient<Database>,
): Promise<Response> {
  const match = new URL(request.url).pathname.match(INTAKE_ROUTE);
  if (!match) return fail(404, "Not found");
  const action = match[1];
  const method = request.method.toUpperCase();

  if (method !== "POST") return noStore(fail(405, "Method not allowed"));
  if (!isJsonRequest(request)) return noStore(fail(415, "Send application/json"));
  const body = await readBody();
  const db = injectedDb ?? getServiceClient();

  if (action === "link") return noStore(await readLink(body, db));
  if (action === "code") return noStore(await issueCode(body, db, deps));
  if (action === "session") return noStore(await openSession(body, db, deps));
  if (action === "me") return noStore(await readMe(request, body, db));
  return noStore(await signOut(request, db, deps));
}

async function readLink(body: unknown, db: SupabaseClient<Database>): Promise<Response> {
  const token = field(body, "t");
  if (!token) return fail(404, "invalid_link");
  const { data, error } = await db.rpc("read_intake_link", { p_token_hash: hashToken(token) });
  if (error) throw error;
  const link = data as RpcResult;
  if (!link) return fail(404, "invalid_link");
  return ok({ practiceName: String(link.practice_name), email: String(link.email) });
}

// Always the same answer, whether or not a code was created or sent. A missing
// email env is the one exception: that is a server fault, not a link state, so
// it is a 500 before any code is issued, never a "sent" nobody can receive.
async function issueCode(
  body: unknown,
  db: SupabaseClient<Database>,
  deps: IntakeDeps,
): Promise<Response> {
  if (!deps.config.emailReady) return fail(500, "Provider intake is not configured");
  const token = field(body, "t");
  if (token) {
    const code = newCode();
    const linkHash = hashToken(token);
    const { data, error } = await db.rpc("issue_intake_code", {
      p_token_hash: linkHash,
      p_code_hash: hashCode(linkHash, code),
    });
    if (error) throw error;
    const result = data as RpcResult;
    if (result?.send === true) {
      const practiceName = String(result.practice_name ?? "");
      await trySend(deps, {
        to: String(result.email),
        template: "intake_code",
        data: { practiceName, code },
        practiceName,
        replyTo: { email: deps.config.fromEmail as string },
      });
    }
  }
  return ok({ sent: true });
}

async function openSession(
  body: unknown,
  db: SupabaseClient<Database>,
  deps: IntakeDeps,
): Promise<Response> {
  const token = field(body, "t");
  const code = field(body, "code");
  if (!token || !CODE.test(code)) return fail(400, "code_invalid");

  const linkHash = hashToken(token);
  const sessionToken = newToken();
  const expiresAt = new Date(deps.now().getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  const { data, error } = await db.rpc("verify_intake_code", {
    p_token_hash: linkHash,
    p_code_hash: hashCode(linkHash, code),
    p_session_hash: hashToken(sessionToken),
    p_session_expires_at: expiresAt,
  });
  if (error) throw error;
  if (data !== "ok") return fail(400, "code_invalid");

  const response = ok({ signedIn: true });
  response.headers.append(
    "set-cookie",
    sessionCookie(sessionToken, { secure: deps.config.secureCookie }),
  );
  return response;
}

// Bound to the link being opened: a session from another invite is signed out.
async function readMe(
  request: Request,
  body: unknown,
  db: SupabaseClient<Database>,
): Promise<Response> {
  const sessionToken = readSessionToken(request);
  const token = field(body, "t");
  if (!sessionToken || !token) return fail(401, "signed_out");
  const { data, error } = await db.rpc("read_intake_session", {
    p_session_hash: hashToken(sessionToken),
    p_token_hash: hashToken(token),
  });
  if (error) throw error;
  const me = data as RpcResult;
  if (!me) return fail(401, "signed_out");
  return ok({
    practiceName: String(me.practice_name),
    firstName: String(me.first_name),
    lastName: String(me.last_name),
    email: String(me.email),
  });
}

async function signOut(
  request: Request,
  db: SupabaseClient<Database>,
  deps: IntakeDeps,
): Promise<Response> {
  const sessionToken = readSessionToken(request);
  if (sessionToken) {
    const { error } = await db.rpc("revoke_intake_session", {
      p_session_hash: hashToken(sessionToken),
    });
    if (error) throw error;
  }
  const response = ok({ signedOut: true });
  response.headers.append("set-cookie", clearSessionCookie({ secure: deps.config.secureCookie }));
  return response;
}
