// E1.8 TE-1/TE-6/TE-7/TE-10 — enrollment readiness, fully DERIVED and never
// stored (the launchReadiness/clientProgress pattern; that module stays the
// separate location-launch readiness — do not merge them). Rows sit at the
// E2.x case-key grain: provider × group × payer × state, derived from ACTIVE
// payer_network_targets (E1.5) × the target group's roster (E1.3). "today" is
// always passed in — no clock reads here — and every comparison is date-only
// (ISO YYYY-MM-DD) to avoid timezone/day-boundary drift. Readiness is
// ADVISORY: nothing here blocks anything; E2.0's generation preview consumes
// readinessForCaseKey as its soft-warn input.
//
// PHI rule (TE-9): the demographics check consumes PRESENCE BOOLEANS computed
// at the service boundary — date of birth, SSN last-4, and home address never
// enter this module, only whether they exist.

import { canonicalLabel } from "@/lib/canonicalStatuses";
import { CONTRACTED_LABEL } from "@/lib/statusLabels";

/** The locked CAQH freshness window (PM decision 2026-07-11). */
export const CAQH_CURRENT_DAYS = 120;

export type CheckOwner = "provider" | "group";

/** Where a red item is worked (F1.8.3, PM Option 3 2026-07-12): wizard
 * sections for checks with an exact editor; the owning group screen for
 * document/COI/voided-check gaps until a documents surface lands. */
export type FixTarget = "providers_section" | "facilities_section" | "group_screen";

export type ProviderCheckKey =
  | "license_present"
  | "license_current"
  | "license_verified"
  | "caqh_id"
  | "caqh_current"
  | "npi"
  | "demographics"
  | "malpractice_current";

export type GroupCheckKey =
  "state_facility" | "w9" | "group_coi" | "voided_check" | "group_contract";

export type ReadinessCheckKey = ProviderCheckKey | GroupCheckKey;

export interface ReadinessCheck {
  key: ReadinessCheckKey;
  owner: CheckOwner;
  label: string;
  pass: boolean;
  /** Non-sensitive underlying value ("Attested 2026-03-01", "Expires
   * 2026-01-31", "Missing: SSN last 4") — never a PHI value itself. */
  detail: string | null;
  fixTarget: FixTarget;
}

// ---------- inputs (assembled by services; no Supabase here) ----------

export interface ProviderReadinessFacts {
  providerId: string;
  providerName: string;
  npiPresent: boolean;
  caqhIdPresent: boolean;
  caqhLastAttestedDate: string | null;
  /** Presence booleans only — computed at the service boundary (TE-9). */
  dobPresent: boolean;
  ssnLast4Present: boolean;
  homeAddressPresent: boolean;
  malpracticeCoverageEnd: string | null;
}

export interface ReadinessLicenseInput {
  providerId: string | null;
  state: string;
  expirationDate: string | null;
  verifiedStatus: "unverified" | "verified" | "failed";
}

export interface ReadinessTargetInput {
  groupId: string;
  payerId: string;
  state: string;
  status: "active" | "archived";
}

export interface GroupDocumentInput {
  groupId: string | null;
  docType: string;
  expirationDate: string | null;
}

export interface GroupInsuranceInput {
  groupId: string;
  policyEndDate: string | null;
}

/** E2.0 TE-8 — one row per `contracts` entry at the group × payer × state
 * grain, reduced to its resolved contracting-status label (null when the
 * contract carries no status). */
export interface GroupContractInput {
  groupId: string | null;
  payerId: string | null;
  state: string;
  statusLabel: string | null;
}

