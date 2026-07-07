// CSV onboarding-package commit step (Epic 2c, P6). Consumes the pure parse
// result from src/lib/csvImport.ts and writes it through the EXISTING create
// services — createFacility, createProviderWithDetails, assignProviderToFacility
// — so org_id, audit rows, and RLS behave exactly as they do for hand entry.
// No table is touched directly here.
//
// Best-effort per row: a failed create is recorded and the run continues. Rows
// default reference_only=true unless the wizard toggle is off. Assignments
// resolve their CSV facility/provider keys to the real created ids via the
// key→id maps built as facilities/providers are created; an assignment whose
// referenced row failed to create is reported as skipped.
import type { CsvImportResult, ParsedFacility, ParsedProvider } from "@/lib/csvImport";
import type { ProviderGroup } from "@/types";
import { createFacility } from "@/services/orgSettings";
import { createProviderWithDetails } from "@/services/providers";
import { assignProviderToFacility } from "@/services/launches";

export interface CommitOptions {
  referenceOnly: boolean;
  /** the org's provider groups, for group_name → group_id resolution */
  groups: ProviderGroup[];
}

export interface CommitCounts {
  created: number;
  failed: number;
}

export interface CommitFailure {
  file: CsvImportResult["errors"][number]["file"];
  line: number;
  label: string;
  message: string;
}

export interface CommitSummary {
  facilities: CommitCounts;
  providers: CommitCounts;
  assignments: CommitCounts;
  failures: CommitFailure[];
}

function facilityLabel(f: ParsedFacility): string {
  return f.input.name;
}

function providerLabel(p: ParsedProvider): string {
  return `${p.input.firstName} ${p.input.lastName}`;
}

export async function commitImport(
  parsed: CsvImportResult,
  opts: CommitOptions,
): Promise<CommitSummary> {
  const groupIdByName = new Map<string, string>();
  for (const g of opts.groups) groupIdByName.set(g.name.trim().toLowerCase(), g.id);
  const resolveGroup = (name: string | null): string | null =>
    name ? (groupIdByName.get(name.trim().toLowerCase()) ?? null) : null;

  const summary: CommitSummary = {
    facilities: { created: 0, failed: 0 },
    providers: { created: 0, failed: 0 },
    assignments: { created: 0, failed: 0 },
    failures: [],
  };

  // key (lowercased) → created facility id
  const facilityIdByKey = new Map<string, string>();
  for (const f of parsed.facilities) {
    try {
      const created = await createFacility({
        ...f.input,
        groupId: resolveGroup(f.groupName),
        referenceOnly: opts.referenceOnly,
      });
      for (const k of f.keys) facilityIdByKey.set(k.toLowerCase(), created.id);
      summary.facilities.created += 1;
    } catch (err) {
      summary.facilities.failed += 1;
      summary.failures.push({
        file: "facilities",
        line: f.line,
        label: facilityLabel(f),
        message: err instanceof Error ? err.message : "Create failed",
      });
    }
  }

  const providerIdByKey = new Map<string, string>();
  for (const p of parsed.providers) {
    try {
      const { provider, warnings } = await createProviderWithDetails({
        provider: {
          ...p.input,
          groupId: resolveGroup(p.groupName),
          referenceOnly: opts.referenceOnly,
        },
        licenses: p.licenses,
        facilityIds: [],
      });
      for (const k of p.keys) providerIdByKey.set(k.toLowerCase(), provider.id);
      summary.providers.created += 1;
      for (const w of warnings) {
        summary.failures.push({
          file: "providers",
          line: p.line,
          label: providerLabel(p),
          message: w,
        });
      }
    } catch (err) {
      summary.providers.failed += 1;
      summary.failures.push({
        file: "providers",
        line: p.line,
        label: providerLabel(p),
        message: err instanceof Error ? err.message : "Create failed",
      });
    }
  }

  for (const a of parsed.assignments) {
    const providerId = providerIdByKey.get(a.providerRef.toLowerCase());
    const facilityId = facilityIdByKey.get(a.facilityRef.toLowerCase());
    if (!providerId || !facilityId) {
      summary.assignments.failed += 1;
      summary.failures.push({
        file: "provider_facility_assignments",
        line: a.line,
        label: `${a.providerRef} → ${a.facilityRef}`,
        message: !providerId
          ? "Provider was not created, assignment skipped"
          : "Facility was not created, assignment skipped",
      });
      continue;
    }
    try {
      await assignProviderToFacility(providerId, facilityId);
      summary.assignments.created += 1;
    } catch (err) {
      summary.assignments.failed += 1;
      summary.failures.push({
        file: "provider_facility_assignments",
        line: a.line,
        label: `${a.providerRef} → ${a.facilityRef}`,
        message: err instanceof Error ? err.message : "Assignment failed",
      });
    }
  }

  return summary;
}
