// Authenticated browser facade for the narrowly approved /api/rosters/* API.
// The server resolves the organization and actor again from the verified JWT.
import { supabase } from "@/integrations/supabase/externalClient";
import { requireActiveOrg } from "@/lib/audit";
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
