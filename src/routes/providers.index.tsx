// E6.4 F6.4.1 — the Providers roster: A→Z by last name (stated on screen;
// search/filters never change the sort), PHI-safe list projection, ambient
// gap pills (src/lib/providerGaps.ts — reuses the readiness/candidacy rules,
// no new gap engine), and per-provider rollups joined client-side from the
// caches the app already holds: groups (provider_group_assignments), facility
// counts (provider_facility_assignments), license states + soonest expiry
// (org license summary), CAQH date (list projection), cases x-of-y approved
// (caseRollups). Clicking a gap pill lands on the record with that section
// focused (#hash). The old case-grouped work view is gone — casework lives on
// /cases (E6.1); this page is the people surface.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCanWrite } from "@/lib/permissions";
import { useCases } from "@/hooks/useCases";
import {
  useProviders,
  useProviderGroupAssignments,
  useProviderAssignments,
} from "@/hooks/useProviders";
import { useFacilities, useOrgStateLicenses, useProviderGroups } from "@/hooks/useLookups";
import { usePayers } from "@/hooks/useAdmin";
import { SectionUploadCard } from "@/components/onboarding/SectionUploadCard";
import { providerImportReference, type SectionScanContext } from "@/lib/importSections";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { providerCaseProgress } from "@/lib/caseRollups";
import { deriveProviderGaps, sortRosterAz, type ProviderGap } from "@/lib/providerGaps";
import { buildRosterCsv, type RosterRowInput } from "@/lib/rosterExport";
import { downloadCsvText } from "@/lib/csv";
import { fmtDate } from "@/lib/format";
import type { Provider } from "@/types";

export const Route = createFileRoute("/providers/")({
  component: ProvidersRoster,
});

interface RosterRow {
  provider: Provider;
  groupNames: string[];
  facilityCount: number;
  licenseStates: string[];
  soonestExpiry: string | null;
  gaps: ProviderGap[];
  progress: { approved: number; total: number } | null;
}

function GapPill({ providerId, gap }: { providerId: string; gap: ProviderGap }) {
  return (
    <Link
      to="/providers/$id"
      params={{ id: providerId }}
      hash={gap.section}
      className="inline-flex"
      aria-label={`${gap.label} — open the record's ${gap.section.replace("-", " & ")} section`}
    >
      <StatusPill status={gap.key === "license_expired" ? "red" : "amber"} label={gap.label} />
    </Link>
  );
}

