// Payer, SOP template, status config, and audit-log query hooks. (MSO routing
// retired in E6.5 F6.5.5 — delegation is a curated payer-catalog fact + SOP
// content now; the msos/mso_routing_rules tables stay dormant per the
// additive rule.)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { getPayer, listPayers } from "@/services/payers";
import {
  createTemplate,
  getTemplate,
  getTemplateVersion,
  listTemplates,
  listTemplateVersions,
  publishTemplate,
  updateTemplate,
  type TemplateInput,
} from "@/services/templates";
import type { SOPTaskDefinition } from "@/types";
import {
  createStatusConfig,
  getStatusConfig,
  listStatusConfigs,
  updateStatusConfig,
  type StatusConfigInput,
} from "@/services/statusConfigs";
import { listAuditLog, type AuditFilters } from "@/services/audit";
import type { StatusTrack } from "@/types";

export function usePayers() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.payers(orgId),
    queryFn: listPayers,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function usePayer(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.payer(orgId, id ?? ""),
    queryFn: () => getPayer(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
  });
}

// E4.2 payer governance: there is deliberately NO useCreatePayer and NO
// useUpdatePayer — canonical payer identities are selected from the Minted
// catalog (payer-directory → org_payer_assignments) and Minted-curated facts
// are org-read-only. (The org_payer_settings override tier retired
// 2026-07-20 — the table stays dormant with no app reader.)

export function useSops() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.templates(orgId),
    queryFn: listTemplates,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useSop(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.template(orgId, id ?? ""),
    queryFn: () => getTemplate(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
  });
}

export function useCreateSop() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: TemplateInput) => createTemplate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.templates(orgId) }),
  });
}

export function useUpdateSop(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (patch: Partial<TemplateInput>) => updateTemplate(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.template(orgId, id) });
    },
  });
}

// E1.7b — publish creates an immutable version row via the RPC (which writes
// the audit row). Invalidates the head caches AND the version history.
export function usePublishSop(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: {
      expectedVersion: number;
      name: string;
      taskDefinitions: SOPTaskDefinition[];
      changeNote?: string | null;
      requiredProfileAttributes?: string[];
    }) =>
      publishTemplate(
        id,
        input.expectedVersion,
        input.name,
        input.taskDefinitions,
        input.changeNote,
        input.requiredProfileAttributes,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.template(orgId, id) });
      qc.invalidateQueries({ queryKey: queryKeys.templateVersions(orgId, id) });
    },
  });
}

export function useTemplateVersions(templateId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.templateVersions(orgId, templateId ?? ""),
    queryFn: () => listTemplateVersions(templateId as string),
    enabled: orgId !== "no-org" && Boolean(templateId),
  });
}

export function useTemplateVersion(templateId: string | undefined, version: number | null) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.templateVersion(orgId, templateId ?? "", version ?? 0),
    queryFn: () => getTemplateVersion(templateId as string, version as number),
    // Version rows are immutable — never refetch a loaded one.
    staleTime: Infinity,
    enabled: orgId !== "no-org" && Boolean(templateId) && version !== null && version > 0,
  });
}

export function useStatusConfigs(track?: StatusTrack) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.statusConfigs(orgId, track),
    queryFn: () => listStatusConfigs(track),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useStatusConfig(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.statusConfig(orgId, id ?? ""),
    queryFn: () => getStatusConfig(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
  });
}

export function useCreateStatusConfig() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: StatusConfigInput) => createStatusConfig(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["status-configs", orgId] }),
  });
}

export function useUpdateStatusConfig(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (patch: Partial<StatusConfigInput>) => updateStatusConfig(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["status-configs", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.statusConfig(orgId, id) });
    },
  });
}

export function useAuditLog(filters: AuditFilters = {}, options?: { enabled?: boolean }) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.auditLog(orgId, filters),
    queryFn: () => listAuditLog(filters),
    enabled: orgId !== "no-org" && (options?.enabled ?? true),
  });
}
