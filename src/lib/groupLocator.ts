// Group locator for roster imports. Name wins when it matches exactly one
// group. A miss falls through to TIN, and a TIN shared by several groups is
// broken only by that group's Type 2 NPI (`group_npi`). A tie is never guessed.

export interface GroupMatchCandidate {
  id: string;
  name: string;
  tin: string | null;
  npiType2?: string | null;
}

export interface GroupMatchInput {
  name: string | null;
  tin: string | null;
  npiType2: string | null;
}

export type GroupMatchResult =
  | { status: "matched"; group: GroupMatchCandidate; note: string | null }
  | { status: "none"; column: "group_name" | "group_tin" | "group_npi"; reason: string }
  | { status: "ambiguous"; column: "group_npi"; reason: string };

export const GROUP_AMBIGUOUS_TIN_REASON =
  "This TIN matches more than one group — set group_npi to that group's Type 2 NPI";

const GROUP_AMBIGUOUS_NPI_REASON = "This TIN and group_npi match more than one group";

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function normName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tinNote(group: GroupMatchCandidate, tin: string): string | null {
  const groupTin = digits(group.tin);
  if (tin && groupTin && tin !== groupTin) {
    return `Group "${group.name}" matched by name but the TIN in the file differs from the group on record`;
  }
  return null;
}

function noneResult(input: GroupMatchInput, tin: string): GroupMatchResult {
  if (tin && digits(input.npiType2)) {
    return {
      status: "none",
      column: "group_npi",
      reason: `group_npi does not match a group with TIN ${tin}`,
    };
  }
  const label = input.name?.trim() || input.tin?.trim() || "unknown";
  return {
    status: "none",
    column: input.name?.trim() ? "group_name" : "group_tin",
    reason: `Group "${label}" not found — no group assignment will be created (use batch assignment after commit)`,
  };
}

function narrow(
  pool: readonly GroupMatchCandidate[],
  npi: string,
  input: GroupMatchInput,
  tin: string,
): GroupMatchResult {
  if (pool.length === 0) return noneResult(input, tin);
  if (pool.length === 1) {
    const only = pool[0];
    // A unique TIN still rejects a contradictory group_npi — never silently
    // accept a Type 2 NPI that belongs to a different group.
    if (npi && digits(only.npiType2) && digits(only.npiType2) !== npi) {
      return noneResult(input, tin);
    }
    return { status: "matched", group: only, note: null };
  }
  if (!npi) return { status: "ambiguous", column: "group_npi", reason: GROUP_AMBIGUOUS_TIN_REASON };
  const byNpi = pool.filter((group) => digits(group.npiType2) === npi);
  if (byNpi.length === 1) return { status: "matched", group: byNpi[0], note: null };
  if (byNpi.length === 0) return noneResult(input, tin);
  return { status: "ambiguous", column: "group_npi", reason: GROUP_AMBIGUOUS_NPI_REASON };
}

export function matchGroupLocator(
  input: GroupMatchInput,
  groups: readonly GroupMatchCandidate[],
): GroupMatchResult {
  const name = normName(input.name);
  const tin = digits(input.tin);
  const npi = digits(input.npiType2);

  if (name) {
    const byName = groups.filter((group) => normName(group.name) === name);
    if (byName.length === 1) {
      return { status: "matched", group: byName[0], note: tinNote(byName[0], tin) };
    }
    if (byName.length > 1) {
      const pool = tin ? byName.filter((group) => digits(group.tin) === tin) : byName;
      return narrow(pool, npi, input, tin);
    }
  }

  if (tin) {
    const byTin = groups.filter((group) => digits(group.tin) === tin);
    return narrow(byTin, npi, input, tin);
  }

  return noneResult(input, tin);
}
