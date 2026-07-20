// E6.2 F6.2.2 — the group's facilities list treatment: search on top,
// STATE-GROUPED and A→Z within state, filters (state, has-providers), per-row
// provider counts with the informational zero-provider flag (it cannot
// generate cases — derived from the already-loaded assignments cache, no new
// queries). Facility CRUD lives HERE (the shared FacilityForm — go-live is a
// plain date field, no location status machine) and the facility CSV import
// rides the E3.3 per-section staging machine on this page. Each facility
// belongs to exactly ONE group: a street address shared by two groups is
// entered once per group (payers see per-TIN service locations) — the rule
// is stated here and documented on the CSV template.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FacilityForm } from "@/components/onboarding/FacilityForm";
import { CsvImportPanel } from "@/components/import/CsvImportPanel";
import { RosterUploader } from "@/components/import/RosterUploader";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { useProviderAssignments } from "@/hooks/useProviders";
import { useUpdateFacility } from "@/hooks/useOrgSettings";
import { fmtDate } from "@/lib/format";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import type { Facility, ProviderGroup } from "@/types";

/** Above this many active locations the state groups default collapsed. */
const COLLAPSE_THRESHOLD = 10;

type ProviderFilter = "all" | "with" | "without";

export function GroupFacilitiesContent({ group }: { group: ProviderGroup }) {
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();
  const assignmentsQ = useProviderAssignments();
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("__all__");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [modal, setModal] = useState<{ facility: Facility | null } | null>(null);
  const [deactivating, setDeactivating] = useState<Facility | null>(null);

  const groupFacilities = useMemo(
    () => (facilitiesQ.data ?? []).filter((f) => f.isActive && f.groupId === group.id),
    [facilitiesQ.data, group.id],
  );

  const providerCounts = useMemo(() => {
    const byFacility = new Map<string, Set<string>>();
    for (const a of assignmentsQ.data ?? []) {
      if (!a.facilityId || !a.providerId) continue;
      if (!byFacility.has(a.facilityId)) byFacility.set(a.facilityId, new Set());
      byFacility.get(a.facilityId)?.add(a.providerId);
    }
    return byFacility;
  }, [assignmentsQ.data]);

  const providerCount = (facilityId: string) => providerCounts.get(facilityId)?.size ?? 0;

  const states = [...new Set(groupFacilities.map((f) => f.state ?? "—"))].sort();

  const filtered = groupFacilities.filter((f) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      f.name.toLowerCase().includes(q) ||
      (f.street ?? "").toLowerCase().includes(q) ||
      (f.city ?? "").toLowerCase().includes(q);
    const matchesState = stateFilter === "__all__" || (f.state ?? "—") === stateFilter;
    const count = providerCount(f.id);
    const matchesProviders =
      providerFilter === "all" || (providerFilter === "with" ? count > 0 : count === 0);
    return matchesSearch && matchesState && matchesProviders;
  });

  const grouped = new Map<string, Facility[]>();
  for (const f of filtered) {
    const key = f.state ?? "—";
    const list = grouped.get(key) ?? [];
    list.push(f);
    grouped.set(key, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const groupedStates = [...grouped.keys()].sort();
  const defaultOpen = groupFacilities.length <= COLLAPSE_THRESHOLD;

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted-foreground">
        Each facility belongs to exactly one group — a street address shared by two groups is
        entered once per group (payers see per-TIN service locations).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search locations…"
          aria-label="Search facilities"
          className="h-9 max-w-xs"
        />
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="h-9 w-36" aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All states</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={providerFilter}
          onValueChange={(v) => setProviderFilter(v as ProviderFilter)}
        >
          <SelectTrigger className="h-9 w-44" aria-label="Filter by providers">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            <SelectItem value="with">With providers</SelectItem>
            <SelectItem value="without">Without providers</SelectItem>
          </SelectContent>
        </Select>
        {canWrite ? (
          <Button
            className="ml-auto h-9 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            onClick={() => setModal({ facility: null })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add facility
          </Button>
        ) : null}
      </div>

      {groupFacilities.length === 0 ? (
        <Card className="border-[#E8E5E0]">
          <CardContent className="p-6 text-[13px] text-muted-foreground">
            No active locations yet. Add the group&apos;s practice locations here or import them
            from a CSV below.
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-[#E8E5E0]">
          <CardContent className="p-6 text-[13px] text-muted-foreground">
            No locations match the current search and filters.
          </CardContent>
        </Card>
      ) : (
        groupedStates.map((state) => {
          const rows = grouped.get(state) ?? [];
          return (
            <Collapsible key={state} defaultOpen={defaultOpen}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-3 py-2 text-left">
                <span className="text-[13px] font-semibold text-foreground">
                  {state} — {rows.length} {rows.length === 1 ? "location" : "locations"}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-2 space-y-2">
                  {rows.map((f) => {
                    const count = providerCount(f.id);
                    return (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E8E5E0] bg-white px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13.5px] font-medium text-foreground">
                              {f.name}
                            </span>
                            <span className="rounded bg-[var(--mp-neutral-tint)] px-1.5 py-0.5 text-[11.5px] text-[var(--mp-neutral-ink)]">
                              {count} {count === 1 ? "provider" : "providers"}
                            </span>
                            {count === 0 ? (
                              <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[11.5px] text-[#92400E]">
                                No providers — can&apos;t generate cases
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                            {[f.street, f.city].filter(Boolean).join(", ") || "No address"}
                            {f.effectiveDate ? ` · Go-live ${fmtDate(f.effectiveDate)}` : ""}
                          </div>
                        </div>
                        {canWrite ? (
                          <div className="flex flex-none items-center gap-2">
                            {count > 0 ? (
                              // E6.3 — the launch-context entry: opens the ONE
                              // shared grid pre-filtered to this location's
                              // providers (the retired launch dialog's job).
                              <Button asChild variant="outline" size="sm" className="h-8">
                                <Link to="/generation" search={{ group: group.id, facility: f.id }}>
                                  Review &amp; generate
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => setModal({ facility: f })}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-[#B91C1C]"
                              onClick={() => setDeactivating(f)}
                            >
                              Deactivate
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          );
        })
      )}

      {isAdmin ? (
        <CsvImportPanel
          label="Facility CSV import"
          description="Rows are validated and staged for review; nothing changes until the import is committed."
        >
          <RosterUploader source="internal" variant="internal" entityKind="facility" />
        </CsvImportPanel>
      ) : null}

      {modal ? (
        <FacilityForm
          facility={modal.facility}
          groups={groupsQ.data ?? []}
          defaultGroupId={group.id}
          onClose={() => setModal(null)}
        />
      ) : null}
      {deactivating ? (
        <DeactivateFacilityDialog facility={deactivating} onClose={() => setDeactivating(null)} />
      ) : null}
    </div>
  );
}

// Soft delete — isActive:false via the audited update path, never a row delete
// (the E1.2 rule; assignments and history stay intact).
function DeactivateFacilityDialog({
  facility,
  onClose,
}: {
  facility: Facility;
  onClose: () => void;
}) {
  const updateMut = useUpdateFacility(facility.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Deactivate {facility.name}?</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          The location is hidden from active lists and stops contributing to payer targeting. Its
          history and provider assignments are kept — nothing is deleted.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              updateMut.mutate(
                { isActive: false },
                {
                  onSuccess: () => {
                    toast.success("Facility deactivated");
                    onClose();
                  },
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Couldn't deactivate"),
                },
              )
            }
            disabled={updateMut.isPending}
            className="bg-[#B91C1C] text-white hover:bg-[#991B1B]"
          >
            {updateMut.isPending ? "Working…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