export interface EnrollmentReadinessInput {
  /** Date-only ISO string (YYYY-MM-DD); never read a clock inside. */
  today: string;
  /** All targets — archived rows are ignored here (E1.5 removal semantic). */
  targets: readonly ReadinessTargetInput[];
  /** provider↔group membership (E1.3). An assignment end-dated before today
   * no longer places the provider on that group's readiness rows (membership
   * runs through the end date itself); omitted/null endDate = open-ended. */
  groupAssignments: ReadonlyArray<{
    providerId: string | null;
    groupId: string | null;
    endDate?: string | null;
  }>;
  /** Non-terminated roster facts (service pre-filters terminated). */
  providers: readonly ProviderReadinessFacts[];
  licenses: readonly ReadinessLicenseInput[];
  facilities: ReadonlyArray<{ groupId: string | null; state: string | null; isActive: boolean }>;
  groupDocuments: readonly GroupDocumentInput[];
  groupInsurancePolicies: readonly GroupInsuranceInput[];
  /** E2.0 TE-8 (the delegated Q3a decision) — OPTIONAL group contract-status
   * input. When omitted, no `group_contract` check is emitted and every
   * pre-E2.0 caller is bit-for-bit unchanged; the generation preview passes
   * it. Advisory like everything else here — it never disables anything. */
  contracts?: readonly GroupContractInput[];
}

export interface ReadinessRow {
  providerId: string;
  providerName: string;
  groupId: string;
  payerId: string;
  state: string;
  checks: ReadinessCheck[];
  openGaps: number;
  ready: boolean;
}

// ---------- date-only helpers ----------

/** date >= today, comparing ISO date-only strings lexicographically. */
function onOrAfter(date: string | null, today: string): boolean {
  return date !== null && date.slice(0, 10) >= today;
}

/** Whole days from `from` to `to` (UTC midnights — no TZ drift). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** CAQH current = attested within the locked 120-day window (inclusive). */
export function isCaqhCurrent(attestedDate: string | null, today: string): boolean {
  if (!attestedDate) return false;
  const age = daysBetween(attestedDate, today);
  return age >= 0 && age <= CAQH_CURRENT_DAYS;
}

// ---------- evaluators ----------

function providerChecks(
  facts: ProviderReadinessFacts,
  state: string,
  licenses: readonly ReadinessLicenseInput[],
  today: string,
): ReadinessCheck[] {
  // The license for the target state: prefer a verified row, then the latest
  // expiration, so one stale duplicate never hides a good license.
  const forState = licenses.filter((l) => l.providerId === facts.providerId && l.state === state);
  const license = [...forState].sort(
    (a, b) =>
      Number(b.verifiedStatus === "verified") - Number(a.verifiedStatus === "verified") ||
      (b.expirationDate ?? "").localeCompare(a.expirationDate ?? ""),
  )[0];

  const missingDemographics = [
    ...(facts.dobPresent ? [] : ["date of birth"]),
    ...(facts.ssnLast4Present ? [] : ["SSN last 4"]),
    ...(facts.homeAddressPresent ? [] : ["home address"]),
  ];

  const checks: ReadinessCheck[] = [
    {
      key: "license_present",
      owner: "provider",
      label: `${state} license on file`,
      pass: license !== undefined,
      detail: license ? null : `No ${state} license`,
      fixTarget: "providers_section",
    },
    {
      key: "license_current",
      owner: "provider",
      label: `${state} license unexpired`,
      pass: license !== undefined && onOrAfter(license.expirationDate, today),
      detail: license?.expirationDate ? `Expires ${license.expirationDate}` : "No expiration date",
      fixTarget: "providers_section",
    },
    {
      key: "license_verified",
      owner: "provider",
      label: `${state} license board-verified`,
      pass: license?.verifiedStatus === "verified",
      detail: license ? `PSV: ${license.verifiedStatus}` : "No license to verify",
      fixTarget: "providers_section",
    },
    {
      key: "caqh_id",
      owner: "provider",
      label: "CAQH ID present",
      pass: facts.caqhIdPresent,
      detail: facts.caqhIdPresent ? null : "No CAQH ID",
      fixTarget: "providers_section",
    },
    {
      key: "caqh_current",
      owner: "provider",
      label: `CAQH attested within ${CAQH_CURRENT_DAYS} days`,
      pass: isCaqhCurrent(facts.caqhLastAttestedDate, today),
      detail: facts.caqhLastAttestedDate
        ? `Attested ${facts.caqhLastAttestedDate}`
        : "Never attested",
      fixTarget: "providers_section",
    },
    {
      key: "npi",
      owner: "provider",
      label: "NPI present",
      pass: facts.npiPresent,
      detail: facts.npiPresent ? null : "No NPI",
      fixTarget: "providers_section",
    },
    {
      key: "demographics",
      owner: "provider",
      label: "Core demographics complete",
      pass: missingDemographics.length === 0,
      detail:
        missingDemographics.length === 0 ? null : `Missing: ${missingDemographics.join(", ")}`,
      fixTarget: "providers_section",
    },
    {
      key: "malpractice_current",
      owner: "provider",
      label: "Malpractice coverage current",
      pass: onOrAfter(facts.malpracticeCoverageEnd, today),
      detail: facts.malpracticeCoverageEnd
        ? `Coverage ends ${facts.malpracticeCoverageEnd}`
        : "No coverage end date",
      fixTarget: "providers_section",
    },
  ];
  return checks;
}

