// E3.1 F3.1.5 — the one-step batch assignment for a committed run's
// providers. One action assigns the whole batch to a group + one or more
// facilities; explicit row data wins over the batch default (a provider that
// already got assignments from its own CSV columns keeps them and the batch
// only fills gaps — the pure planBatchAssignment). Idempotent: the DB uniques
// on both assignment tables mean running it twice adds nothing (TE-7). No
// standing rules, no rule engine (decisions 8-9).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import { useApplyBatchAssignment, useProviderAssignmentsForRun } from "@/hooks/useImportRuns";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { planBatchAssignment } from "@/lib/importDedupe";
import type { ImportRun } from "@/types";

const NONE = "__none__";

export function BatchAssignPanel({ run }: { run: ImportRun }) {
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilities();
  const applyMut = useApplyBatchAssignment();
  const runProviders = useProviderAssignmentsForRun(run);

  const [groupId, setGroupId] = useState<string>(NONE);
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const activeGroups = (groupsQ.data ?? []).filter((g) => g.isActive);
  const activeFacilities = (facilitiesQ.data ?? []).filter((f) => f.isActive);

  const providerIds = useMemo(
    () => [...(run.createdProviderIds ?? []), ...(run.updatedProviderIds ?? [])],
    [run.createdProviderIds, run.updatedProviderIds],
  );

  const plan = useMemo(
    () =>
      planBatchAssignment({
        providerIds,
        groupId: groupId === NONE ? null : groupId,
        facilityIds,
        existingGroupAssignments: runProviders.groupAssignments,
        existingFacilityAssignments: runProviders.facilityAssignments,
      }),
    [
      providerIds,
      groupId,
      facilityIds,
      runProviders.groupAssignments,
      runProviders.facilityAssignments,
    ],
  );

  if (providerIds.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">This run created no providers to assign.</p>
    );
  }

  const toggleFacility = (id: string) =>
    setFacilityIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));

  const nothingSelected = groupId === NONE && facilityIds.length === 0;

  const apply = () => {
    applyMut.mutate(
      {
        runId: run.id,
        groupId: groupId === NONE ? null : groupId,
        facilityIds,
        startDate,
        plan,
      },
      {
        onSuccess: (res) => {
          toast.success(
            `Assigned ${res.groupsAdded} group + ${res.facilitiesAdded} facility link(s); ${res.skippedProviders} provider(s) already assigned (kept their own).`,
          );
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Couldn't apply the batch assignment."),
      },
    );
  };

  return (
    <div className="space-y-4 rounded-md border border-[#E8E5E0] bg-white p-4">
      <div>
        <div className="text-[13px] font-medium text-foreground">Batch assignment</div>
        <p className="text-[12px] text-muted-foreground">
          Assign all {providerIds.length} of this run&apos;s providers to a group and facilities in
          one step. Providers that already carried their own group/facility columns keep them — the
          batch only fills the gaps, and running it again changes nothing.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="batch-group">Group</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger id="batch-group" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No batch group</SelectItem>
              {activeGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="batch-start-date">Assignment start date</Label>
          <DatePicker
            id="batch-start-date"
            value={startDate}
            onChange={setStartDate}
            ariaLabel="Batch assignment start date"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Facilities</Label>
        {activeFacilities.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No active facilities to assign.</p>
        ) : (
          <ul className="space-y-1">
            {activeFacilities.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <Checkbox
                  id={`batch-fac-${f.id}`}
                  checked={facilityIds.includes(f.id)}
                  onCheckedChange={() => toggleFacility(f.id)}
                />
                <Label htmlFor={`batch-fac-${f.id}`} className="text-[13px] font-normal">
                  {f.name}
                  {f.city || f.state ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {[f.city, f.state].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </Label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          className="h-9 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          disabled={nothingSelected || applyMut.isPending || (!startDate && facilityIds.length > 0)}
          onClick={apply}
        >
          {applyMut.isPending ? "Assigning…" : "Assign batch"}
        </Button>
        <span className="text-[12px] text-muted-foreground">
          {plan.groupInserts.length + plan.facilityInserts.length} new assignment
          {plan.groupInserts.length + plan.facilityInserts.length === 1 ? "" : "s"} will be created.
        </span>
      </div>
    </div>
  );
}
