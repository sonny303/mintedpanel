import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { CONTACT_TOKEN_FIELDS, CONTACT_TOKEN_FAMILIES } from "@/lib/orgContactTokens";
import { USER_TOKEN_FIELDS } from "@/lib/quickCardCatalog";

export interface BatchLearnMappingInput {
  selector: string;
  token: string;
  confidence: number;
  field_type: "text" | "select" | "radio" | "checkbox" | "date";
}

export interface BatchLearnPortalFieldMapsInput {
  case_id: string;
  provider_id: string;
  fill_session_id: string;
  portal_key: string;
  page_url: string;
  mappings: BatchLearnMappingInput[];
}

export interface BatchLearnPortalFieldMapsCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
}

export interface BatchLearnPortalFieldMapsResponse {
  inserted_count: number;
  confirmed_saved_count: number;
  preserved_count: number;
  results: Array<{
    selector: string;
    token: string;
    outcome: "inserted" | "already_present" | "preserved";
  }>;
}

export type BatchLearnPortalFieldMapsResult =
  | { kind: "ok"; response: BatchLearnPortalFieldMapsResponse }
  | { kind: "rejected"; status: 403 | 404 | 409 | 422; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const ALLOWED_FIELD_TYPES = new Set(["text", "select", "radio", "checkbox", "date"]);
const MAX_MAPPINGS = 32;
const MAX_SELECTOR_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const CONTACT_TOKENS = new Set(
  CONTACT_TOKEN_FAMILIES.flatMap(({ prefix }) =>
    CONTACT_TOKEN_FIELDS.map(({ field }) => `${prefix}.${field}`),
  ),
);
const USER_TOKENS = new Set(USER_TOKEN_FIELDS);

export interface ValidatedBatchLearnInput {
  caseId: string;
  providerId: string;
  fillSessionId: string;
  portalKey: string;
  urlPattern: string;
  mappings: BatchLearnMappingInput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const orderedExpected = [...expected].sort();
  return (
    actual.length === orderedExpected.length && actual.every((key, i) => key === orderedExpected[i])
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function reject(message: string): BatchLearnPortalFieldMapsResult {
  return { kind: "rejected", status: 422, message };
}

/** Validate a value-free request and reduce its page URL to origin + path. */
export function validateBatchLearnInput(
  body: unknown,
): { ok: true; input: ValidatedBatchLearnInput } | { ok: false; message: string } {
  if (
    !isRecord(body) ||
    !hasExactKeys(body, [
      "case_id",
      "provider_id",
      "fill_session_id",
      "portal_key",
      "page_url",
      "mappings",
    ])
  ) {
    return { ok: false, message: "Request must contain only the required batch-learn fields" };
  }
  if (!UUID_RE.test(String(body.case_id)) || !UUID_RE.test(String(body.provider_id))) {
    return { ok: false, message: "case_id and provider_id must be UUIDs" };
  }
  if (!UUID_RE.test(String(body.fill_session_id))) {
    return { ok: false, message: "fill_session_id must be a UUID" };
  }
  if (typeof body.portal_key !== "string") return { ok: false, message: "portal_key is required" };
  const portalKey = normalizePortalKey(body.portal_key);
  if (!portalKey || portalKey.length > 100 || !/^[a-z0-9][a-z0-9_-]*$/.test(portalKey)) {
    return { ok: false, message: "portal_key is invalid" };
  }
  if (
    typeof body.page_url !== "string" ||
    body.page_url.length > MAX_URL_LENGTH ||
    body.page_url.trim() === ""
  ) {
    return { ok: false, message: "page_url must be a valid HTTP(S) URL" };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.page_url);
  } catch {
    return { ok: false, message: "page_url must be a valid HTTP(S) URL" };
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    return { ok: false, message: "page_url must be a valid HTTP(S) URL" };
  }
  const urlPattern = `${parsedUrl.origin}${parsedUrl.pathname}`;
  if (urlPattern.length > MAX_URL_LENGTH || /[?#]/.test(urlPattern)) {
    return { ok: false, message: "page_url scope is invalid" };
  }
  if (
    !Array.isArray(body.mappings) ||
    body.mappings.length < 1 ||
    body.mappings.length > MAX_MAPPINGS
  ) {
    return { ok: false, message: `mappings must contain 1 to ${MAX_MAPPINGS} entries` };
  }

  const seenSelectors = new Set<string>();
  const mappings: BatchLearnMappingInput[] = [];
  for (const candidate of body.mappings) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["selector", "token", "confidence", "field_type"])
    ) {
      return {
        ok: false,
        message: "Each mapping must contain only selector, token, confidence, and field_type",
      };
    }
    if (typeof candidate.selector !== "string" || typeof candidate.token !== "string") {
      return { ok: false, message: "selector and token must be strings" };
    }
    const selector = candidate.selector.trim();
    const token = candidate.token.trim();
    if (
      selector.length === 0 ||
      selector.length > MAX_SELECTOR_LENGTH ||
      hasControlCharacter(selector) ||
      /\[\s*value\s*=/i.test(selector)
    ) {
      return { ok: false, message: "selector is invalid" };
    }
    if (seenSelectors.has(selector)) return { ok: false, message: "selectors must be unique" };
    seenSelectors.add(selector);
    if (!TOKEN_RE.test(token) || /ssn/i.test(token))
      return { ok: false, message: "token is invalid" };
    if (
      typeof candidate.confidence !== "number" ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0.85 ||
      candidate.confidence > 1
    ) {
      return { ok: false, message: "confidence must be between 0.85 and 1" };
    }
    if (
      typeof candidate.field_type !== "string" ||
      !ALLOWED_FIELD_TYPES.has(candidate.field_type)
    ) {
      return { ok: false, message: "field_type is invalid" };
    }
    mappings.push({
      selector,
      token,
      confidence: candidate.confidence,
      field_type: candidate.field_type as BatchLearnMappingInput["field_type"],
    });
  }

  return {
    ok: true,
    input: {
      caseId: body.case_id as string,
      providerId: body.provider_id as string,
      fillSessionId: body.fill_session_id as string,
      portalKey,
      urlPattern,
      mappings,
    },
  };
}

function getCatalogTokens(value: Json | null): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const tokens = value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.token !== "string") return [];
    return [entry.token];
  });
  return new Set(tokens);
}