function groupChecks(
  groupId: string,
  state: string,
  input: EnrollmentReadinessInput,
): ReadinessCheck[] {
  const hasStateFacility = input.facilities.some(
    (f) => f.isActive && f.groupId === groupId && f.state === state,
  );
  const docs = input.groupDocuments.filter((d) => d.groupId === groupId);
  const hasDoc = (type: string) => docs.some((d) => d.docType === type);
  // A COI document with no expiration counts as current; a dated one must be
  // unexpired. Insurance policies satisfy the same check via policy_end_date.
  const coiCurrent =
    input.groupInsurancePolicies.some(
      (p) => p.groupId === groupId && onOrAfter(p.policyEndDate, input.today),
    ) ||
    docs.some(
      (d) =>
        d.docType === "coi" &&
        (d.expirationDate === null || onOrAfter(d.expirationDate, input.today)),
    );

  return [
    {
      key: "state_facility",
      owner: "group",
      label: `Facility in ${state}`,
      pass: hasStateFacility,
      detail: hasStateFacility ? null : `No ${state} facility`,
      fixTarget: "facilities_section",
    },
    {
      key: "w9",
      owner: "group",
      label: "W-9 on file",
      pass: hasDoc("w9"),
      detail: hasDoc("w9") ? null : "No W-9 document",
      fixTarget: "group_screen",
    },
    {
      key: "group_coi",
      owner: "group",
      label: "Group COI current",
      pass: coiCurrent,
      detail: coiCurrent ? null : "No current COI or insurance policy",
      fixTarget: "group_screen",
    },
    {
      key: "voided_check",
      owner: "group",
      label: "Voided check on file",
      pass: hasDoc("voided_check"),
      detail: hasDoc("voided_check") ? null : "No voided check",
      fixTarget: "group_screen",
    },
  ];
}

/** E2.0 TE-8 — the group-contract check, computed PER TARGET (group × payer ×
 * state): contracts vary by payer, so it cannot ride the (group, state) group
 * cache. Pass = a contract row exists at the key whose label canonicalizes to
 * the Contracted label. */
function groupContractCheck(
  target: ReadinessTargetInput,
  contracts: readonly GroupContractInput[],
): ReadinessCheck {
  const contract = contracts.find(
    (c) => c.groupId === target.groupId && c.payerId === target.payerId && c.state === target.state,
  );
  const label = contract?.statusLabel ?? null;
  return {
    key: "group_contract",
    owner: "group",
    label: "Group contract in place",
    pass: label !== null && canonicalLabel(label) === CONTRACTED_LABEL,
    detail: label ?? "No contract",
    fixTarget: "group_screen",
  };
}

/** Derive the full readiness matrix. Group checks are computed ONCE per
 * (group, state) and fanned out across that group's provider rows (TE-7). */
