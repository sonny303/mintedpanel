// E1.3 (Track B PR 4/4) — the Details card's Locations section, replacing the
// old single-value Facility row (CaseFacilityField, retired). Lists every
// `case_facilities` row on the case (joined to its facility for display),
// badges the primary one, and — for a writer — offers Add / Remove / Make
// primary. `facilityOptions` is the SAME provider×group eligible-facility set
// the route already computes for the old single-facility editor
// (`caseFacilityOptions`); this component just filters out ids already
// attached to get the add picker's candidate list.
//
// Mirrors this card's existing inline-edit conventions (canEdit gate, a
// single `saving` flag disabling every control while any of the three
// mutations is in flight, the exact "No locations assigned under this group."
// empty-state copy CaseFacilityField used) plus the Remove-confirm Dialog
// pattern PayerFormActionRow already established in this same component
// family — a destructive action here gets a confirm, not a bare click.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddButton } from "@/components/providers/RecordSectionCard";
import { StatusPill } from "@/components/StatusPill";
import { facilityAddressLine } from "@/lib/caseDetailView";
import type { CaseFacilityWithDetail, Facility } from "@/types";

export function CaseLocationsSection({
  locations,
  loading,
  facilityOptions,
  canEdit,
  saving,
  onAdd,
  onRemove,
  onMakePrimary,
}: {
  locations: CaseFacilityWithDetail[];
  /** True while the case's location list is still on its first fetch — a
   * separate query from the case detail, so it can trail the rest of the
   * card in on a fast connection. */
  loading?: boolean;
  /** The provider's eligible active locations under the case's group — same
   * set the old single-facility editor offered. */
  facilityOptions: Facility[];
  canEdit: boolean;
  /** True while any of add/remove/make-primary is in flight — disables every
   * control on the card, the same posture the date/facility fields use for
   * their one mutation each. */
  saving: boolean;
  onAdd: (facilityId: string) => Promise<void>;
  onRemove: (facilityId: string) => Promise<void>;
  onMakePrimary: (facilityId: string) => Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const attachedIds = new Set(locations.map((l) => l.facilityId));
  const addable = facilityOptions.filter((f) => !attachedIds.has(f.id));
  const removing = locations.find((l) => l.facilityId === confirmRemoveId) ?? null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted-foreground">Locations</dt>
        {canEdit ? (
          <AddButton
            label="Add location"
            className="h-7 px-2 text-[12px]"
            disabled={saving || addable.length === 0}
            onClick={() => {
              setAddDraft("");
              setAddOpen(true);
            }}
          />
        ) : null}
      </div>
      <dd>
        {loading && locations.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">
            No locations assigned under this group.
          </p>
        ) : (
          <ul className="space-y-2">
            {locations.map((loc) => {
              const address = facilityAddressLine(loc.facility);
              return (
                <li key={loc.id} className="rounded-md border border-border p-2">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium">
                    <span>{loc.facility.name}</span>
                    {loc.isPrimary ? <StatusPill status="brand" label="Primary" /> : null}
                    {!loc.facility.isActive ? (
                      <span className="text-[11px] font-normal text-muted-foreground">
                        (inactive)
                      </span>
                    ) : null}
                  </div>
                  {address ? (
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">{address}</p>
                  ) : null}
                  {canEdit ? (
                    <div className="mt-1.5 flex items-center gap-3 text-[12px]">
                      {!loc.isPrimary ? (
                        <button
                          type="button"
                          className="text-muted-foreground underline hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                          disabled={saving}
                          onClick={() => {
                            onMakePrimary(loc.facilityId).catch(() => undefined);
                          }}
                        >
                          Make primary
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="text-muted-foreground underline hover:text-[#B91C1C] disabled:pointer-events-none disabled:opacity-50"
                        disabled={saving}
                        onClick={() => setConfirmRemoveId(loc.facilityId)}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </dd>

      {addOpen ? (
        <Dialog open onOpenChange={(o) => !o && setAddOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add location</DialogTitle>
              <DialogDescription>
                The picker offers this provider&apos;s locations under the case&apos;s group that
                aren&apos;t already on this case. The case&apos;s first location becomes primary
                automatically.
              </DialogDescription>
            </DialogHeader>
            <Select value={addDraft} onValueChange={setAddDraft}>
              <SelectTrigger aria-label="Location to add">
                <SelectValue placeholder="Pick a location" />
              </SelectTrigger>
              <SelectContent>
                {addable.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                    {!f.isActive ? " (inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                disabled={saving || !addDraft}
                onClick={() => {
                  onAdd(addDraft)
                    .then(() => {
                      setAddOpen(false);
                      setAddDraft("");
                    })
                    .catch(() => undefined);
                }}
              >
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Add location
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {removing ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmRemoveId(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove this location?</DialogTitle>
              <DialogDescription>
                {removing.isPrimary
                  ? `"${removing.facility.name}" comes off this case. It's the primary location — another remaining location is promoted automatically.`
                  : `"${removing.facility.name}" comes off this case.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRemoveId(null)} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => {
                  onRemove(removing.facilityId)
                    .then(() => setConfirmRemoveId(null))
                    .catch(() => undefined);
                }}
              >
                {saving ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