function isAllowedToken(token: string, catalog: Set<string>): boolean {
  return (
    !/ssn/i.test(token) &&
    (catalog.has(token) || USER_TOKENS.has(token) || CONTACT_TOKENS.has(token))
  );
}

/**
 * Persist accepted suggestions only after SQL re-validates membership,
 * fill-session provenance, successful submission touch, exact catalog keys,
 * preservation and atomic audit. All actor/tenant identifiers come from ctx.
 */
export async function batchLearnPortalFieldMaps(
  ctx: BatchLearnPortalFieldMapsCtx,
  body: unknown,
): Promise<BatchLearnPortalFieldMapsResult> {
  const validated = validateBatchLearnInput(body);
  if (!validated.ok) return reject(validated.message);
  const { input } = validated;

  const { data: catalogData, error: catalogError } = await ctx.db.rpc("get_sop_field_tokens");
  if (catalogError) throw catalogError;
  const catalog = getCatalogTokens(catalogData);
  if (input.mappings.some(({ token }) => !isAllowedToken(token, catalog))) {
    return reject("token must be in the current field catalog");
  }

  const { data, error } = await ctx.db.rpc("learn_portal_field_maps_from_touch", {
    p_org_id: ctx.orgId,
    p_actor_id: ctx.userId,
    p_case_id: input.caseId,
    p_provider_id: input.providerId,
    p_fill_session_id: input.fillSessionId,
    p_portal_key: input.portalKey,
    p_url_pattern: input.urlPattern,
    p_mappings: input.mappings as unknown as Json,
  });
  if (error) throw error;
  if (!isRecord(data) || data.kind !== "ok") {
    const reason =
      isRecord(data) && typeof data.reason === "string" ? data.reason : "invalid_result";
    if (reason === "not_authorized") {
      return { kind: "rejected", status: 403, message: "Your role cannot save AI field mappings" };
    }
    if (
      reason === "case_not_found" ||
      reason === "fill_not_found" ||
      reason === "submission_not_found"
    ) {
      return { kind: "rejected", status: 404, message: "Submission evidence not found" };
    }
    if (reason.startsWith("invalid_") || reason === "catalog_unavailable") {
      return reject("AI field mapping batch failed validation");
    }
    return { kind: "rejected", status: 409, message: "Submission evidence could not be confirmed" };
  }

  const response = data as unknown as BatchLearnPortalFieldMapsResponse;
  if (
    !Number.isInteger(response.inserted_count) ||
    !Number.isInteger(response.confirmed_saved_count) ||
    !Number.isInteger(response.preserved_count) ||
    !Array.isArray(response.results)
  ) {
    throw new Error("Batch-learn RPC returned an invalid response");
  }
  return { kind: "ok", response };
}
