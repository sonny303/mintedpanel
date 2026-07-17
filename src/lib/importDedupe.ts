// E3.1 — the pure five-part dedupe / conflict-review / commit-plan core
// (TE-3/TE-4). NO I/O: the service layer batch-reads the org's existing data
// and the run's staged rows; everything here is a deterministic derivation the
// preview re-runs on every render (the E2.0 "batched reads → pure evaluator"
// shape).
//
// The [r5] decision-5 grain is name + NPI + TIN + group + facility. TIN and
// group identify the SAME entity (a group has one TIN — the reviewer's nit),
// so a staged row resolves its group by TIN first, then by name, and the
// effective match is provider(name, NPI) × group × facility:
//   - full five-part match with nothing new and no conflicts → SKIP
//     ("already exists");
//   - name+NPI match under a different group/facility → an UPDATE on the
//     existing provider proposing the new assignment(s) — never a second
//     providers row;
//   - a row missing NPI → exact-name matched and flagged for MANUAL REVIEW
//     (the blocked bucket) — never silently merged;
//   - an NPI with no NPI match is a NEW provider even when the name matches an
//     existing provider with a DIFFERENT NPI (NPI is the authoritative
//     identity; a note flags the same-name neighbor).
//
// A roster legitimately lists one provider on several lines (one per
// group/facility/license), so dispositions FOLD per provider: one create per
// new NPI, one update/skip per matched provider — `lines` carries every
// constituent source line so the counts still reconcile exactly with the
// staged rows (F3.1.1).
//
// Conflict review (TE-4) covers name, NPI, specialty, license ONLY —
// location/address is never per-field reviewed; imported location data
// proposes assignments instead ([r5] decision 2). The DEFAULT pick is the
// existing value, but a conflict counts as RESOLVED only after an explicit
// per-field choice — until then it blocks ONLY its own row (the update entry
// joins the blocked bucket and the rest of the run stays committable).

export interface StagedImportRow {
  line: number;
  /** import_rows.mapped — normalized cell values from the E3.0 scan */
  mapped: Record<string, string | null> | null;
}

export interface DedupeProviderRecord {
  id: string;
  firstName: string;
  lastName: string;
  npi: string | null;
  specialty: string | null;
}

export interface DedupeGroupRecord {
  id: string;
  name: string;
  tin: string | null;
}

export interface DedupeFacilityRecord {
  id: string;
  name: string;
}

export interface GroupAssignmentPair {
  providerId: string;
  groupId: string;
}

export interface FacilityAssignmentPair {
  providerId: string;
  facilityId: string;
}

export interface DedupeLicenseRecord {
  id: string;
  providerId: string;
  state: string;
  licenseNumber: string | null;
  issueDate: string | null;
  expirationDate: string | null;
}

export interface DedupeInputs {
  rows: StagedImportRow[];
  providers: DedupeProviderRecord[];
  groups: DedupeGroupRecord[];
  facilities: DedupeFacilityRecord[];
  groupAssignments: GroupAssignmentPair[];
  facilityAssignments: FacilityAssignmentPair[];
  licenses: DedupeLicenseRecord[];
}

export interface LicenseDraft {
  state: string;
  licenseNumber: string;
  issueDate: string | null;
  expirationDate: string | null;
}

export type ConflictField = "name" | "npi" | "specialty" | "license";

export interface ImportConflict {
  /** stable per-entry key ("name" | "npi" | "specialty" | "license:<id>") */
  key: string;
  field: ConflictField;
  label: string;
  existingDisplay: string | null;
  importedDisplay: string;
  /** provider-column writes applied when the pick is "imported" */
  set?: Record<string, string>;
  /** license-row update applied when the pick is "imported" */
  licenseUpdate?: { id: string } & Partial<LicenseDraft>;
}

export interface CreateDisposition {
  kind: "create";
  line: number;
  lines: number[];
  displayName: string;
  npi: string;
  provider: {
    firstName: string;
    middleInitial: string | null;
    lastName: string;
    npi: string;
    caqhId: string | null;
    specialty: string | null;
    taxonomyCode: string | null;
    ssnLast4: string | null;
    dateOfBirth: string | null;
  };
  /** resolved group ids, first = primary */
  groupIds: string[];
  facilityIds: string[];
  licenses: LicenseDraft[];
  notes: string[];
}

