// New Launch / edit-launch modal (launch PRD v2.1). Creating a launch creates
// a facilities row in a location-track status (default Prospect) with an
// optional effective date and an optional provider assignment. Editing covers
// the same fields; the date label follows the status (Target early in the
// pipeline, Starts once fulfillment begins). Transitions are soft: moving to
// Ready for Launch without a provider or to Live with zero linked cases
// warns but never blocks, and a first launch in a new state gets an inline
// payer-contracts note.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateLaunchLocation,
  useFacilityAssignments,
  useLaunchLocations,
  useUpdateLaunchLocation,
} from "@/hooks/useLaunches";
import { useCases } from "@/hooks/useCases";
import { useProviders } from "@/hooks/useProviders";
import { useProviderGroups } from "@/hooks/useLookups";
import { useStatusConfigs } from "@/hooks/useAdmin";
import { US_STATES } from "@/components/providers/providerFormShared";
import {
  isNewStateLaunch,
  launchDateFieldLabel,
  transitionWarnings,
  type LocationRow,
} from "@/lib/launchLocations";
import { PROSPECT_LABEL } from "@/lib/statusLabels";
import type { Facility } from "@/types";

const NONE = "__none__";

export function LaunchEditModal({
  location,
  onClose,
}: {
  /** null = create a new launch */
  location: Facility | null;
  onClose: () => void;
}) {
  const groupsQ = useProviderGroups();
  const providersQ = useProviders();
  const statusesQ = useStatusConfigs("location");
  const locationsQ = useLaunchLocations();
  const assignmentsQ = useFacilityAssignments();
  const casesQ = useCases();

  const statuses = useMemo(
    () => [...(statusesQ.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [statusesQ.data],
  );
  const defaultStatusId =
    location?.statusId ??
    statuses.find((s) => s.label === PROSPECT_LABEL)?.id ??
    statuses[0]?.id ??
    "";

  const [name, setName] = useState(location?.name ?? "");
  const [street, setStreet] = useState(location?.street ?? "");
  const [city, setCity] = useState(location?.city ?? "");
  const [state, setState] = useState<string>(location?.state ?? NONE);
  const [groupId, setGroupId] = useState<string>(
    location?.groupId ?? (groupsQ.data?.length === 1 ? groupsQ.data[0].id : NONE),
  );
  const [statusChoice, setStatusChoice] = useState<string>("");
  // Status configs may still be loading when the modal mounts; fall back to
  // the default until the user picks one.
  const statusId = statusChoice || defaultStatusId;
  const [effectiveDate, setEffectiveDate] = useState(location?.effectiveDate ?? "");
  const [providerId, setProviderId] = useState<string>(NONE);
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateLaunchLocation();
  const updateMut = useUpdateLaunchLocation();
  const pending = createMut.isPending || updateMut.isPending;

  const selectedStatusLabel = statuses.find((s) => s.id === statusId)?.label ?? "";
  const dateLabel = launchDateFieldLabel(selectedStatusLabel);

  // Soft transition checks (warn, never block) — only when the status moves.
  const warnings = useMemo(() => {
    if (!selectedStatusLabel || statusId === location?.statusId) return [];
    const hasProvider = location
      ? (assignmentsQ.data ?? []).some((a) => a.facilityId === location.id && a.providerId)
      : providerId !== NONE;
    const linkedCaseCount = location
      ? (casesQ.data ?? []).filter((c) => c.facilityId === location.id).length
      : 0;
    return transitionWarnings({
      toStatusLabel: selectedStatusLabel,
      hasProvider,
      linkedCaseCount,
    });
  }, [selectedStatusLabel, statusId, location, assignmentsQ.data, casesQ.data, providerId]);

  // First location in this state for the group: payer contracts may not exist.
  const newStateNote = useMemo(() => {
    if (state === NONE || groupId === NONE) return false;
    const statusById = new Map(statuses.map((s) => [s.id, s]));
    const rows: LocationRow[] = (locationsQ.data ?? []).map((facility) => ({
      facility,
      status: facility.statusId ? (statusById.get(facility.statusId) ?? null) : null,
    }));
    const candidate: Facility = {
      ...(location ?? {
        id: "__new__",
        orgId: "",
        name: "",
        street: null,
        city: null,
        zip: null,
        isActive: true,
        statusId: null,
        effectiveDate: null,
        referenceOnly: false,
        createdAt: "",
      }),
      groupId,
      state,
    };
    return isNewStateLaunch(candidate, rows);
  }, [state, groupId, statuses, locationsQ.data, location]);

  const handleSave = () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (state === NONE) {
      setError("State is required");
      return;
    }
    if (groupId === NONE) {
      setError("Group is required");
      return;
    }
    if (!statusId) {
      setError("Status is required");
      return;
    }
    const onErr = (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    };
    if (location) {
      updateMut.mutate(
        {
          id: location.id,
          patch: {
            name: name.trim(),
            street: street.trim() || null,
            city: city.trim() || null,
            state,
            groupId,
            statusId,
            effectiveDate: effectiveDate || null,
          },
        },
        {
          onSuccess: () => {
            toast.success("Launch updated");
            onClose();
          },
          onError: onErr,
        },
      );
    } else {
      createMut.mutate(
        {
          name: name.trim(),
          street: street.trim() || null,
          city: city.trim() || null,
          state,
          groupId,
          statusId,
          effectiveDate: effectiveDate || null,
          providerId: providerId === NONE ? null : providerId,
        },
        {
          onSuccess: () => {
            toast.success("Launch created");
            onClose();
          },
          onError: onErr,
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{location ? "Edit launch" : "New Launch"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[12px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-[12px]">Address</Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-[12px]">State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-[12px]">Group</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Select group…</SelectItem>
                {(groupsQ.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    <span className="truncate block max-w-[360px]">{g.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">Status</Label>
              <Select value={statusId} onValueChange={setStatusChoice}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">{dateLabel} (optional)</Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          {!location ? (
            <div>
              <Label className="text-[12px]">Provider (optional)</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No provider yet</SelectItem>
                  {(providersQ.data ?? [])
                    .filter((p) => p.status !== "terminated")
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {newStateNote ? (
            <div className="text-[12px] text-[#92400E] border border-[#FDE68A] bg-[#FEF3C7] rounded-md px-3 py-2">
              First launch in {state} for this group — payer contracts for this state may not exist
              yet.
            </div>
          ) : null}
          {warnings.map((w) => (
            <div
              key={w}
              className="text-[12px] text-[#92400E] border border-[#FDE68A] bg-[#FEF3C7] rounded-md px-3 py-2"
            >
              {w} You can still save.
            </div>
          ))}
          {error ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? "Saving…" : location ? "Save changes" : "Create launch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
