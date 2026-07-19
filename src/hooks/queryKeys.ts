// Centralized TanStack Query keys; every key is scoped by active org id so
// switching orgs naturally invalidates the cached data for the prior org.

export const queryKeys = {
  providers: (orgId: string, filters?: unknown) => ["providers", orgId, filters ?? {}] as const,
  provider: (orgId: string, id: string) => ["provider", orgId, id] as const,
  cases: (orgId: string, filters?: unknown) => ["cases", orgId, filters ?? {}] as const,
  case: (orgId: string, id: string) => ["case", orgId, id] as const,
  // E4.0 — the active denial/return reason vocabulary (global + own-org).
  denialReasonCodes: (orgId: string) => ["denial-reason-codes", orgId] as const,
  contract: (orgId: string, key: unknown) => ["contract", orgId, key] as const,
  contracts: (orgId: string, filters?: unknown) => ["contracts", orgId, filters ?? {}] as const,
  touches: (orgId: string, caseId: string) => ["touches", orgId, caseId] as const,
  taskTouchlog: (orgId: string, taskId: string) => ["task-touchlog", orgId, taskId] as const,
  tasks: (orgId: string, filters?: unknown) => ["tasks", orgId, filters ?? {}] as const,
  task: (orgId: string, id: string) => ["task", orgId, id] as const,
  payers: (orgId: string) => ["payers", orgId] as const,
  payer: (orgId: string, id: string) => ["payer", orgId, id] as const,
  orgPayerAssignments: (orgId: string) => ["org-payer-assignments", orgId] as const,
  orgPayerSettings: (orgId: string) => ["org-payer-settings", orgId] as const,
  payerNetworkTargets: (orgId: string) => ["payer-network-targets", orgId] as const,
  // E6.2 — enrollment facts (F6.2.5). The denial-entries read deliberately
  // rides the "cases" prefix so every set_case_status invalidation re-derives
  // the board's denial history.
  enrollmentFacts: (orgId: string) => ["enrollment-facts", orgId] as const,
  caseDenialEntries: (orgId: string) => ["cases", orgId, "denial-entries"] as const,
  providerReadinessFacts: (orgId: string) => ["provider-readiness-facts", orgId] as const,
  groupReadinessDocuments: (orgId: string) => ["group-readiness-documents", orgId] as const,
  groupInsurancePolicies: (orgId: string) => ["group-insurance-policies", orgId] as const,
  msos: (orgId: string) => ["msos", orgId] as const,
  mso: (orgId: string, id: string) => ["mso", orgId, id] as const,
  msoRoutingRules: (orgId: string) => ["mso-routing-rules", orgId] as const,
  msoRoutingRule: (orgId: string, payerId: string, state: string, specialty: string) =>
    ["mso-routing-rule", orgId, payerId, state, specialty] as const,
  templates: (orgId: string) => ["templates", orgId] as const,
  template: (orgId: string, id: string) => ["template", orgId, id] as const,
  // E1.7b SOP versioning: history list + one immutable version's content.
  templateVersions: (orgId: string, templateId: string) =>
    ["template-versions", orgId, templateId] as const,
  templateVersion: (orgId: string, templateId: string, version: number) =>
    ["template-version", orgId, templateId, version] as const,
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
  // E2.0 case-generation preview: the persistent exclusions plus the two
  // narrow preview-input projections (cases, contracts).
  caseGenerationExclusions: (orgId: string) => ["case-generation-exclusions", orgId] as const,
  generationCaseRows: (orgId: string) => ["generation-case-rows", orgId] as const,
  generationContractRows: (orgId: string) => ["generation-contract-rows", orgId] as const,
  // E2.3 next-best-action queue: the two narrow queue projections ride their
  // domain prefixes (the useLastTouchDates idiom) so every existing
  // ["tasks", orgId] / ["providers", orgId] invalidation re-derives the
  // queue; plus the one run row the batch-landing banner reads.
  queueTaskRows: (orgId: string) => ["tasks", orgId, "queue-projection"] as const,
  queueProviderRows: (orgId: string) => ["providers", orgId, "queue-projection"] as const,
  // E4.3 F4.3.1: per-case portal keys for the My Cases "Work in portal"
  // launcher; rides the ["tasks", orgId] prefix so task edits re-derive it.
  casePortalKeys: (orgId: string) => ["tasks", orgId, "case-portal-keys"] as const,
  generationRun: (orgId: string, runId: string) => ["generation-run", orgId, runId] as const,
  // E2.4 run history: the org's runs list + one run's immutable disposition
  // rows (INSERT-only data — long staleTime is safe).
  generationRuns: (orgId: string) => ["generation-runs", orgId] as const,
  generationRunRows: (orgId: string, runId: string) =>
    ["generation-run-rows", orgId, runId] as const,
  // E3.0 bulk roster import: the org's staged import runs + one run's durable
  // progress row (polled while a scan is in flight).
  importRuns: (orgId: string) => ["import-runs", orgId] as const,
  importRun: (orgId: string, runId: string) => ["import-run", orgId, runId] as const,
  // E3.1 import preview: one run's staged rows (the dedupe/conflict input).
  importRunRows: (orgId: string, runId: string) => ["import-run-rows", orgId, runId] as const,
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
  // Org CRM contacts (redesign E0.2): owner + customer + sales-rep parties.
  orgContacts: (orgId: string) => ["org-contacts", orgId] as const,
  // Full Party model (redesign E0.3): all parties in an org + the global,
  // cross-org role reference list.
  orgParties: (orgId: string) => ["org-parties", orgId] as const,
  partyRoleTypes: () => ["party-role-types"] as const,
  // Secure data capture link (redesign E0.5): the active org's current link
  // state. Inbound leads are CROSS-org (no org until converted) — not scoped.
  captureLink: (orgId: string) => ["capture-link", orgId] as const,
  // E4.4 SSN intake link state, per provider (operator status surface).
  ssnIntakeLink: (orgId: string, providerId: string) =>
    ["ssn-intake-link", orgId, providerId] as const,
  inboundLeads: () => ["inbound-leads"] as const,
  // Reporting Center (redesign E0.6). CROSS-org (renders without an active org):
  // per-org geography for the state breakdown, and the caller's shares per report.
  orgStates: () => ["org-states"] as const,
  reportShares: (reportKey: string) => ["report-shares", reportKey] as const,
  // E4.2 Payer & SOP admin module.
  // Reason-code management reads the full vocabulary (incl. inactive); the
  // dropdown reader keeps using `denialReasonCodes` above.
  allDenialReasonCodes: (orgId: string) => ["denial-reason-codes", orgId, "all"] as const,
  // F4.2.5 org queue ranking config (the read matches useQueueRankingConfig's
  // inline literal so the settings mutation invalidates the queue derivation).
  queueRankingConfig: (orgId: string) => ["queue-ranking-config", orgId] as const,
  // F4.2.1 SOP wizard drafts (save-as-draft WIP).
  sopTemplateDrafts: (orgId: string) => ["sop-template-drafts", orgId] as const,
  sopTemplateDraft: (orgId: string, id: string) => ["sop-template-draft", orgId, id] as const,
  // F4.2.7 form test runner: an org portal's test fill sessions.
  testFills: (orgId: string, portalKey: string) => ["test-fills", orgId, portalKey] as const,
  // E4.5 document store: per-owner version lists + the org-wide
  // expiring-credentials projection input. All prefixed "documents" so one
  // prefix invalidation re-derives every document surface after an upload.
  providerDocuments: (orgId: string, providerId: string) =>
    ["documents", orgId, "provider", providerId] as const,
  groupDocuments: (orgId: string, groupId: string) =>
    ["documents", orgId, "group", groupId] as const,
  orgDocuments: (orgId: string) => ["documents", orgId, "org"] as const,
  documentUploaders: (orgId: string, ids: string) => ["document-uploaders", orgId, ids] as const,
} as const;

export const FIVE_MINUTES = 5 * 60 * 1000;
