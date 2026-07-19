// Reporting Center report registry (redesign E0.6 TE-1 / F0.6.1 / F0.6.6;
// grouped by E6.6 F6.6.1).
//
// A typed list of the reports the Reporting Center offers, organized into the
// four question-type groups the index renders (Performance / Credentialing /
// Compliance / Intake). Adding a report stays ONE entry here + its route
// (F0.6.6); pick the group whose question it answers.
export type ReportGroup = "performance" | "credentialing" | "compliance" | "intake";

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  path: string;
  group: ReportGroup;
}

/** The four groups in display order (E6.6 F6.6.1). */
export const REPORT_GROUPS: readonly { key: ReportGroup; title: string }[] = [
  { key: "performance", title: "Performance" },
  { key: "credentialing", title: "Credentialing" },
  { key: "compliance", title: "Compliance" },
  { key: "intake", title: "Intake" },
];

export const REPORTS: ReportDef[] = [
  {
    key: "portfolio",
    title: "Portfolio",
    description: "Your organizations across the business — prospects, in motion, and geography.",
    path: "/reporting/portfolio",
    group: "performance",
  },
  // E6.6 F6.6.2 — the Launches page's successor: go-live dates + at-risk.
  {
    key: "launches",
    title: "Launches",
    description: "Locations opening soon or recently — dates, providers, and at-risk flags.",
    path: "/reporting/launches",
    group: "performance",
  },
  // E6.6 F6.6.4 — the PM's counts-as-reports ruling.
  {
    key: "facilities-without-providers",
    title: "Facilities Without Providers",
    description: "Active locations with no providers assigned.",
    path: "/reporting/facilities-without-providers",
    group: "performance",
  },
  {
    key: "locations-per-group",
    title: "Locations per Group",
    description: "Active location counts by provider group.",
    path: "/reporting/locations-per-group",
    group: "performance",
  },
  // E6.6 F6.6.3 — provider-first denials over the unified statuses + reasons.
  {
    key: "denials",
    title: "Denials",
    description: "Who has been denied, by whom, and why — provider-first, payer-pivotable, CSV.",
    path: "/reporting/denials",
    group: "credentialing",
  },
  // E4.5 F4.5.2 — the expiring-credentials table (org-scoped; the report
  // renders a select-an-organization state without an active org).
  {
    key: "expiring-credentials",
    title: "Expiring Credentials",
    description:
      "Provider and group documents by soonest expiration — expired, expiring soon, current.",
    path: "/reporting/expiring-credentials",
    group: "credentialing",
  },
  // E6.6 F6.6.4 — the Audit Log admin page, relocated (same read surface).
  {
    key: "audit-log",
    title: "Audit Log",
    description: "Who did what, when — the append-only change ledger with filters.",
    path: "/reporting/audit-log",
    group: "compliance",
  },
  // E6.6 F6.6.1 — inbound-leads triage re-homed off Org Detail.
  {
    key: "leads",
    title: "Inbound Leads",
    description: "Website inquiries awaiting triage — convert to an organization or dismiss.",
    path: "/reporting/leads",
    group: "intake",
  },
];

export function findReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** Registry entries for one group, registry order preserved. */
export function reportsInGroup(group: ReportGroup): ReportDef[] {
  return REPORTS.filter((r) => r.group === group);
}
