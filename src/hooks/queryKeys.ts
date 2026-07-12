// Centralized TanStack Query keys; every key is scoped by active org id so
// switching orgs naturally invalidates the cached data for the prior org.

export const queryKeys = {
  providers: (orgId: string, filters?: unknown) => ["providers", orgId, filters ?? {}] as const,
  provider: (orgId: string, id: string) => ["provider", orgId, id] as const,
  cases: (orgId: string, filters?: unknown) => ["cases", orgId, filters ?? {}] as const,
  case: (orgId: string, id: string) => ["case", orgId, id] as const,
  contract: (orgId: string, key: unknown) => ["contract", orgId, key] as const,
  contracts: (orgId: string, filters?: unknown) => ["contracts", orgId, filters ?? {}] as const,
  touches: (orgId: string, caseId: string) => ["touches", orgId, caseId] as const,
  taskTouchlog: (orgId: string, taskId: string) => ["task-touchlog", orgId, taskId] as const,
  tasks: (orgId: string, filters?: unknown) => ["tasks", orgId, filters ?? {}] as const,
  task: (orgId: string, id: string) => ["task", orgId, id] as const,
  payers: (orgId: string) => ["payers", orgId] as const,
  payer: (orgId: string, id: string) => ["payer", orgId, id] as const,
  orgPayerAssignments: (orgId: string) => ["org-payer-assignments", orgId] as const,
  msos: (orgId: string) => ["msos", orgId] as const,
  mso: (orgId: string, id: string) => ["mso", orgId, id] as const,
  msoRoutingRules: (orgId: string) => ["mso-routing-rules", orgId] as const,
  msoRoutingRule: (orgId: string, payerId: string, state: string, specialty: string) =>
    ["mso-routing-rule", orgId, payerId, state, specialty] as const,
  templates: (orgId: string) => ["templates", orgId] as const,
  template: (orgId: string, id: string) => ["template", orgId, id] as const,
  statusConfigs: (orgId: string, track?: unknown) =>
    ["status-configs", orgId, track ?? "all"] as const,
  statusConfig: (orgId: string, id: string) => ["status-config", orgId, id] as const,
  auditLog: (orgId: string, filters?: unknown) => ["audit-log", orgId, filters ?? {}] as const,
  touchSummary: (orgId: string) => ["touch-summary", orgId] as const,
  rosterAux: (orgId: string) => ["roster-aux", orgId] as const,
  facilities: (orgId: string, groupId?: string | null) =>
    ["facilities", orgId, groupId ?? "all"] as const,
  facility: (orgId: string, id: string) => ["facility", orgId, id] as const,
  facilityAssignments: (orgId: string) => ["facility-assignments", orgId] as const,
  providerGroups: (orgId: string) => ["provider-groups", orgId] as const,
  coordinators: (orgId: string) => ["coordinators", orgId] as const,
  stateLicenses: (orgId: string, providerId: string) =>
    ["state-licenses", orgId, providerId] as const,
  // E1.3 roster summaries: org-wide license projection + the M:N
  // provider↔group assignment rows.
  orgStateLicenses: (orgId: string) => ["org-state-licenses", orgId] as const,
  providerGroupAssignments: (orgId: string) => ["provider-group-assignments", orgId] as const,
  notes: (orgId: string, entityType: string, entityId: string) =>
    ["notes", orgId, entityType, entityId] as const,
  // Cleanup surfaces (Portals admin / Mapping review / Fix-it queue).
  portals: (orgId: string) => ["portals", orgId] as const,
  portalFieldMaps: (orgId: string, portalKey?: string) =>
    ["portal-field-maps", orgId, portalKey ?? "all"] as const,
  lastFills: (orgId: string) => ["last-fills", orgId] as const,
  fieldDictionary: (orgId: string) => ["field-dictionary", orgId] as const,
  tokenCatalog: (orgId: string) => ["token-catalog", orgId] as const,
  // Portfolio (redesign E0.0) is CROSS-org — deliberately not scoped to an
  // active org (it renders without one). RLS scopes the read to the caller's
  // member orgs; org switch clears it via queryClient.removeQueries() anyway.
  portfolio: () => ["portfolio"] as const,
  // E1.6 — cross-org global catalog keys (deliberately un-scoped, like
  // portfolio()/orgStates(): the catalog is platform-level data).
  payerCatalog: () => ["payer-catalog"] as const,
  payerCatalogChanges: () => ["payer-catalog-changes"] as const,
  // Org CRM contacts (redesign E0.2): owner + customer + sales-rep parties.
  orgContacts: (orgId: string) => ["org-contacts", orgId] as const,
  // Full Party model (redesign E0.3): all parties in an org + the global,
  // cross-org role reference list.
  orgParties: (orgId: string) => ["org-parties", orgId] as const,
  partyRoleTypes: () => ["party-role-types"] as const,
  // Secure data capture link (redesign E0.5): the active org's current link
  // state. Inbound leads are CROSS-org (no org until converted) — not scoped.
  captureLink: (orgId: string) => ["capture-link", orgId] as const,
  inboundLeads: () => ["inbound-leads"] as const,
  // Reporting Center (redesign E0.6). CROSS-org (renders without an active org):
  // per-org geography for the state breakdown, and the caller's shares per report.
  orgStates: () => ["org-states"] as const,
  reportShares: (reportKey: string) => ["report-shares", reportKey] as const,
} as const;

export const FIVE_MINUTES = 5 * 60 * 1000;
