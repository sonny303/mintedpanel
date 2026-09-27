// Authenticated browser facade for the narrowly approved /api/rosters/* API,
// plus an RLS-scoped facility option read. The server resolves the organization
// and actor again from the verified JWT for roster mutations.
import { supabase } from "@/integrations/supabase/externalClient";
import { requireActiveOrg } from "@/lib/audit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  CreateRosterMappingInput,
  RosterExportFormat,
  RosterExportSnapshot,
  RosterMapping,
  RosterMappingDetail,
  RosterOverride,
  RosterPreview,
  RosterTemplate,
  RosterValidationResult,
  SaveRosterOverrideInput,
  UpdateRosterMappingInput,
} from "@/types";

interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}

export interface RosterFacilityOption {
  id: string;
  name: string;
  state: string | null;
}

// Match the roster source-option ceiling. The extra record detects overflow
// rather than presenting a silently truncated set of selectable locations.
export async function listRosterFacilityOptions(
  ctx: { db: SupabaseClient<Database>; orgId: string } = {
    db: supabase,
    orgId: requireActiveOrg(),
  },
): Promise<RosterFacilityOption[]> {
  const pageSize = 500;
  const limit = 5000;
  const rows: RosterFacilityOption[] = [];
  for (let from = 0; from <= limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit);
    const { data, error } = await ctx.db
      .from("facilities")
      .select("id,name,state")
      .eq("org_id", ctx.orgId)
      .order("name")
      .order("id")
      .range(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (rows.length > limit)
      throw new Error("Roster location options exceed the 5,000 record selection limit");
    if (page.length < to - from + 1) return rows;
  }
  throw new Error("Roster location options exceed the 5,000 record selection limit");
}

async function rosterApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      "x-org-id": orgId,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || body.data === null)
    throw new Error(body.error ?? `Roster request failed (${response.status})`);
  return body.data;
}

export function listRosterTemplates(): Promise<RosterTemplate[]> {
  return rosterApiFetch("/api/rosters/templates");
}

export function listRosterMappings(): Promise<RosterMapping[]> {
  return rosterApiFetch("/api/rosters/mappings");
}

export function getRosterMapping(id: string): Promise<RosterMappingDetail> {
  return rosterApiFetch(`/api/rosters/mappings/${encodeURIComponent(id)}`);
}

export function createRosterMapping(input: CreateRosterMappingInput): Promise<RosterMappingDetail> {
  return rosterApiFetch("/api/rosters/mappings", { method: "POST", body: JSON.stringify(input) });
}

export function updateRosterMapping(
  id: string,
  input: UpdateRosterMappingInput,
): Promise<RosterMappingDetail> {
  return rosterApiFetch(`/api/rosters/mappings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getRosterMappingPreview(id: string): Promise<RosterPreview> {
  return rosterApiFetch(`/api/rosters/mappings/${encodeURIComponent(id)}/preview`);
}

export function validateRosterMapping(id: string): Promise<RosterValidationResult> {
  return rosterApiFetch(`/api/rosters/mappings/${encodeURIComponent(id)}/validate`, {
    method: "POST",
  });
}

export function saveRosterOverride(
  id: string,
  input: SaveRosterOverrideInput,
): Promise<RosterOverride> {
  return rosterApiFetch(`/api/rosters/mappings/${encodeURIComponent(id)}/overrides`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function exportRosterMapping(
  id: string,
  input: {
    format: RosterExportFormat;
    expectedInputFingerprint: string;
    idempotencyKey: string;
  },
): Promise<RosterExportSnapshot> {
  return rosterApiFetch(`/api/rosters/mappings/${encodeURIComponent(id)}/export`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listRosterExportHistory(): Promise<RosterExportSnapshot[]> {
  return rosterApiFetch("/api/rosters/history");
}

export async function downloadRosterExport(id: string): Promise<Blob> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const response = await fetch(`/api/rosters/exports/${encodeURIComponent(id)}/download`, {
    headers: { authorization: `Bearer ${token}`, "x-org-id": orgId },
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiEnvelope<unknown>;
    throw new Error(body.error ?? `Roster download failed (${response.status})`);
  }
  return response.blob();
}
