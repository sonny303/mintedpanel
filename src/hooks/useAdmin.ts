// Payer, MSO, SOP template, status config, and audit-log query hooks.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrgId } from '@/lib/auth-store';
import { queryKeys } from '@/hooks/queryKeys';
import {
  createPayer,
  getPayer,
  listPayers,
  updatePayer,
  type PayerInput,
} from '@/services/payers';
import {
  createMso,
  getMso,
  listMsos,
  updateMso,
  listRoutingRules,
  createRoutingRule,
  updateRoutingRule,
  type MsoInput,
  type RoutingRuleInput,
} from '@/services/msos';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  type TemplateInput,
} from '@/services/templates';
import {
  createStatusConfig,
  getStatusConfig,
  listStatusConfigs,
  updateStatusConfig,
  type StatusConfigInput,
} from '@/services/statusConfigs';
import { listAuditLog, type AuditFilters } from '@/services/audit';
import type { StatusTrack } from '@/types';

export function usePayers() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.payers(orgId),
    queryFn: listPayers,
    enabled: orgId !== 'no-org',
  });
}

export function usePayer(id: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.payer(orgId, id ?? ''),
    queryFn: () => getPayer(id as string),
    enabled: orgId !== 'no-org' && Boolean(id),
  });
}

export function useCreatePayer() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: PayerInput) => createPayer(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.payers(orgId) }),
  });
}

export function useUpdatePayer(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<PayerInput>) => updatePayer(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payers(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.payer(orgId, id) });
    },
  });
}

export function useMsos() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.msos(orgId),
    queryFn: listMsos,
    enabled: orgId !== 'no-org',
  });
}

export function useMso(id: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.mso(orgId, id ?? ''),
    queryFn: () => getMso(id as string),
    enabled: orgId !== 'no-org' && Boolean(id),
  });
}

export function useCreateMso() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: MsoInput) => createMso(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.msos(orgId) }),
  });
}

export function useUpdateMso(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<MsoInput>) => updateMso(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.msos(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.mso(orgId, id) });
    },
  });
}


export function useRoutingRules() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.msoRoutingRules(orgId),
    queryFn: listRoutingRules,
    enabled: orgId !== 'no-org',
  });
}

function invalidateRoutingRuleCaches(
  qc: ReturnType<typeof useQueryClient>,
  orgId: string,
) {
  qc.invalidateQueries({ queryKey: queryKeys.msoRoutingRules(orgId) });
  // Resolver key family used by useMsoRoutingRule during case creation.
  qc.invalidateQueries({ queryKey: ['mso-routing-rule'] });
}

export function useCreateRoutingRule() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: RoutingRuleInput) => createRoutingRule(input),
    onSuccess: () => invalidateRoutingRuleCaches(qc, orgId),
  });
}

export function useUpdateRoutingRule(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: RoutingRuleInput) => updateRoutingRule(id, input),
    onSuccess: () => invalidateRoutingRuleCaches(qc, orgId),
  });
}

export function useTemplates() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.templates(orgId),
    queryFn: listTemplates,
    enabled: orgId !== 'no-org',
  });
}

export function useTemplate(id: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.template(orgId, id ?? ''),
    queryFn: () => getTemplate(id as string),
    enabled: orgId !== 'no-org' && Boolean(id),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: TemplateInput) => createTemplate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.templates(orgId) }),
  });
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<TemplateInput>) => updateTemplate(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.templates(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.template(orgId, id) });
    },
  });
}

export function useStatusConfigs(track?: StatusTrack) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.statusConfigs(orgId, track),
    queryFn: () => listStatusConfigs(track),
    enabled: orgId !== 'no-org',
  });
}

export function useStatusConfig(id: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.statusConfig(orgId, id ?? ''),
    queryFn: () => getStatusConfig(id as string),
    enabled: orgId !== 'no-org' && Boolean(id),
  });
}

export function useCreateStatusConfig() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: StatusConfigInput) => createStatusConfig(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-configs', orgId] }),
  });
}

export function useUpdateStatusConfig(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<StatusConfigInput>) => updateStatusConfig(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['status-configs', orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.statusConfig(orgId, id) });
    },
  });
}

export function useAuditLog(filters: AuditFilters = {}) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.auditLog(orgId, filters),
    queryFn: () => listAuditLog(filters),
    enabled: orgId !== 'no-org',
  });
}
