// Editable case facility on the Details card. Options are the provider's
// assigned locations under the case's group (same set the create-time stamp
// resolves from). Pencil → select → save; Clear sets facility_id null.
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { facilityAddressLine } from "@/lib/caseDetailView";
import type { Facility } from "@/types";

const NONE = "__none__";

export function CaseFacilityField({
  facility,
  options,
  canEdit,
  saving,
  onSave,
}: {
  facility: Facility | null | undefined;
  options: Facility[];
  canEdit: boolean;
  saving: boolean;
  onSave: (facilityId: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(facility?.id ?? NONE);

  const address = facility ? facilityAddressLine(facility) : null;

  if (!editing) {
    return (
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">Facility</dt>
        <dd className="flex items-start justify-end gap-1.5 text-right font-medium">
          <span className="block">
            {facility ? (
              <>
                {facility.name}
                {address ? (
                  <span className="mt-0.5 block text-[11.5px] font-normal text-muted-foreground">
                    {address}
                  </span>
                ) : null}
              </>
            ) : (
              "—"
            )}
          </span>
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground"
              onClick={() => {
                setDraft(facility?.id ?? NONE);
                setEditing(true);
              }}
              aria-label="Edit facility"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </dd>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted-foreground">Facility</dt>
        <dd className="flex flex-wrap items-center justify-end gap-1.5">
          <Select value={draft} onValueChange={setDraft}>
            <SelectTrigger className="h-7 w-52 text-[13px]" aria-label="Case facility">
              <SelectValue placeholder="Select a facility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {options.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                  {!f.isActive ? " (inactive)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-7 px-2"
            disabled={saving}
            onClick={async () => {
              await onSave(draft === NONE ? null : draft);
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={saving}
            onClick={() => {
              setDraft(facility?.id ?? NONE);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </dd>
      </div>
      {options.length === 0 ? (
        <p className="text-right text-[11.5px] text-muted-foreground">
          No locations assigned under this group.
        </p>
      ) : null}
    </div>
  );
}
