// E4.0 F4.0.2 — the payer Reference/Tracking ID, surfaced prominently on the
// case header: copyable read-only display + an inline audited edit (pencil →
// input → save) available while the case is open. Saving through
// setPayerReference writes an audit_log row carrying the prior + new value.
// A non-blocking duplicate warning fires when the same ID sits on another case
// for the same org + payer (payers reuse/typo IDs; resubmissions share them) —
// save still proceeds.
//
// Slice E (handoff §2.7): the CASE DETAIL screen no longer feeds `siblings` —
// each submission mints a new ID per provider, so a collision is only ever a
// data-entry error and the design shows the clean state. The prop is optional
// and the warning stays intact for any future caller that has a real reason.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/CopyButton";

export interface TrackingIdSibling {
  caseId: string;
  label: string;
  reference: string;
}

export function TrackingIdField({
  value,
  canEdit,
  saving,
  siblings,
  onSave,
}: {
  value: string | null;
  canEdit: boolean;
  saving: boolean;
  /** Omitted on case detail — see the §2.7 note above. */
  siblings?: TrackingIdSibling[];
  onSave: (value: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const trimmed = draft.trim();
  const duplicates = trimmed ? (siblings ?? []).filter((s) => s.reference.trim() === trimmed) : [];

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          Tracking ID
        </span>
        <span className="text-[13px] font-medium tabular-nums">{value ?? "—"}</span>
        {value ? <CopyButton value={value} label="Tracking ID" /> : null}
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => {
              setDraft(value ?? "");
              setEditing(true);
            }}
            aria-label="Edit tracking ID"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          Tracking ID
        </span>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Reference / submission ID"
          className="h-7 w-48 text-[13px]"
        />
        <Button
          size="sm"
          className="h-7 px-2"
          disabled={saving}
          onClick={async () => {
            await onSave(trimmed ? trimmed : null);
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
      </div>
      {duplicates.length > 0 ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-2 text-[12px] text-[#92400E]">
          Also on{" "}
          {duplicates.map((d, i) => (
            <span key={d.caseId}>
              {i > 0 ? ", " : ""}
              <Link
                to="/cases/$id"
                params={{ id: d.caseId }}
                className="underline hover:no-underline"
              >
                {d.label}
              </Link>
            </span>
          ))}{" "}
          for this payer. You can still save.
        </div>
      ) : null}
    </div>
  );
}