function ProvidersRoster() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const providersQ = useProviders();
  const groupAssignQ = useProviderGroupAssignments();
  const facilityAssignQ = useProviderAssignments();
  const licensesQ = useOrgStateLicenses();
  const groupsQ = useProviderGroups();
  const casesQ = useCases();

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [gapsOnly, setGapsOnly] = useState(false);

  const today = localTodayIso();

  const rows = useMemo<RosterRow[] | undefined>(() => {
    if (!providersQ.data) return undefined;
    const groupNameById = new Map((groupsQ.data ?? []).map((g) => [g.id, g.name]));
    const groupsByProvider = new Map<string, { id: string; name: string; isPrimary: boolean }[]>();
    for (const a of groupAssignQ.data ?? []) {
      if (!a.providerId || !a.groupId) continue;
      const list = groupsByProvider.get(a.providerId) ?? [];
      list.push({
        id: a.groupId,
        name: groupNameById.get(a.groupId) ?? "—",
        isPrimary: a.isPrimary,
      });
      groupsByProvider.set(a.providerId, list);
    }
    const facilityCount = new Map<string, number>();
    for (const a of facilityAssignQ.data ?? []) {
      if (!a.providerId) continue;
      facilityCount.set(a.providerId, (facilityCount.get(a.providerId) ?? 0) + 1);
    }
    const licensesByProvider = new Map<string, { states: Set<string>; soonest: string | null }>();
    for (const l of licensesQ.data ?? []) {
      if (!l.providerId) continue;
      const entry = licensesByProvider.get(l.providerId) ?? { states: new Set(), soonest: null };
      if (l.state) entry.states.add(l.state);
      if (l.expirationDate && (!entry.soonest || l.expirationDate < entry.soonest)) {
        entry.soonest = l.expirationDate;
      }
      licensesByProvider.set(l.providerId, entry);
    }
    const progress = providerCaseProgress(
      (casesQ.data ?? []).map((c) => ({ providerId: c.providerId, status: c.caseStatus })),
    );
    return sortRosterAz(providersQ.data).map((provider) => {
      const groups = groupsByProvider.get(provider.id) ?? [];
      groups.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      const lic = licensesByProvider.get(provider.id);
      return {
        provider,
        groupIds: groups.map((g) => g.id),
        groupNames: groups.map((g) => g.name),
        facilityCount: facilityCount.get(provider.id) ?? 0,
        licenseStates: [...(lic?.states ?? [])].sort(),
        soonestExpiry: lic?.soonest ?? null,
        gaps: deriveProviderGaps({
          provider,
          hasFacilityAssignment: (facilityCount.get(provider.id) ?? 0) > 0,
          soonestLicenseExpiry: lic?.soonest ?? null,
          today,
        }),
        progress: progress.get(provider.id) ?? null,
      } as RosterRow & { groupIds: string[] };
    });
  }, [
    providersQ.data,
    groupsQ.data,
    groupAssignQ.data,
    facilityAssignQ.data,
    licensesQ.data,
    casesQ.data,
    today,
  ]);

  const filtered = useMemo(() => {
    if (!rows) return undefined;
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.provider.status === "terminated") return false;
      if (term) {
        const hay =
          `${r.provider.firstName} ${r.provider.lastName} ${r.provider.npi ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (groupFilter !== "all") {
        const ids = (r as RosterRow & { groupIds: string[] }).groupIds;
        if (!ids.includes(groupFilter)) return false;
      }
      if (stateFilter !== "all" && !r.licenseStates.includes(stateFilter)) return false;
      if (gapsOnly && r.gaps.length === 0) return false;
      return true;
    });
  }, [rows, search, groupFilter, stateFilter, gapsOnly]);

  const reference = useMemo(
    () => (filtered ?? []).filter((r) => r.provider.referenceOnly),
    [filtered],
  );
  const worked = useMemo(
    () => (filtered ?? []).filter((r) => !r.provider.referenceOnly),
    [filtered],
  );

  const licenseStateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) for (const s of r.licenseStates) set.add(s);
    return [...set].sort();
  }, [rows]);

  const facilitiesQ = useFacilities();
  const payersQ = usePayers();
  const uploadScanContext: SectionScanContext = {
    provider: {
      facilities: (facilitiesQ.data ?? []).map((f) => ({ id: f.id, name: f.name })),
      payers: (payersQ.data ?? []).map((py) => ({ id: py.id, name: py.name })),
    },
  };
  const uploadReference = providerImportReference(
    (groupsQ.data ?? []).map((g) => ({ name: g.name, tin: g.tin })),
    facilitiesQ.data ?? [],
    payersQ.data ?? [],
  );

  function handleExportRoster() {
    const exportRows: RosterRowInput[] = (filtered ?? []).map((r) => ({
      firstName: r.provider.firstName,
      lastName: r.provider.lastName,
      credentials: r.provider.credentials ?? null,
      npi: r.provider.npi ?? null,
      specialty: r.provider.specialty ?? null,
      homeState: r.provider.homeState ?? null,
      groupOrFacility: r.groupNames[0] ?? null,
      cases: [],
    }));
    if (exportRows.length === 0) return;
    downloadCsvText(`roster-${format(new Date(), "yyyy-MM-dd")}.csv`, buildRosterCsv(exportRows));
  }

  if (providersQ.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Providers" />
        <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the roster.</p>
      </div>
    );
  }

  const RowTable = ({ list }: { list: RosterRow[] }) => (
    <div className="overflow-x-auto rounded-md border border-[#E8E5E0]">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-[#F0EEE9] bg-[#FAFAF9] text-[12px] text-muted-foreground">
            <th className="px-3 py-2 font-medium">Provider</th>
            <th className="px-3 py-2 font-medium">NPI</th>
            <th className="px-3 py-2 font-medium">Groups</th>
            <th className="px-3 py-2 font-medium">Facilities</th>
            <th className="px-3 py-2 font-medium">Licenses</th>
            <th className="px-3 py-2 font-medium">CAQH attested</th>
            <th className="px-3 py-2 font-medium">Cases</th>
            <th className="px-3 py-2 font-medium">Gaps</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr
              key={r.provider.id}
              className="cursor-pointer border-b border-[#F0EEE9] last:border-0 hover:bg-[#FAFAF9]"
              onClick={() => navigate({ to: "/providers/$id", params: { id: r.provider.id } })}
            >
              <td className="px-3 py-2">
                <Link
                  to="/providers/$id"
                  params={{ id: r.provider.id }}
                  className="font-medium text-foreground hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.provider.lastName}, {r.provider.firstName}
                  {r.provider.credentials ? (
                    <span className="text-muted-foreground">, {r.provider.credentials}</span>
                  ) : null}
                </Link>
                <span className="ml-2 inline-flex gap-1 align-middle">
                  {r.provider.verificationState === "pending_verification" ? (
                    <StatusPill status="amber" label="Pending verification" />
                  ) : null}
                  {r.provider.referenceOnly ? (
                    <StatusPill status="neutral" label="Reference" />
                  ) : null}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums">{r.provider.npi ?? "—"}</td>
              <td className="max-w-[220px] truncate px-3 py-2">
                {r.groupNames.length > 0 ? r.groupNames.join(", ") : "—"}
              </td>
              <td className="px-3 py-2 tabular-nums">{r.facilityCount}</td>
              <td className="px-3 py-2">
                {r.licenseStates.length > 0 ? (
                  <span>
                    {r.licenseStates.join(" · ")}
                    {r.soonestExpiry ? (
                      <span className="text-muted-foreground">
                        {" "}
                        — exp {fmtDate(r.soonestExpiry)}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2">
                {r.provider.caqhLastAttestedDate ? fmtDate(r.provider.caqhLastAttestedDate) : "—"}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {r.progress ? `${r.progress.approved} of ${r.progress.total} approved` : "—"}
              </td>
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex flex-wrap gap-1">
                  {r.gaps.map((g) => (
                    <GapPill key={g.key} providerId={r.provider.id} gap={g} />
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Providers"
        description="Sorted A→Z by last name. Gap pills point at the exact record section to fix."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8" onClick={handleExportRoster}>
              Export roster
            </Button>
            {canWrite ? (
              <Button asChild size="sm" className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]">
                <Link to="/providers/new">New Provider</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or NPI"
          className="h-8 w-56 text-[13px]"
          aria-label="Search providers"
        />
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="h-8 w-48 text-[13px]" aria-label="Filter by group">
            <SelectValue placeholder="All groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All groups</SelectItem>
            {(groupsQ.data ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Filter by license state">
            <SelectValue placeholder="All license states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All license states</SelectItem>
            {licenseStateOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          aria-pressed={gapsOnly}
          onClick={() => setGapsOnly((v) => !v)}
        >
          {gapsOnly ? "Showing gaps only" : "Has gaps"}
        </Button>
      </div>

      {/* E6.4 — imports live with their data: the provider CSV (one row per
          relationship) uploads from THIS page, with scan-time name resolution
          and the real-names reference sheet. Admin-gated inside the card. */}
      <SectionUploadCard
        entityKind="provider"
        activeGroupCount={(groupsQ.data ?? []).filter((g) => g.isActive).length}
        scanContext={uploadScanContext}
        referenceCsv={uploadReference}
      />

      {filtered === undefined ? (
        <div className="h-40 animate-pulse rounded-md bg-mp-muted" />
      ) : worked.length === 0 && reference.length === 0 ? (
        <div className="rounded-md border border-[#E8E5E0] p-6 text-[13px] text-muted-foreground">
          No providers match. Clear the filters, or add your first provider.
        </div>
      ) : (
        <>
          {worked.length > 0 ? <RowTable list={worked} /> : null}
          {reference.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-[13px] font-semibold text-muted-foreground">Reference</h2>
              <RowTable list={reference} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
