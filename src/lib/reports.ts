// Reporting Center report registry (redesign E0.6, TE-1 / F0.6.1 / F0.6.6).
//
// A typed list of the reports the Reporting Center offers. Stage 0 registers
// exactly ONE — the Portfolio dashboard. Adding a future report (Stage 4 owner
// outcomes, Stage 5 recurring) is a single entry here + its route, with no
// redesign of the Center or the Portfolio report (F0.6.6).
export interface ReportDef {
  key: string;
  title: string;
  description: string;
  path: string;
}

export const REPORTS: ReportDef[] = [
  {
    key: "portfolio",
    title: "Portfolio",
    description: "Your organizations across the business — prospects, in motion, and geography.",
    path: "/reporting/portfolio",
  },
];

export function findReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}
