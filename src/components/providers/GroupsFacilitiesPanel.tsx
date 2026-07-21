// E6.4 F6.4.3 — groups & facilities managed IN PLACE on the record.
// Assignments are ordinary, editable data through the EXISTING services:
// group membership via the narrow setGroupAssignments (planAssignmentSync
// order, ≥1 group / one primary invariants), facility rows via setAssignments
// (full-set diff sync) + the atomic set_primary_assignment RPC. Nothing here
// rides the provider UPDATE — the old monolithic form's assignment-wipe
// defect is structurally impossible on this path.
// 2026-07-21 provider-detail redesign — renders its OWN RecordSectionCard
// ("Groups & facilities") with two labeled subsections, each carrying the
// shared "+ Add" affordance (handoff issues 1 & 7). The Make-primary / Remove
// row actions are kept (real capabilities the prototype's static "Edit" link
// only stood in for).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import { AddButton, RecordSectionCard } from "@/components/providers/RecordSectionCard";
import {
  useProviderAssignments,
  useProviderGroupAssignments,
  useSetAssignments,
  useSetGroupAssignments,
  useSetPrimaryAssignment,
} from "@/hooks/useProviders";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { facilitiesForProviderGroups, type AssignmentDraft } from "@/lib/assignmentScope";
import { LAST_ASSIGNMENT_MESSAGE } from "@/lib/groupAssignments";
import { fmtDate } from "@/lib/format";

const SUBHEADING = "text-[12px] font-semibold uppercase tracking-[0.05em] text-[#6B7280]";

