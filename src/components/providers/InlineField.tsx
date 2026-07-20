// E6.4 F6.4.2 — the record's inline field editor: pencil → change → save,
// one field per write (the audited updateProvider patch), inline validation
// under the field, blast radius = exactly the field you opened. `masked`
// renders the value hidden at rest and reveals it only while editing (the
// DOB rule). Composed from approved primitives only (Input + Button +
// StateSelect); logged in DESIGN-DEBT.md.
import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateSelect } from "@/components/StateSelect";

export interface InlineFieldProps {
  label: string;
  /** Raw stored value (ISO date / bare string), null when unset. */
  value: string | null;
  /** Display formatter for the at-rest view; defaults to the raw value. */
  display?: (value: string | null) => string;
  type?: "text" | "date" | "state";
  canWrite: boolean;
  /** Returns an error message, or null when valid. Runs on save. */
  validate?: (value: string) => string | null;
  /** Persist the new value (trimmed; empty string saves as null). */
  onSave: (value: string | null) => Promise<void>;
  /** Hide the value at rest, reveal only while editing (DOB). */
  masked?: boolean;
}

export function InlineField({
  label,
  value,
  display,
  type = "text",
  canWrite,
  validate,
  onSave,
  masked = false,
}: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const atRest = masked ? (value ? "••••••••" : "—") : display ? display(value) : (value ?? "—");

  const startEdit = () => {
    setDraft(value ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (validate && trimmed !== "") {
      const message = validate(trimmed);
      if (message) {
        setError(message);
        return;
      }
    }
    setSaving(true);
    try {
      await onSave(trimmed === "" ? null : trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-muted-foreground">{label}</p>
        {editing ? (
          <div className="mt-1 space-y-1">
            <div className="flex items-center gap-1.5">
              {type === "state" ? (
                <StateSelect
                  value={draft}
                  onChange={(v) => {
                    setDraft(v);
                    setError(null);
                  }}
                  className="h-8 text-[13px]"
                />
              ) : (
                <Input
                  autoFocus
                  type={type === "date" ? "date" : "text"}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  className="h-8 text-[13px]"
                  aria-label={`${label} value`}
                />
              )}
              <Button
                size="sm"
                className="h-8 bg-[#1B4D3E] px-2 text-white hover:bg-[#163F33]"
                disabled={saving}
                onClick={() => void save()}
                aria-label={`Save ${label}`}
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                disabled={saving}
                onClick={() => setEditing(false)}
                aria-label={`Cancel editing ${label}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-[12px] text-[#B91C1C]">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="truncate text-[13px] text-foreground">{atRest}</p>
        )}
      </div>
      {canWrite && !editing ? (
        <button
          type="button"
          onClick={startEdit}
          className="mt-4 rounded p-1 text-muted-foreground hover:bg-[#F0EEE9] hover:text-foreground"
          aria-label={`Edit ${label}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
