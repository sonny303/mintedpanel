// Mission Control (platform administration). Two RPCs from the platform-admin
// migration: is_platform_admin() answers "is the caller a platform admin", and
// platform_metrics() returns the cross-org counts behind the Home tiles. Neither
// is in the generated Database types until that migration's types regen lands,
// so both go through a narrow, locally-typed shim (the invites.ts pattern).
// Deliberately not org-scoped: there is no requireActiveOrg() here, because a
// platform admin may belong to no organization. The database authorizes every
// call itself (platform_metrics() rejects a non-admin).
import { supabase } from "@/integrations/supabase/externalClient";
import type { PlatformMetrics } from "@/types";

type PlatformRpcName = "is_platform_admin" | "platform_metrics";

// supabase.rpc must be called bound — an extracted method throws at call time.
const platformRpc = () =>
  supabase.rpc.bind(supabase) as unknown as (
    name: PlatformRpcName,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * Whether the signed-in user is a platform admin. Fails closed: an RPC error, a
 * thrown request, or a non-boolean answer (an environment without the
 * migration) all read as false.
 */
export async function fetchIsPlatformAdmin(): Promise<boolean> {
  try {
    const { data, error } = await platformRpc()("is_platform_admin");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Validate the platform_metrics() document into the typed shape. Every missing
 * or malformed count becomes 0, and a missing generatedAt falls back to now, so
 * a partial document still renders.
 */
export function parsePlatformMetrics(
  value: unknown,
  now: () => Date = () => new Date(),
): PlatformMetrics {
  const doc = asRecord(value);
  const organizations = asRecord(doc.organizations);
  const users = asRecord(doc.users);
  const providers = asRecord(doc.providers);
  const cases = asRecord(doc.cases);
  return {
    generatedAt:
      typeof doc.generatedAt === "string" && !Number.isNaN(Date.parse(doc.generatedAt))
        ? doc.generatedAt
        : now().toISOString(),
    organizations: {
      total: count(organizations.total),
      active: count(organizations.active),
      prospect: count(organizations.prospect),
      inactive: count(organizations.inactive),
    },
    users: {
      total: count(users.total),
      platformAdmins: count(users.platformAdmins),
    },
    providers: {
      total: count(providers.total),
      active: count(providers.active),
      onboarding: count(providers.onboarding),
      pendingVerification: count(providers.pendingVerification),
    },
    cases: {
      total: count(cases.total),
      open: count(cases.open),
    },
    pendingInvites: count(doc.pendingInvites),
  };
}

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const { data, error } = await platformRpc()("platform_metrics");
  if (error) throw new Error(error.message);
  return parsePlatformMetrics(data);
}