export function evaluateEnrollmentReadiness(input: EnrollmentReadinessInput): ReadinessRow[] {
  const providersByGroup = new Map<string, ProviderReadinessFacts[]>();
  const factsById = new Map(input.providers.map((p) => [p.providerId, p]));
  for (const a of input.groupAssignments) {
    if (!a.providerId || !a.groupId) continue;
    // E1.3 end_date: an ended membership stops producing rows the day after
    // it ends — a provider who left the group is not pre-flighted for it.
    if (a.endDate != null && a.endDate.slice(0, 10) < input.today) continue;
    const facts = factsById.get(a.providerId);
    if (!facts) continue; // terminated / unknown providers never produce rows
    providersByGroup.set(a.groupId, [...(providersByGroup.get(a.groupId) ?? []), facts]);
  }

  const groupCheckCache = new Map<string, ReadinessCheck[]>();
  const providerCheckCache = new Map<string, ReadinessCheck[]>();
  const rows: ReadinessRow[] = [];

  for (const target of input.targets) {
    if (target.status !== "active") continue;
    const roster = providersByGroup.get(target.groupId) ?? [];
    if (roster.length === 0) continue;

    const groupKey = `${target.groupId}|${target.state}`;
    let shared = groupCheckCache.get(groupKey);
    if (!shared) {
      shared = groupChecks(target.groupId, target.state, input);
      groupCheckCache.set(groupKey, shared);
    }

    // TE-8: computed once per target and shared by identity across the
    // target's provider rows; absent entirely when the input is omitted.
    const contractCheck = input.contracts ? groupContractCheck(target, input.contracts) : null;

    for (const facts of roster) {
      // Provider checks depend only on (provider, state) — reuse across the
      // same provider's rows for different payers in one state.
      const provKey = `${facts.providerId}|${target.state}`;
      let own = providerCheckCache.get(provKey);
      if (!own) {
        own = providerChecks(facts, target.state, input.licenses, input.today);
        providerCheckCache.set(provKey, own);
      }
      const checks = contractCheck ? [...own, ...shared, contractCheck] : [...own, ...shared];
      const openGaps = checks.filter((c) => !c.pass).length;
      rows.push({
        providerId: facts.providerId,
        providerName: facts.providerName,
        groupId: target.groupId,
        payerId: target.payerId,
        state: target.state,
        checks,
        openGaps,
        ready: openGaps === 0,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.providerName.localeCompare(b.providerName) ||
      a.state.localeCompare(b.state) ||
      a.payerId.localeCompare(b.payerId) ||
      a.groupId.localeCompare(b.groupId),
  );
}

export interface ReadinessSummary {
  total: number;
  ready: number;
  openGaps: number;
}

export function readinessSummary(rows: readonly ReadinessRow[]): ReadinessSummary {
  return {
    total: rows.length,
    ready: rows.filter((r) => r.ready).length,
    openGaps: rows.reduce((n, r) => n + r.openGaps, 0),
  };
}

export interface ReadinessFilters {
  groupId: string | "all";
  payerId: string | "all";
  state: string | "all";
  /** Keeps only rows with an OPEN gap of this check (F1.8.1 gap-type filter). */
  gap: ReadinessCheckKey | "all";
}

export function filterReadinessRows(
  rows: readonly ReadinessRow[],
  filters: ReadinessFilters,
): ReadinessRow[] {
  return rows.filter((r) => {
    if (filters.groupId !== "all" && r.groupId !== filters.groupId) return false;
    if (filters.payerId !== "all" && r.payerId !== filters.payerId) return false;
    if (filters.state !== "all" && r.state !== filters.state) return false;
    if (filters.gap !== "all" && !r.checks.some((c) => c.key === filters.gap && !c.pass))
      return false;
    return true;
  });
}

export interface CaseKey {
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
}

export interface CaseKeyReadiness {
  ready: boolean;
  openGaps: ReadinessCheck[];
}

/** TE-10 — the E2.0 soft-warn interface (documented contract, consumed by the
 * R4 generation preview; nothing in R3 calls it to gate anything). */
export function readinessForCaseKey(
  input: EnrollmentReadinessInput,
  key: CaseKey,
): CaseKeyReadiness {
  const row = evaluateEnrollmentReadiness(input).find(
    (r) =>
      r.providerId === key.providerId &&
      r.groupId === key.groupId &&
      r.payerId === key.payerId &&
      r.state === key.state,
  );
  if (!row) return { ready: false, openGaps: [] };
  return { ready: row.ready, openGaps: row.checks.filter((c) => !c.pass) };
}
