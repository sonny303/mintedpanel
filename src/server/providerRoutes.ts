// Provider route handlers. These compose the existing provider service module
// (no query logic is duplicated) with an injected server context.
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  type ProviderFilters,
  type ProviderInput,
  type ProviderServiceCtx,
} from "@/services/providers";
import type { ProviderStatus } from "@/types";
import { CAQH_CURRENT_DAYS } from "@/lib/enrollmentReadiness";
import { recordFieldVerifications } from "@/services/fieldVerifications";
import { ok, fail } from "./envelope";
import { isWriter, type AuthContext } from "./guard";

const PROVIDER_STATUSES: ReadonlySet<string> = new Set(["onboarding", "active", "terminated"]);

// The provider service only needs db + orgId + writeAudit from the auth context.
function serviceCtx(ctx: AuthContext): ProviderServiceCtx {
  return { db: ctx.db, orgId: ctx.orgId, writeAudit: ctx.writeAudit };
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function handleListProviders(url: URL, ctx: AuthContext): Promise<Response> {
  const params = url.searchParams;
  const page = parsePositiveInt(params.get("page"), 1);
  const pageSize = Math.min(parsePositiveInt(params.get("pageSize"), 25), 100);

  const statusParam = params.get("status");
  const status =
    statusParam && PROVIDER_STATUSES.has(statusParam) ? (statusParam as ProviderStatus) : undefined;
  const filters: ProviderFilters = {
    groupId: params.get("groupId") ?? undefined,
    state: params.get("state") ?? undefined,
    payerId: params.get("payerId") ?? undefined,
    status,
    // Terminated providers are hidden by default (mirrors every browser
    // surface — providers.index.tsx, ManualCaseModal — which filter them
    // client-side after fetching "everyone"). An API consumer with no such
    // filter of its own, like the extension's provider picker/search, would
    // otherwise surface providers the webapp treats as gone. An explicit
    // ?status= (including ?status=terminated) always overrides this.
    excludeStatus: status ? undefined : "terminated",
    search: params.get("search") ?? undefined,
  };
  const sortColumn = params.get("sort") ?? undefined;
  const sortAscending = (params.get("order") ?? "asc").toLowerCase() !== "desc";

  const { rows, total } = await listProviders(serviceCtx(ctx), filters, {
    page,
    pageSize,
    sortColumn,
    sortAscending,
  });
  return ok(rows, { total, page, pageSize });
}

export async function handleGetProvider(id: string, ctx: AuthContext): Promise<Response> {
  const provider = await getProvider(id, serviceCtx(ctx));
  if (!provider) return fail(404, "Provider not found");
  return ok(provider);
}

export async function handleCreateProvider(body: unknown, ctx: AuthContext): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot modify providers");
  if (!body || typeof body !== "object") return fail(422, "Request body must be a JSON object");
  const input = body as ProviderInput;
  if (!input.firstName || !input.lastName) {
    return fail(422, "firstName and lastName are required");
  }
  const created = await createProvider(input, serviceCtx(ctx));
  return ok(created, null, 201);
}

export async function handleUpdateProvider(
  id: string,
  body: unknown,
  ctx: AuthContext,
): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot modify providers");
  if (!body || typeof body !== "object") return fail(422, "Request body must be a JSON object");
  const svc = serviceCtx(ctx);
  // Mirror the GET handler's not-found detection (getProvider -> null) so a
  // cross-org or nonexistent id is a 404, not the generic 500 that
  // updateProvider's .single() would raise on zero matched rows.
  const existing = await getProvider(id, svc);
  if (!existing) return fail(404, "Provider not found");
  const updated = await updateProvider(id, body as Partial<ProviderInput>, svc);
  return ok(updated);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/providers/:id/caqh-attestation — record that the human just
// re-attested this provider's CAQH profile.
//
// The column (providers.caqh_last_attested_date) and its freshness rule have
// existed since E1.8; only the write was missing, so a coordinator who
// re-attested in the CAQH portal had to reopen the webapp to say so — and
// until they did, every readiness row for that provider stayed red.
//
// Body: { attested_on?: "YYYY-MM-DD", verified_fields?: string[] }, the date
// defaulting to today. A FUTURE date is rejected: an attestation is a record of
// something that already happened, and accepting one would silently extend the
// E1.8 freshness window past what the payer would honour. Writes go through
// updateProvider, so org scoping, the cross-tenant org strip, and the UPDATE
// audit row all come from the existing path rather than a second copy.
//
// S6.2/C6: `verified_fields` are the bare catalog token keys the fill actually
// carried into CAQH. Stamping them here is what lets the Details card show a
// per-field freshness treatment (S6.1) — attesting the profile without
// recording WHICH fields it covered would leave every field equally unproven.
// Unknown-shaped entries are ignored rather than rejected: a partial stamp is
// better than losing the attestation over one malformed key.
//
// The response is deliberately narrow — the attested date and the derived
// freshness horizon, never the PHI-dense provider row a PATCH returns.
export async function handleRecordCaqhAttestation(
  id: string,
  body: unknown,
  ctx: AuthContext,
  today: string,
): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot record a CAQH attestation");
  if (body != null && (typeof body !== "object" || Array.isArray(body))) {
    return fail(422, "Request body must be a JSON object");
  }
  const raw = (body as { attested_on?: unknown } | null)?.attested_on;
  if (raw != null && typeof raw !== "string") {
    return fail(422, "attested_on must be a YYYY-MM-DD date string");
  }
  const attestedOn = raw == null || raw === "" ? today : raw;
  if (!ISO_DATE_RE.test(attestedOn)) {
    return fail(422, "attested_on must be a YYYY-MM-DD date string");
  }
  // Date-only string compare is safe for ISO dates and avoids a timezone-
  // dependent Date round-trip (the E1.8 evaluator's convention).
  if (attestedOn > today) {
    return fail(422, "attested_on cannot be in the future");
  }

  const svc = serviceCtx(ctx);
  // Same not-found contract as PATCH: a cross-org or nonexistent id is a 404,
  // never the 500 that updateProvider's .single() would raise on zero rows.
  const existing = await getProvider(id, svc);
  if (!existing) return fail(404, "Provider not found");

  const updated = await updateProvider(id, { caqhLastAttestedDate: attestedOn }, svc);

  // S6.2/C6 — stamp the fields the fill carried. Best-effort by design: the
  // attestation itself is the durable fact, and losing the per-field detail
  // must not fail a write the coordinator already performed in CAQH.
  const rawFields = (body as { verified_fields?: unknown } | null)?.verified_fields;
  const fieldKeys = Array.isArray(rawFields)
    ? rawFields.filter((f): f is string => typeof f === "string" && f.trim() !== "")
    : [];
  let verifiedFields = 0;
  if (fieldKeys.length > 0) {
    verifiedFields = await recordFieldVerifications(
      { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId, writeAudit: ctx.writeAudit },
      id,
      fieldKeys,
      "caqh",
      new Date().toISOString(),
    );
  }

  return ok({
    id: updated.id,
    caqhLastAttestedDate: updated.caqhLastAttestedDate ?? null,
    // The single source for "still current" (E1.8), so the extension never
    // hardcodes a second window that could drift from readiness.
    currentThroughDays: CAQH_CURRENT_DAYS,
    verifiedFields,
  });
}
