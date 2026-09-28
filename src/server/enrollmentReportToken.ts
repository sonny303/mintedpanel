import { createHmac, timingSafeEqual } from "node:crypto";
import type { EnrollmentExplorerAudience, EnrollmentReportFilters } from "@/types";
import { resolveServerSupabaseEnv } from "./env";

const TOKEN_PREFIX = "e614r1";
const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 2048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EnrollmentReportTokenContext {
  actorUserId: string;
  orgId: string;
  audience: EnrollmentExplorerAudience;
  contextRevision: string;
  filters: EnrollmentReportFilters;
}

export interface EnrollmentReportCursorKey {
  lastName: string;
  firstName: string;
  providerId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function signingKey(): Buffer {
  const serviceKey = resolveServerSupabaseEnv().serviceKey;
  if (!serviceKey) throw new Error("Server Supabase service key is unavailable");
  return createHmac("sha256", serviceKey)
    .update("minted-panel:e6.14:enrollment-report:view-token:v1", "utf8")
    .digest();
}

function mac(value: string): Buffer {
  return createHmac("sha256", signingKey()).update(value, "utf8").digest();
}

function viewMessage(
  context: EnrollmentReportTokenContext,
  snapshotDigest: string,
  expiresAt: number,
): string {
  return stableJson({
    domain: "minted-panel:e6.14:enrollment-report:view:v1",
    actorUserId: context.actorUserId,
    orgId: context.orgId,
    audience: context.audience,
    contextRevision: context.contextRevision,
    filters: context.filters,
    snapshotDigest,
    expiresAt,
  });
}

export function createEnrollmentReportViewToken(
  context: EnrollmentReportTokenContext,
  snapshotDigest: string,
  nowMs = Date.now(),
): string {
  const expiresAt = nowMs + TOKEN_TTL_MS;
  const signature = mac(viewMessage(context, snapshotDigest, expiresAt)).toString("base64url");
  return `${TOKEN_PREFIX}.${expiresAt}.${signature}`;
}

export function verifyEnrollmentReportViewToken(
  token: string,
  context: EnrollmentReportTokenContext,
  snapshotDigest: string,
  nowMs = Date.now(),
): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs) return false;
  let provided: Buffer;
  try {
    provided = Buffer.from(parts[2], "base64url");
  } catch {
    return false;
  }
  let expected: Buffer;
  try {
    expected = mac(viewMessage(context, snapshotDigest, expiresAt));
  } catch {
    return false;
  }
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected);
}

function cursorMessage(viewToken: string, key: EnrollmentReportCursorKey): string {
  return stableJson({
    domain: "minted-panel:e6.14:enrollment-report:cursor:v1",
    viewToken,
    key,
  });
}

export function createEnrollmentReportCursor(
  viewToken: string,
  key: EnrollmentReportCursorKey,
): string {
  const signature = mac(cursorMessage(viewToken, key)).toString("base64url");
  return Buffer.from(JSON.stringify({ key, signature }), "utf8").toString("base64url");
}

export function verifyEnrollmentReportCursor(
  cursor: string,
  viewToken: string,
): EnrollmentReportCursorKey | null {
  if (!cursor || cursor.length > MAX_TOKEN_LENGTH) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(decoded) || !isRecord(decoded.key) || typeof decoded.signature !== "string") {
    return null;
  }
  const { lastName, firstName, providerId } = decoded.key;
  if (
    typeof lastName !== "string" ||
    typeof firstName !== "string" ||
    typeof providerId !== "string" ||
    !UUID_PATTERN.test(providerId)
  ) {
    return null;
  }
  const key = { lastName, firstName, providerId };
  let provided: Buffer;
  try {
    provided = Buffer.from(decoded.signature, "base64url");
  } catch {
    return null;
  }
  let expected: Buffer;
  try {
    expected = mac(cursorMessage(viewToken, key));
  } catch {
    return null;
  }
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
    return null;
  }
  return key;
}
