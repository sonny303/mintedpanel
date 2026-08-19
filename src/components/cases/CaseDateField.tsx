// Editable case date on the Details card (Expected/Confirmed effective,
// Contract executed). Pencil → date picker → save; Clear sets the column
// null. Mirrors CaseFacilityField's inline edit pattern.
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/DatePicker";
import { fmtDate } from "@/lib/format";

export function CaseDateField({
  label,
  value,
  canEdit,
  saving,
  onSave,
}: {
  label: string;
  value: string | null;
  canEdit: boolean;
  saving: boolean;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (!editing) {
    return (
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="flex items-center justify-end gap-1.5 text-right font-medium">
          <span className="tabular-nums">{fmtDate(value)}</span>
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground"
              onClick={() => {
                setDraft(value ?? "");
                setEditing(true);
              }}
              aria-label={`Edit ${label.toLowerCase()}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </dd>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-1.5">
        <div className="w-40">
          <DatePicker value={draft} onChange={setDraft} ariaLabel={label} />
        </div>
        <Button
          size="sm"
          className="h-7 px-2"
          disabled={saving}
          onClick={async () => {
            await onSave(draft || null);
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
            setDraft(value ?? "");
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </dd>
    </div>
  );
}
