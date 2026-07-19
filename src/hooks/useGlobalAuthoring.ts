// E6.5 F6.5.6 — mutations for the GLOBAL authoring tier (org_id NULL portals /
// SOP heads / field maps), all RPC-backed (no table policy allows a global
// write). Interim governance: open to all authenticated users; R7 hardens.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  markPortalProven,
  setGlobalPortalFlags,
  upsertGlobalPortal,
  type GlobalPortalInput,
} from "@/services/portals";
import { authorGlobalSop, type GlobalSopInput } from "@/services/templates";
import { trainGlobalFieldMap, type GlobalTrainPatch } from "@/services/portalFieldMaps";

export function useUpsertGlobalPortal() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: GlobalPortalInput) => upsertGlobalPortal(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) }),
  });
}

export function useSetGlobalPortalFlags() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ id, ...flags }: { id: string; verified?: boolean; proven?: boolean }) =>
      setGlobalPortalFlags(id, flags),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) }),
  });
}

/** ORG-row twin of the proven flip (plain audited update under writer RLS). */
export function useMarkPortalProven() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (id: string) => markPortalProven(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) }),
  });
}

export function useAuthorGlobalSop() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: GlobalSopInput) => authorGlobalSop(input),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: queryKeys.templates(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.template(orgId, row.id) });
    },
  });
}

export function useTrainGlobalFieldMap() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: GlobalTrainPatch }) =>
      trainGlobalFieldMap(id, patch),
    // Prefix-invalidate every portal's map cache (["portal-field-maps", orgId, *]).
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-field-maps", orgId] }),
  });
}
