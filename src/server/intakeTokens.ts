// Provider intake helpers (docs/provider-onboarding/slice-1-invite-to-form.md).
// Tokens and codes are made here; only their sha256 hashes go to the database.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { isEmailAddress } from "./email/sendgrid";

export const INTAKE_COOKIE = "mp_intake";
export const SESSION_TTL_SECONDS = 2 * 60 * 60;
export const INVITE_TTL_DAYS = 30;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Bound to the link, so a code issued for one invite is useless on another.
export function hashCode(linkTokenHash: string, code: string): string {
  return hashToken(`${linkTokenHash}:${code}`);
}

export function sessionCookie(token: string, { secure }: { secure: boolean }): string {
  const cookie = `${INTAKE_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/intake; Max-Age=${SESSION_TTL_SECONDS}`;
  return secure ? `${cookie}; Secure` : cookie;
}

export function clearSessionCookie({ secure }: { secure: boolean }): string {
  const cookie = `${INTAKE_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/intake; Max-Age=0`;
  return secure ? `${cookie}; Secure` : cookie;
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === INTAKE_COOKIE) return rest.join("=") || null;
  }
  return null;
}

// With SameSite=Strict, requiring a JSON body is the CSRF defence: a
// cross-site form can't send application/json without a preflight.
export function isJsonRequest(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0].trim().toLowerCase() === "application/json";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NPI = /^\d{10}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export interface InviteRpcInput {
  first_name: string;
  last_name: string;
  email: string;
  group_id: string;
  npi: string | null;
  start_date: string | null;
}

export function validateInviteInput(
  body: unknown,
): { ok: true; input: InviteRpcInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;
  const firstName = text(b.firstName);
  const lastName = text(b.lastName);
  const email = text(b.email).toLowerCase();
  const groupId = text(b.groupId);
  const npi = text(b.npi);
  const startDate = text(b.startDate);

  if (!firstName || !lastName) return { ok: false, error: "First and last name are required" };
  if (!isEmailAddress(email)) return { ok: false, error: "Enter a valid email address" };
  if (!UUID.test(groupId)) return { ok: false, error: "Choose a group" };
  if (npi && !NPI.test(npi)) return { ok: false, error: "NPI must be 10 digits" };
  if (startDate && !isCalendarDate(startDate)) return { ok: false, error: "Start date is invalid" };

  return {
    ok: true,
    input: {
      first_name: firstName,
      last_name: lastName,
      email,
      group_id: groupId,
      npi: npi || null,
      start_date: startDate || null,
    },
  };
}
