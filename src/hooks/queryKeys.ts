// Centralized TanStack Query keys; every key is scoped by active org id so
// switching orgs naturally invalidates the cached data for the prior org.

export const queryKeys = {
  providers: (orgId: string, filters?: unknown) => ['providers', orgId, filters ?? {}] as const,
  provider: (orgId: string, id: string) => ['provider', orgId, id] as const,
  cases: (orgId: string, filters?: unknown) => ['cases', orgId, filters ?? {}] as const,
  case: (orgId: string, id: string) => ['case', orgId, id] as const,
  contract: (orgId: string, key: unknown) => ['contract', orgId, key] as const,
  contracts: (orgId: string, filters?: unknown) => ['contracts', orgId, filters ?? {}] as const,
  touches: (orgId: string, caseId: string) => ['touches', orgId, caseId] as const,
  tasks: (orgId: string, filters?: unknown) => ['tasks', orgId, filters ?? {}] as const,
  task: (orgId: string, id: string) => ['task', orgId, id] as const,
  payers: (orgId: string) => ['payers', orgId] as const,
  payer: (orgId: string, id: string) => ['payer', orgId, id] as const,
  msos: (orgId: string) => ['msos', orgId] as const,
  mso: (orgId: string, id: string) => ['mso', orgId, id] as const,
  msoRoutingRules: (orgId: string) => ['mso-routing-rules', orgId] as const,
  msoRoutingRule: (
    orgId: string,
    payerId: string,
    state: string,
    specialty: string,
  ) => ['mso-routing-rule', orgId, payerId, state, specialty] as const,
  templates: (orgId: string) => ['templates', orgId] as const,
  template: (orgId: string, id: string) => ['template', orgId, id] as const,
  statusConfigs: (orgId: string, track?: unknown) =>
    ['status-configs', orgId, track ?? 'all'] as const,
  statusConfig: (orgId: string, id: string) => ['status-config', orgId, id] as const,
  auditLog: (orgId: string, filters?: unknown) => ['audit-log', orgId, filters ?? {}] as const,
  touchSummary: (orgId: string) => ['touch-summary', orgId] as const,
  rosterAux: (orgId: string) => ['roster-aux', orgId] as const,
} as const;