export function GroupsFacilitiesPanel({
  providerId,
  canWrite,
}: {
  providerId: string;
  canWrite: boolean;
}) {
  const groupAssignQ = useProviderGroupAssignments();
  const facilityAssignQ = useProviderAssignments();
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilities();
  const setGroups = useSetGroupAssignments(providerId);
  const setFacilities = useSetAssignments(providerId);
  const setPrimary = useSetPrimaryAssignment();

  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [addingFacility, setAddingFacility] = useState(false);
  const [facilityDraft, setFacilityDraft] = useState("");
  const [startDraft, setStartDraft] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const myGroups = useMemo(
    () =>
      (groupAssignQ.data ?? [])
        .filter((a) => a.providerId === providerId && a.groupId)
        .map((a) => ({
          groupId: a.groupId as string,
          isPrimary: a.isPrimary,
          name: (groupsQ.data ?? []).find((g) => g.id === a.groupId)?.name ?? "—",
        }))
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    [groupAssignQ.data, groupsQ.data, providerId],
  );

  const myFacilities = useMemo(
    () =>
      (facilityAssignQ.data ?? [])
        .filter((a) => a.providerId === providerId)
        .map((a) => ({
          assignmentId: a.id,
          facilityId: a.facilityId as string,
          isPrimary: Boolean(a.isPrimary),
          startDate: a.startDate ?? null,
          name: (facilitiesQ.data ?? []).find((f) => f.id === a.facilityId)?.name ?? "—",
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [facilityAssignQ.data, facilitiesQ.data, providerId],
  );

  const addableGroups = useMemo(() => {
    const mine = new Set(myGroups.map((g) => g.groupId));
    return (groupsQ.data ?? []).filter((g) => g.isActive && !mine.has(g.id));
  }, [groupsQ.data, myGroups]);

  const addableFacilities = useMemo(() => {
    const mine = new Set(myFacilities.map((f) => f.facilityId));
    return facilitiesForProviderGroups(
      myGroups.map((g) => g.groupId),
      facilitiesQ.data ?? [],
    ).filter((f) => !mine.has(f.id));
  }, [facilitiesQ.data, myGroups, myFacilities]);

  const currentDrafts = (): AssignmentDraft[] =>
    myFacilities.map((f) => ({
      facilityId: f.facilityId,
      startDate: f.startDate ?? "",
      isPrimary: f.isPrimary,
    }));

  const addGroup = () => {
    if (!groupDraft) return;
    const next = [
      ...myGroups.map((g) => ({ groupId: g.groupId, isPrimary: g.isPrimary })),
      { groupId: groupDraft, isPrimary: myGroups.length === 0 },
    ];
    setGroups.mutate(next, {
      onSuccess: () => {
        toast.success("Group added.");
        setAddingGroup(false);
        setGroupDraft("");
      },
      onError: (e) => setDialogError(e instanceof Error ? e.message : "Could not add the group."),
    });
  };

  const removeGroup = (groupId: string) => {
    if (myGroups.length <= 1) {
      toast.error(LAST_ASSIGNMENT_MESSAGE);
      return;
    }
    const rest = myGroups.filter((g) => g.groupId !== groupId);
    const next = rest.map((g, i) => ({
      groupId: g.groupId,
      isPrimary: rest.some((r) => r.isPrimary) ? g.isPrimary : i === 0,
    }));
    setGroups.mutate(next, {
      onSuccess: () => toast.success("Group removed."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove the group."),
    });
  };

  const makePrimaryGroup = (groupId: string) => {
    setGroups.mutate(
      myGroups.map((g) => ({ groupId: g.groupId, isPrimary: g.groupId === groupId })),
      {
        onSuccess: () => toast.success("Primary group updated."),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update."),
      },
    );
  };

  const addFacility = () => {
    if (!facilityDraft) {
      setDialogError("Pick a facility.");
      return;
    }
    if (!startDraft) {
      setDialogError("A start date is required.");
      return;
    }
    const drafts = [
      ...currentDrafts(),
      { facilityId: facilityDraft, startDate: startDraft, isPrimary: myFacilities.length === 0 },
    ];
    setFacilities.mutate(drafts, {
      onSuccess: () => {
        toast.success("Facility added — the provider is generatable at this location.");
        setAddingFacility(false);
        setFacilityDraft("");
        setStartDraft("");
        setDialogError(null);
      },
      onError: (e) =>
        setDialogError(e instanceof Error ? e.message : "Could not add the facility."),
    });
  };

  const removeFacility = (facilityId: string) => {
    const rest = currentDrafts().filter((d) => d.facilityId !== facilityId);
    const next = rest.some((d) => d.isPrimary)
      ? rest
      : rest.map((d, i) => ({ ...d, isPrimary: i === 0 }));
    setFacilities.mutate(next, {
      onSuccess: () => toast.success("Facility removed."),
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Could not remove the facility."),
    });
  };

  return (
    <>
      <RecordSectionCard id="groups-facilities" title="Groups & facilities">
        <div className="space-y-5">
          <div>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className={SUBHEADING}>Group memberships</h3>
              {canWrite ? (
                <AddButton
                  label="Add group"
                  onClick={() => {
                    setDialogError(null);
                    setAddingGroup(true);
                  }}
                  disabled={addableGroups.length === 0}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {myGroups.map((g) => (
                <span
                  key={g.groupId}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#E8E5E0] px-2.5 py-1 text-[12.5px]"
                >
                  {g.isPrimary ? (
                    <Star
                      className="h-3 w-3 fill-[#1B4D3E] text-[#1B4D3E]"
                      aria-label="Primary group"
                    />
                  ) : null}
                  {g.name}
                  {canWrite && !g.isPrimary ? (
                    <>
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground underline hover:text-foreground"
                        onClick={() => makePrimaryGroup(g.groupId)}
                      >
                        Make primary
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-[#B91C1C]"
                        aria-label={`Remove group ${g.name}`}
                        onClick={() => removeGroup(g.groupId)}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                      </button>
                    </>
                  ) : null}
                </span>
              ))}
              {myGroups.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No group membership yet.</p>
              ) : null}
            </div>
          </div>

          <div className="border-t border-[#F0EEEA] pt-5">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className={SUBHEADING}>Facilities</h3>
              {canWrite ? (
                <AddButton
                  label="Add facility"
                  onClick={() => {
                    setDialogError(null);
                    setAddingFacility(true);
                  }}
                />
              ) : null}
            </div>
            {myFacilities.length === 0 ? (
              <p className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-2 text-[12.5px] text-[#92400E]">
                No facility assignment — this provider cannot generate cases until one is added.
              </p>
            ) : (
              <ul className="divide-y divide-[#F0EEE9] rounded-md border border-[#E8E5E0]">
                {myFacilities.map((f) => (
                  <li
                    key={f.assignmentId}
                    className="flex items-center gap-2 px-3 py-2 text-[13px]"
                  >
                    {f.isPrimary ? (
                      <Star
                        className="h-3.5 w-3.5 fill-[#1B4D3E] text-[#1B4D3E]"
                        aria-label="Primary location"
                      />
                    ) : (
                      <span className="w-3.5" aria-hidden />
                    )}
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted-foreground">
                      {f.startDate ? `starts ${fmtDate(f.startDate)}` : "no start date"}
                    </span>
                    {canWrite ? (
                      <span className="ml-auto inline-flex items-center gap-2">
                        {!f.isPrimary ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[12px]"
                            disabled={setPrimary.isPending}
                            onClick={() =>
                              setPrimary.mutate(
                                { providerId, assignmentId: f.assignmentId },
                                {
                                  onSuccess: () => toast.success("Primary location updated."),
                                  onError: (e) =>
                                    toast.error(
                                      e instanceof Error ? e.message : "Could not update.",
                                    ),
                                },
                              )
                            }
                          >
                            Make primary
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[12px]"
                          onClick={() => removeFacility(f.facilityId)}
                        >
                          Remove
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </RecordSectionCard>

      {addingGroup ? (
        <Dialog open onOpenChange={(o) => !o && setAddingGroup(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add group membership</DialogTitle>
              <DialogDescription>
                The one-primary rule holds through every path; the first membership becomes primary
                automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="add-group">Group</Label>
              <Select value={groupDraft} onValueChange={setGroupDraft}>
                <SelectTrigger id="add-group" aria-label="Group to add">
                  <SelectValue placeholder="Pick a group" />
                </SelectTrigger>
                <SelectContent>
                  {addableGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dialogError ? (
                <p role="alert" className="text-[12px] text-[#B91C1C]">
                  {dialogError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddingGroup(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#1B4D3E] hover:bg-[#163F33]"
                disabled={setGroups.isPending || !groupDraft}
                onClick={addGroup}
              >
                Add group
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {addingFacility ? (
        <Dialog open onOpenChange={(o) => !o && setAddingFacility(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add facility</DialogTitle>
              <DialogDescription>
                The picker offers facilities of this provider&apos;s groups. A start date is
                required; the new location is immediately visible to generation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-facility">Facility</Label>
                <Select value={facilityDraft} onValueChange={setFacilityDraft}>
                  <SelectTrigger id="add-facility" aria-label="Facility to add">
                    <SelectValue placeholder="Pick a facility" />
                  </SelectTrigger>
                  <SelectContent>
                    {addableFacilities.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <DatePicker value={startDraft} onChange={setStartDraft} ariaLabel="Start date" />
              </div>
              {dialogError ? (
                <p role="alert" className="text-[12px] text-[#B91C1C]">
                  {dialogError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddingFacility(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#1B4D3E] hover:bg-[#163F33]"
                disabled={setFacilities.isPending}
                onClick={addFacility}
              >
                Add facility
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