export interface UpdateDisposition {
  kind: "update";
  line: number;
  lines: number[];
  providerId: string;
  displayName: string;
  conflicts: ImportConflict[];
  addGroupIds: string[];
  addFacilityIds: string[];
  licenseInserts: LicenseDraft[];
  notes: string[];
}

export interface SkipDisposition {
  kind: "skip";
  line: number;
  lines: number[];
  providerId: string;
  displayName: string;
  reason: string;
  notes: string[];
}

export interface BlockedDisposition {
  kind: "blocked";
  line: number;
  column: string | null;
  displayName: string;
  reason: string;
}

export type ImportRowDisposition =
  CreateDisposition | UpdateDisposition | SkipDisposition | BlockedDisposition;

export const ALREADY_EXISTS_REASON = "already exists";
export const MISSING_NPI_MATCH_REASON =
  "Missing NPI — matches an existing provider by name; review manually (never merged automatically)";
export const MISSING_NPI_REASON = "Missing NPI — flagged for manual review";

const norm = (v: string | null | undefined): string =>
  (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const digits = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");

function field(row: StagedImportRow, key: string): string | null {
  const v = row.mapped?.[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function personName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ");
}

/** Group resolution: TIN first (bare digits), then normalized name. */
export function resolveGroup(
  row: StagedImportRow,
  groups: DedupeGroupRecord[],
): { group: DedupeGroupRecord | null; note: string | null } {
  const tin = digits(field(row, "group_tin"));
  const name = norm(field(row, "group_name"));
  const byTin = tin ? (groups.find((g) => digits(g.tin) === tin) ?? null) : null;
  if (byTin) return { group: byTin, note: null };
  const byName = name ? (groups.find((g) => norm(g.name) === name) ?? null) : null;
  if (byName) {
    const note =
      tin && digits(byName.tin) && digits(byName.tin) !== tin
        ? `Group "${byName.name}" matched by name but the TIN in the file differs from the group on record`
        : null;
    return { group: byName, note };
  }
  const label = field(row, "group_name") ?? field(row, "group_tin") ?? "unknown";
  return {
    group: null,
    note: `Group "${label}" not found — no group assignment will be created (use batch assignment after commit)`,
  };
}

export function resolveFacility(
  row: StagedImportRow,
  facilities: DedupeFacilityRecord[],
): { facility: DedupeFacilityRecord | null; note: string | null } {
  const name = norm(field(row, "facility_name"));
  if (!name) return { facility: null, note: null };
  const match = facilities.find((f) => norm(f.name) === name) ?? null;
  if (match) return { facility: match, note: null };
  return {
    facility: null,
    note: `Facility "${field(row, "facility_name")}" not found — no facility assignment will be created (use batch assignment after commit)`,
  };
}

function licenseOf(row: StagedImportRow): { draft: LicenseDraft | null; note: string | null } {
  const state = field(row, "license_state");
  const number = field(row, "license_number");
  if (state && number) {
    return {
      draft: {
        state: state.toUpperCase(),
        licenseNumber: number,
        issueDate: field(row, "license_issue_date"),
        expirationDate: field(row, "license_expiration_date"),
      },
      note: null,
    };
  }
  if (state || number) {
    return {
      draft: null,
      note: "License ignored — both license_state and license_number are needed",
    };
  }
  return { draft: null, note: null };
}

function pushUnique<T>(arr: T[], value: T): void {
  if (!arr.includes(value)) arr.push(value);
}

function pushNote(notes: string[], note: string | null): void {
  if (note && !notes.includes(note)) notes.push(note);
}

/** The five-part dedupe pass: staged rows × existing org data → folded,
 * per-provider dispositions. Deterministic — row order decides fold anchors. */
export function dedupeImportRows(inputs: DedupeInputs): ImportRowDisposition[] {
  const byNpi = new Map<string, DedupeProviderRecord>();
  for (const p of inputs.providers) {
    if (p.npi && p.npi.trim() !== "") byNpi.set(p.npi.trim(), p);
  }
  const byName = new Map<string, DedupeProviderRecord[]>();
  for (const p of inputs.providers) {
    const key = norm(personName(p.firstName, p.lastName));
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(p);
    byName.set(key, list);
  }
  const groupsOf = new Map<string, Set<string>>();
  for (const a of inputs.groupAssignments) {
    const set = groupsOf.get(a.providerId) ?? new Set<string>();
    set.add(a.groupId);
    groupsOf.set(a.providerId, set);
  }
  const facilitiesOf = new Map<string, Set<string>>();
  for (const a of inputs.facilityAssignments) {
    const set = facilitiesOf.get(a.providerId) ?? new Set<string>();
    set.add(a.facilityId);
    facilitiesOf.set(a.providerId, set);
  }
  const licensesOf = new Map<string, DedupeLicenseRecord[]>();
  for (const l of inputs.licenses) {
    const list = licensesOf.get(l.providerId) ?? [];
    list.push(l);
    licensesOf.set(l.providerId, list);
  }

  const ordered: ImportRowDisposition[] = [];
  const createByNpi = new Map<string, CreateDisposition>();
  const matchedByProvider = new Map<string, UpdateDisposition>();

  for (const row of inputs.rows) {
    if (!row.mapped) {
      ordered.push({
        kind: "blocked",
        line: row.line,
        column: null,
        displayName: "—",
        reason: "Row has no scanned values",
      });
      continue;
    }

    const first = field(row, "provider_first_name");
    const last = field(row, "provider_last_name");
    const displayName = personName(first, last) || "—";
    const npi = field(row, "npi");
    const nameKey = norm(personName(first, last));

    // Missing NPI → exact-name fallback, always manual review (never merged).
    if (!npi) {
      const nameMatches = nameKey ? (byName.get(nameKey) ?? []) : [];
      ordered.push({
        kind: "blocked",
        line: row.line,
        column: "npi",
        displayName,
        reason: nameMatches.length > 0 ? MISSING_NPI_MATCH_REASON : MISSING_NPI_REASON,
      });
      continue;
    }

    const { group, note: groupNote } = resolveGroup(row, inputs.groups);
    const { facility, note: facilityNote } = resolveFacility(row, inputs.facilities);
    const { draft: license, note: licenseNote } = licenseOf(row);

    const existing = byNpi.get(npi) ?? null;
    if (existing) {
      // ---- Existing provider (matched by NPI): fold into ONE entry. ----
      let entry = matchedByProvider.get(existing.id);
      if (!entry) {
        entry = {
          kind: "update",
          line: row.line,
          lines: [],
          providerId: existing.id,
          displayName: personName(existing.firstName, existing.lastName),
          conflicts: [],
          addGroupIds: [],
          addFacilityIds: [],
          licenseInserts: [],
          notes: [],
        };
        matchedByProvider.set(existing.id, entry);
        ordered.push(entry);

        // Conflicts are provider-grain — computed once, from the FIRST line.
        if (nameKey && nameKey !== norm(personName(existing.firstName, existing.lastName))) {
          entry.conflicts.push({
            key: "name",
            field: "name",
            label: "Name",
            existingDisplay: personName(existing.firstName, existing.lastName),
            importedDisplay: displayName,
            set: { first_name: first ?? "", last_name: last ?? "" },
          });
        }
        const specialty = field(row, "specialty");
        if (specialty && norm(specialty) !== norm(existing.specialty)) {
          entry.conflicts.push({
            key: "specialty",
            field: "specialty",
            label: "Specialty",
            existingDisplay: existing.specialty,
            importedDisplay: specialty,
            set: { specialty },
          });
        }
      }
      entry.lines.push(row.line);
      pushNote(entry.notes, groupNote);
      pushNote(entry.notes, facilityNote);
      pushNote(entry.notes, licenseNote);

      if (group && !(groupsOf.get(existing.id)?.has(group.id) ?? false)) {
        pushUnique(entry.addGroupIds, group.id);
      }
      if (facility && !(facilitiesOf.get(existing.id)?.has(facility.id) ?? false)) {
        pushUnique(entry.addFacilityIds, facility.id);
      }
      if (license) {
        const inState = (licensesOf.get(existing.id) ?? []).filter(
          (l) => norm(l.state) === norm(license.state),
        );
        const sameNumber = inState.find(
          (l) => norm(l.licenseNumber) === norm(license.licenseNumber),
        );
        if (inState.length === 0) {
          if (
            !entry.licenseInserts.some(
              (l) =>
                norm(l.state) === norm(license.state) &&
                norm(l.licenseNumber) === norm(license.licenseNumber),
            )
          ) {
            entry.licenseInserts.push(license);
          }
        } else if (!sameNumber) {
          const target = inState[0];
          const key = `license:${target.id}`;
          if (!entry.conflicts.some((c) => c.key === key)) {
            entry.conflicts.push({
              key,
              field: "license",
              label: `License (${license.state})`,
              existingDisplay: target.licenseNumber,
              importedDisplay: license.licenseNumber,
              licenseUpdate: {
                id: target.id,
                licenseNumber: license.licenseNumber,
                issueDate: license.issueDate,
                expirationDate: license.expirationDate,
              },
            });
          }
        }
        // same state + same number → nothing to change
      }
      continue;
    }

    // ---- No NPI match: a NEW provider, folded per NPI. ----
    const existingCreate = createByNpi.get(npi);
    if (existingCreate) {
      existingCreate.lines.push(row.line);
      if (nameKey && nameKey !== norm(existingCreate.displayName)) {
        pushNote(
          existingCreate.notes,
          `Row ${row.line} lists a different name for NPI ${npi} — the first row's values are used`,
        );
      }
      pushNote(existingCreate.notes, groupNote);
      pushNote(existingCreate.notes, facilityNote);
      pushNote(existingCreate.notes, licenseNote);
      if (group) pushUnique(existingCreate.groupIds, group.id);
      if (facility) pushUnique(existingCreate.facilityIds, facility.id);
      if (
        license &&
        !existingCreate.licenses.some(
          (l) =>
            norm(l.state) === norm(license.state) &&
            norm(l.licenseNumber) === norm(license.licenseNumber),
        )
      ) {
        existingCreate.licenses.push(license);
      }
      continue;
    }

    const notes: string[] = [];
    pushNote(notes, groupNote);
    pushNote(notes, facilityNote);
    pushNote(notes, licenseNote);
    const sameNameNeighbor = nameKey
      ? (byName.get(nameKey) ?? []).find((p) => p.npi && p.npi.trim() !== "" && p.npi !== npi)
      : undefined;
    if (sameNameNeighbor) {
      pushNote(
        notes,
        `An existing provider named ${personName(sameNameNeighbor.firstName, sameNameNeighbor.lastName)} has a different NPI (${sameNameNeighbor.npi}) — treated as a new provider`,
      );
    }
    // Same-name existing provider WITHOUT an NPI on record → the NPI-fill
    // conflict: an update, not a duplicate create.
    const npilessNameMatch = nameKey
      ? (byName.get(nameKey) ?? []).find((p) => !p.npi || p.npi.trim() === "")
      : undefined;
    if (npilessNameMatch && !sameNameNeighbor) {
      let entry = matchedByProvider.get(npilessNameMatch.id);
      if (!entry) {
        entry = {
          kind: "update",
          line: row.line,
          lines: [],
          providerId: npilessNameMatch.id,
          displayName: personName(npilessNameMatch.firstName, npilessNameMatch.lastName),
          conflicts: [
            {
              key: "npi",
              field: "npi",
              label: "NPI",
              existingDisplay: null,
              importedDisplay: npi,
              set: { npi },
            },
          ],
          addGroupIds: [],
          addFacilityIds: [],
          licenseInserts: [],
          notes: [],
        };
        matchedByProvider.set(npilessNameMatch.id, entry);
        ordered.push(entry);
      }
      entry.lines.push(row.line);
      pushNote(entry.notes, groupNote);
      pushNote(entry.notes, facilityNote);
      pushNote(entry.notes, licenseNote);
      if (group && !(groupsOf.get(npilessNameMatch.id)?.has(group.id) ?? false)) {
        pushUnique(entry.addGroupIds, group.id);
      }
      if (facility && !(facilitiesOf.get(npilessNameMatch.id)?.has(facility.id) ?? false)) {
        pushUnique(entry.addFacilityIds, facility.id);
      }
      if (license) {
        const inState = (licensesOf.get(npilessNameMatch.id) ?? []).filter(
          (l) => norm(l.state) === norm(license.state),
        );
        if (inState.length === 0) entry.licenseInserts.push(license);
      }
      continue;
    }

    const create: CreateDisposition = {
      kind: "create",
      line: row.line,
      lines: [row.line],
      displayName,
      npi,
      provider: {
        firstName: first ?? "",
        middleInitial: field(row, "provider_middle_initial"),
        lastName: last ?? "",
        npi,
        caqhId: field(row, "caqh_id"),
        specialty: field(row, "specialty"),
        taxonomyCode: field(row, "taxonomy_code"),
        ssnLast4: field(row, "ssn_last4"),
        dateOfBirth: field(row, "date_of_birth"),
      },
      groupIds: group ? [group.id] : [],
      facilityIds: facility ? [facility.id] : [],
      licenses: license ? [license] : [],
      notes,
    };
    createByNpi.set(npi, create);
    ordered.push(create);
  }

  // Matched providers with nothing to add and nothing conflicting are exact
  // five-part duplicates → skip, "already exists" (F3.1.2).
  return ordered.map((d): ImportRowDisposition => {
    if (
      d.kind === "update" &&
      d.conflicts.length === 0 &&
      d.addGroupIds.length === 0 &&
      d.addFacilityIds.length === 0 &&
      d.licenseInserts.length === 0
    ) {
      return {
        kind: "skip",
        line: d.line,
        lines: d.lines,
        providerId: d.providerId,
        displayName: d.displayName,
        reason: ALREADY_EXISTS_REASON,
        notes: d.notes,
      };
    }
    return d;
  });
}

/* --------------------------- Conflict resolution --------------------------- */

export type ConflictChoice = "existing" | "imported";

/** providerId → conflict key → explicit pick. A conflict with no entry here is
 * UNRESOLVED and blocks its row (the default shown is the existing value, but
 * an explicit choice is required — imports never silently overwrite). */
export type RunResolutions = Record<string, Record<string, ConflictChoice>>;

export function unresolvedConflicts(
  entry: UpdateDisposition,
  resolutions: RunResolutions,
): ImportConflict[] {
  const picks = resolutions[entry.providerId] ?? {};
  return entry.conflicts.filter((c) => picks[c.key] !== "existing" && picks[c.key] !== "imported");
}

/* ------------------------------ Summary counts ----------------------------- */

export interface ImportPreviewSummary {
  /** folded new-provider entries */
  createProviders: number;
  /** folded commit-ready update entries (all conflicts explicitly resolved) */
  updateProviders: number;
  /** rows that cannot commit: scan errors + manual-review rows + rows of
   * update entries with unresolved conflicts */
  blockedRows: number;
  /** folded exact-duplicate entries */
  skippedProviders: number;
  /** staged-row coverage for exact reconciliation with the run counts */
  stagedRowsCovered: number;
}

export function summarizeImportPreview(
  dispositions: ImportRowDisposition[],
  resolutions: RunResolutions,
  scanErrorRows: number,
): ImportPreviewSummary {
  let createProviders = 0;
  let updateProviders = 0;
  let skippedProviders = 0;
  let blockedRows = scanErrorRows;
  let stagedRowsCovered = 0;
  for (const d of dispositions) {
    if (d.kind === "create") {
      createProviders += 1;
      stagedRowsCovered += d.lines.length;
    } else if (d.kind === "update") {
      stagedRowsCovered += d.lines.length;
      if (unresolvedConflicts(d, resolutions).length > 0) {
        blockedRows += d.lines.length;
      } else {
        updateProviders += 1;
      }
    } else if (d.kind === "skip") {
      skippedProviders += 1;
      stagedRowsCovered += d.lines.length;
    } else {
      blockedRows += 1;
      stagedRowsCovered += 1;
    }
  }
  return { createProviders, updateProviders, blockedRows, skippedProviders, stagedRowsCovered };
}

/* ------------------------------- Commit plan ------------------------------- */

// The commit_import_run wire shape (snake_case jsonb, the locked RPC contract).
export interface CommitPlanCreate {
  line: number;
  provider: {
    first_name: string;
    middle_initial: string | null;
    last_name: string;
    npi: string;
    caqh_id: string | null;
    specialty: string | null;
    taxonomy_code: string | null;
    ssn_last4: string | null;
    date_of_birth: string | null;
  };
  group_ids: string[];
  facility_ids: string[];
  licenses: Array<{
    state: string;
    license_number: string;
    issue_date: string | null;
    expiration_date: string | null;
  }>;
}

export interface CommitPlanUpdate {
  line: number;
  provider_id: string;
  set: Record<string, string>;
  add_group_ids: string[];
  add_facility_ids: string[];
  license_inserts: Array<{
    state: string;
    license_number: string;
    issue_date: string | null;
    expiration_date: string | null;
  }>;
  license_updates: Array<{
    id: string;
    license_number: string | null;
    issue_date: string | null;
    expiration_date: string | null;
  }>;
}

export interface CommitPlanBlockedEntry {
  line: number;
  column: string | null;
  reason: string;
}

export interface CommitPlan {
  creates: CommitPlanCreate[];
  updates: CommitPlanUpdate[];
  skipped_count: number;
  blocked_entries: CommitPlanBlockedEntry[];
}

const toWireLicense = (l: LicenseDraft) => ({
  state: l.state,
  license_number: l.licenseNumber,
  issue_date: l.issueDate,
  expiration_date: l.expirationDate,
});

/** Fold the reviewed dispositions + explicit conflict picks into the RPC
 * plan. Update entries with UNRESOLVED conflicts are excluded and recorded as
 * blocked entries (they join the durable error report — blocked rows never
 * silently vanish with the staged-row purge). */
export function buildCommitPlan(
  dispositions: ImportRowDisposition[],
  resolutions: RunResolutions,
): CommitPlan {
  const creates: CommitPlanCreate[] = [];
  const updates: CommitPlanUpdate[] = [];
  const blocked: CommitPlanBlockedEntry[] = [];
  let skipped = 0;

  for (const d of dispositions) {
    if (d.kind === "create") {
      creates.push({
        line: d.line,
        provider: {
          first_name: d.provider.firstName,
          middle_initial: d.provider.middleInitial,
          last_name: d.provider.lastName,
          npi: d.provider.npi,
          caqh_id: d.provider.caqhId,
          specialty: d.provider.specialty,
          taxonomy_code: d.provider.taxonomyCode,
          ssn_last4: d.provider.ssnLast4,
          date_of_birth: d.provider.dateOfBirth,
        },
        group_ids: d.groupIds,
        facility_ids: d.facilityIds,
        licenses: d.licenses.map(toWireLicense),
      });
    } else if (d.kind === "update") {
      const unresolved = unresolvedConflicts(d, resolutions);
      if (unresolved.length > 0) {
        for (const c of unresolved) {
          blocked.push({
            line: d.line,
            column: c.field,
            reason: `Unresolved ${c.label.toLowerCase()} conflict — row not committed`,
          });
        }
        continue;
      }
      const picks = resolutions[d.providerId] ?? {};
      const set: Record<string, string> = {};
      const licenseUpdates: CommitPlanUpdate["license_updates"] = [];
      for (const c of d.conflicts) {
        if (picks[c.key] !== "imported") continue;
        if (c.set) Object.assign(set, c.set);
        if (c.licenseUpdate) {
          licenseUpdates.push({
            id: c.licenseUpdate.id,
            license_number: c.licenseUpdate.licenseNumber ?? null,
            issue_date: c.licenseUpdate.issueDate ?? null,
            expiration_date: c.licenseUpdate.expirationDate ?? null,
          });
        }
      }
      updates.push({
        line: d.line,
        provider_id: d.providerId,
        set,
        add_group_ids: d.addGroupIds,
        add_facility_ids: d.addFacilityIds,
        license_inserts: d.licenseInserts.map(toWireLicense),
        license_updates: licenseUpdates,
      });
    } else if (d.kind === "skip") {
      skipped += 1;
    } else {
      blocked.push({ line: d.line, column: d.column, reason: d.reason });
    }
  }

  return { creates, updates, skipped_count: skipped, blocked_entries: blocked };
}

/* --------------------------- Batch assignment (F3.1.5) --------------------- */

export interface BatchAssignmentPlan {
  groupInserts: Array<{ providerId: string; groupId: string; isPrimary: boolean }>;
  facilityInserts: Array<{ providerId: string; facilityId: string }>;
  /** providers untouched in BOTH dimensions (row-explicit data won) */
  skippedProviderIds: string[];
}

/* ------------------- E3.3 TE-8 — group / facility dedupe ------------------- */
//
// The provider grain above (five-part, per-field conflict review) is the rich
// case. The Provider Group and Facilities sections are simpler: skip-on-match,
// no conflict review, no update (imported group/facility data proposes a NEW
// row or is skipped). These two grains are a THIN addition to this same pure
// module — NOT a parallel engine (TE-8). Both produce create / skip / blocked
// dispositions the section commit fans out to createProviderGroup /
// createFacility.

export interface FacilityDedupeRecord {
  id: string;
  name: string;
  groupId: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface SectionCreateEntry {
  line: number;
  displayName: string;
  /** the staged mapped row — the service builds the create input from it */
  mapped: Record<string, string | null>;
  /** facility only: the resolved parent group id (null for group creates) */
  groupId: string | null;
  notes: string[];
}

export interface SectionSkipEntry {
  line: number;
  displayName: string;
  reason: string;
}

export interface SectionBlockedEntry {
  line: number;
  column: string | null;
  displayName: string;
  reason: string;
}

export interface SectionDedupeResult {
  creates: SectionCreateEntry[];
  skips: SectionSkipEntry[];
  blocked: SectionBlockedEntry[];
}

const addressKey = (r: {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string => [r.street, r.city, r.state, r.zip].map((v) => norm(v)).join("|");

/** Provider-group dedupe (TE-8): grain = TIN. A staged group whose TIN matches
 * an existing group is skipped ("already exists"); a TIN repeated within the
 * file folds to one create (later rows skip). A row missing a TIN is blocked
 * (the scan already requires it — defensive). */
export function dedupeGroupRows(
  rows: StagedImportRow[],
  groups: DedupeGroupRecord[],
): SectionDedupeResult {
  const existingByTin = new Map<string, DedupeGroupRecord>();
  for (const g of groups) {
    const t = digits(g.tin);
    if (t) existingByTin.set(t, g);
  }
  const result: SectionDedupeResult = { creates: [], skips: [], blocked: [] };
  const seenTins = new Set<string>();
  for (const row of rows) {
    if (!row.mapped) {
      result.blocked.push({
        line: row.line,
        column: null,
        displayName: "—",
        reason: "Row has no scanned values",
      });
      continue;
    }
    const name = row.mapped.name?.trim() || "";
    const tin = digits(row.mapped.tin);
    const displayName = name || (tin ? `TIN ${tin}` : "—");
    if (!tin) {
      result.blocked.push({
        line: row.line,
        column: "group_tin",
        displayName,
        reason: "Missing TIN — a group is identified by its TIN",
      });
      continue;
    }
    const existing = existingByTin.get(tin);
    if (existing) {
      result.skips.push({
        line: row.line,
        displayName,
        reason: `${ALREADY_EXISTS_REASON} (TIN ${tin} → ${existing.name})`,
      });
      continue;
    }
    if (seenTins.has(tin)) {
      result.skips.push({
        line: row.line,
        displayName,
        reason: `Duplicate TIN ${tin} in this file`,
      });
      continue;
    }
    seenTins.add(tin);
    result.creates.push({
      line: row.line,
      displayName,
      mapped: row.mapped,
      groupId: null,
      notes: [],
    });
  }
  return result;
}

/** Facility dedupe (TE-8): grain = (parent group, facility name + address). The
 * parent group is resolved by TIN then name (a facility needs its group — the
 * ladder, TE-5); an unresolved group blocks the row. A facility matching an
 * existing one at the same group + name + address is skipped; a name+address
 * repeated within the file folds to one create. */
export function dedupeFacilityRows(
  rows: StagedImportRow[],
  groups: DedupeGroupRecord[],
  facilities: FacilityDedupeRecord[],
): SectionDedupeResult {
  const result: SectionDedupeResult = { creates: [], skips: [], blocked: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.mapped) {
      result.blocked.push({
        line: row.line,
        column: null,
        displayName: "—",
        reason: "Row has no scanned values",
      });
      continue;
    }
    const name = row.mapped.facility_name?.trim() || "";
    const displayName = name || "—";
    // Resolve parent group by TIN first, then normalized name.
    const tin = digits(row.mapped.group_tin);
    const gName = norm(row.mapped.group_name);
    const group =
      (tin ? groups.find((g) => digits(g.tin) === tin) : undefined) ??
      (gName ? groups.find((g) => norm(g.name) === gName) : undefined) ??
      null;
    if (!group) {
      const label = row.mapped.group_name ?? row.mapped.group_tin ?? "unknown";
      result.blocked.push({
        line: row.line,
        column: "group_name",
        displayName,
        reason: `Parent group "${label}" not found — add the provider group first`,
      });
      continue;
    }
    const key = `${group.id}::${norm(name)}::${addressKey({
      street: row.mapped.street,
      city: row.mapped.city,
      state: row.mapped.state,
      zip: row.mapped.zip,
    })}`;
    const existing = facilities.find(
      (f) =>
        f.groupId === group.id &&
        norm(f.name) === norm(name) &&
        addressKey(f) ===
          addressKey({
            street: row.mapped?.street ?? null,
            city: row.mapped?.city ?? null,
            state: row.mapped?.state ?? null,
            zip: row.mapped?.zip ?? null,
          }),
    );
    if (existing) {
      result.skips.push({
        line: row.line,
        displayName,
        reason: `${ALREADY_EXISTS_REASON} at ${group.name}`,
      });
      continue;
    }
    if (seen.has(key)) {
      result.skips.push({
        line: row.line,
        displayName,
        reason: "Duplicate facility (same group, name and address) in this file",
      });
      continue;
    }
    seen.add(key);
    result.creates.push({
      line: row.line,
      displayName,
      mapped: row.mapped,
      groupId: group.id,
      notes: [],
    });
  }
  return result;
}

/** One-shot batch assignment for a committed run's providers. Explicit row
 * data wins over the batch default: a provider whose import rows already
 * created assignments in a dimension keeps them and gets NO batch default in
 * that dimension — the batch fills the gaps. Idempotent by construction: a
 * re-run finds the gaps filled and plans zero inserts (the DB uniques on both
 * assignment tables are the backstop, TE-7). */
export function planBatchAssignment(input: {
  providerIds: string[];
  groupId: string | null;
  facilityIds: string[];
  existingGroupAssignments: GroupAssignmentPair[];
  existingFacilityAssignments: FacilityAssignmentPair[];
}): BatchAssignmentPlan {
  const hasGroup = new Set(input.existingGroupAssignments.map((a) => a.providerId));
  const hasFacility = new Set(input.existingFacilityAssignments.map((a) => a.providerId));
  const groupInserts: BatchAssignmentPlan["groupInserts"] = [];
  const facilityInserts: BatchAssignmentPlan["facilityInserts"] = [];
  const skipped: string[] = [];
  for (const providerId of input.providerIds) {
    let touched = false;
    if (input.groupId && !hasGroup.has(providerId)) {
      // The gap-filled group is the provider's first — safe to make primary
      // (the one-primary partial unique sees zero existing rows).
      groupInserts.push({ providerId, groupId: input.groupId, isPrimary: true });
      touched = true;
    }
    if (input.facilityIds.length > 0 && !hasFacility.has(providerId)) {
      for (const facilityId of input.facilityIds) {
        facilityInserts.push({ providerId, facilityId });
      }
      touched = true;
    }
    if (!touched) skipped.push(providerId);
  }
  return { groupInserts, facilityInserts, skippedProviderIds: skipped };
}
