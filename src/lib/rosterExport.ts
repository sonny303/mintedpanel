// Provider-roster CSV builder (Epic 5): the pure, deterministic core of the
// "Export roster" action on the providers work view and launch detail. Callers
// resolve the rows from caches they already hold and pass them in; this module
// does no I/O and holds no PHI by construction — the input shape carries only
// the roster-safe fields (name/credentials/npi/specialty/home_state/group or
// facility name + a per-payer case-status summary). It NEVER sees ssn_last4,
// date_of_birth, or a home address (street/city/zip), so those cannot leak.
import { toCsv, type CsvCell } from "@/lib/csv";

/** One credentialing case, reduced to the roster-safe fields for the summary. */
export interface RosterCaseSummary {
  payerName: string;
  state: string;
  /** credentialing status label; empty renders as "No status". */
  statusLabel: string;
}

/** One provider (one output row). PHI-minimal — see the module header. */
export interface RosterRowInput {
  firstName: string;
  lastName: string;
  credentials: string | null;
  npi: string | null;
  specialty: string | null;
  homeState: string | null;
  /** group or facility name, resolved by the caller from its own caches. */
  groupOrFacility: string | null;
  cases: RosterCaseSummary[];
}

// Locked column order. No SSN, DOB, or home-address columns — PHI-minimal.
export const ROSTER_CSV_HEADER = [
  "Provider Name",
  "Credentials",
  "NPI",
  "Specialty",
  "Home State",
  "Group / Facility",
  "Cases",
  "Case Statuses",
] as const;

// Deterministic per-payer status summary: "Payer (ST): Status; ..." sorted by
// payer then state so the same provider always serializes identically.
function summarizeCases(cases: RosterCaseSummary[]): string {
  return [...cases]
    .sort((a, b) => a.payerName.localeCompare(b.payerName) || a.state.localeCompare(b.state))
    .map((c) => {
      const label = c.statusLabel || "No status";
      return c.state ? `${c.payerName} (${c.state}): ${label}` : `${c.payerName}: ${label}`;
    })
    .join("; ");
}

/**
 * Build a roster CSV string: a header row plus one row per provider (in the
 * order given). Empty input yields the header row only.
 */
export function buildRosterCsv(rows: RosterRowInput[]): string {
  const body: CsvCell[][] = rows.map((r) => [
    `${r.firstName} ${r.lastName}`.trim(),
    r.credentials ?? "",
    r.npi ?? "",
    r.specialty ?? "",
    r.homeState ?? "",
    r.groupOrFacility ?? "",
    r.cases.length,
    summarizeCases(r.cases),
  ]);
  return toCsv([[...ROSTER_CSV_HEADER], ...body]);
}
