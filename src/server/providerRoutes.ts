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
  const filters: ProviderFilters = {
    groupId: params.get("groupId") ?? undefined,
    state: params.get("state") ?? undefined,
    payerId: params.get("payerId") ?? undefined,
    status:
      statusParam && PROVIDER_STATUSES.has(statusParam)
        ? (statusParam as ProviderStatus)
        : undefined,
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
