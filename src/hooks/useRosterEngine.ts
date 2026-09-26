// TanStack Query boundary for the Provider Roster Engine. Components call
// these hooks only; the service owns scoped reads and the /api/rosters calls.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import {
  createRosterMapping,
  downloadRosterExport,
  exportRosterMapping,
  getRosterMapping,
  getRosterMappingPreview,
  listRosterExportHistory,
  listRosterMappings,
  listRosterTemplates,
  saveRosterOverride,
  updateRosterMapping,
  validateRosterMapping,
} from "@/services/rosterEngine";

function rosterKey(orgId: string, ...parts: string[]) {
  return ["roster-engine", orgId, ...parts] as const;
}

function invalidateMapping(qc: ReturnType<typeof useQueryClient>, orgId: string, id: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: rosterKey(orgId, "mapping", id) }),
    qc.invalidateQueries({ queryKey: rosterKey(orgId, "preview", id) }),
    qc.invalidateQueries({ queryKey: rosterKey(orgId, "validation", id) }),
  ]);
}

export function useRosterTemplates() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: rosterKey(orgId, "templates"),
    queryFn: listRosterTemplates,
    enabled: orgId !== "no-org",
    staleTime: 60_000,
  });
}

export function useRosterMappings() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: rosterKey(orgId, "mappings"),
    queryFn: listRosterMappings,
    enabled: orgId !== "no-org",
    staleTime: 30_000,
  });
}

export function useCreateRosterMapping() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: createRosterMapping,
    onSuccess: async (detail) => {
      queryClient.setQueryData(rosterKey(orgId, "mapping", detail.mapping.id), detail);
      await Promise.all([
        invalidateMapping(queryClient, orgId, detail.mapping.id),
        queryClient.invalidateQueries({ queryKey: rosterKey(orgId, "mappings") }),
      ]);
    },
  });
}

export function useRosterMapping(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: rosterKey(orgId, "mapping", id ?? ""),
    queryFn: () => getRosterMapping(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
    staleTime: 0,
  });
}

export function useUpdateRosterMapping(id: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: Parameters<typeof updateRosterMapping>[1]) =>
      updateRosterMapping(id, input),
    onSuccess: async (detail) => {
      queryClient.setQueryData(rosterKey(orgId, "mapping", id), detail);
      await Promise.all([
        invalidateMapping(queryClient, orgId, id),
        queryClient.invalidateQueries({ queryKey: rosterKey(orgId, "mappings") }),
      ]);
    },
  });
}

export function useRosterPreview(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: rosterKey(orgId, "preview", id ?? ""),
    queryFn: () => getRosterMappingPreview(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
    staleTime: 0,
  });
}

export function useRosterValidation(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: rosterKey(orgId, "validation", id ?? ""),
    queryFn: () => validateRosterMapping(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
    staleTime: 0,
    retry: false,
  });
}

export function useSaveRosterOverride(id: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: Parameters<typeof saveRosterOverride>[1]) => saveRosterOverride(id, input),
    onSuccess: async () => {
      await invalidateMapping(queryClient, orgId, id);
    },
  });
}

export function useExportRosterMapping(id: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: Parameters<typeof exportRosterMapping>[1]) =>
      exportRosterMapping(id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: rosterKey(orgId, "history") }),
        queryClient.invalidateQueries({ queryKey: rosterKey(orgId, "validation", id) }),
      ]);
    },
  });
}

export function useRosterExportHistory() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: rosterKey(orgId, "history"),
    queryFn: listRosterExportHistory,
    enabled: orgId !== "no-org",
    staleTime: 30_000,
  });
}

export function useDownloadRosterExport() {
  return useMutation({ mutationFn: (id: string) => downloadRosterExport(id) });
}
