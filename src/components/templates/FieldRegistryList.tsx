// E6.9 F6.9.3–F6.9.5 — the unified field registry.
//
// Replaces the panel's train-queue, which listed ONLY broken + proposed rows:
// the moment a field was approved it dropped out of the UI entirely and
// collapsed into a static "4 mapped · 19 to train" line, so a wrong mapping
// could only be found by running a fill and watching it put the wrong value in
// the box. Every row now stays visible, keeps its position, and stays editable.
//
// Ordering is `sort_order` (capture-derived) inside sections — a decision NEVER
// moves a row (F6.9.5), which is what makes the list stable enough to work
// down. Renames write `display_label` and never touch the payer's raw
// `field_label`, so a re-capture can refresh what the page says without
// clobbering the admin's naming (D6/D7).

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import {
  classifyFieldMap,
  displayNameOf,
  groupRegistryRows,
  type FieldDecision,
  type RegistryRow,
} from "@/lib/fieldRegistry";
import type { TokenGroup } from "@/lib/tokenGroups";

/** The three decisions a trainer actually has (D2), plus the reversal. */
export type RegistryDecision =
  | { kind: "token"; token: string }
  | { kind: "fixed"; value: string }
  | { kind: "human" }
  | { kind: "unmap" };

interface Props {
  rows: readonly RegistryRow[];
  /** Ids the latest capture did not see — rendered as stale, never deleted (D7). */
  staleIds?: ReadonlySet<string>;
  canEdit: boolean;
  groupedTokens: TokenGroup[];
  onDecide: (row: RegistryRow, decision: RegistryDecision) => void | Promise<void>;
  onRename: (row: RegistryRow, displayLabel: string | null) => void | Promise<void>;
}

const PILL: Record<FieldDecision, { label: string; tone: StatusColor }> = {
  token: { label: "Mapped", tone: "green" },
  fixed: { label: "Fixed value", tone: "green" },
  human: { label: "Human fills this", tone: "neutral" },
  undecided: { label: "Needs a decision", tone: "amber" },
  stale: { label: "Not on the form", tone: "neutral" },
  invalid: { label: "Needs attention", tone: "red" },
};

export function FieldRegistryList({
  rows,
  staleIds = new Set(),
  canEdit,
  groupedTokens,
  onDecide,
  onRename,
}: Props) {
  const sections = groupRegistryRows(rows, staleIds);
  if (sections.length === 0) return null;

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.name} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-medium">{section.name}</p>
            {/* Per-section progress: "Tax ID: 2 of 5 mapped" is the level a
                trainer actually works at — one aggregate count over 23 fields
                says nothing about which part of the form is unfinished. */}
            <p className="text-[11px] text-muted-foreground">
              {section.mapped} of {section.total} mapped
            </p>
          </div>
          <div className="divide-y divide-[#E8E5E0] rounded-md border border-[#E8E5E0]">
            {section.rows.map((row) => (
              <RegistryRowEditor
                key={row.id}
                row={row}
                stale={staleIds.has(row.id)}
                canEdit={canEdit}
                groupedTokens={groupedTokens}
                onDecide={onDecide}
                onRename={onRename}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RegistryRowEditor({
  row,
  stale,
  canEdit,
  groupedTokens,
  onDecide,
  onRename,
}: {
  row: RegistryRow;
  stale: boolean;
  canEdit: boolean;
  groupedTokens: TokenGroup[];
  onDecide: Props["onDecide"];
  onRename: Props["onRename"];
}) {
  const classification = classifyFieldMap(row, { stale });
  const pill = PILL[classification.decision];
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [fixedOpen, setFixedOpen] = useState(false);
  const [fixedDraft, setFixedDraft] = useState("");

  const name = displayNameOf(row);
  // Only worth showing when it differs — otherwise it is the same string twice.
  const rawLabel = row.fieldLabel?.trim();
  const showRaw = Boolean(rawLabel) && rawLabel !== name;

  function startRename() {
    setDraftName(row.displayLabel?.trim() ?? "");
    setRenaming(true);
  }

  function commitRename() {
    const next = draftName.trim();
    setRenaming(false);
    // Empty clears the rename and falls back to the captured label, rather than
    // storing a blank name.
    void onRename(row, next === "" ? null : next);
  }

  function commitFixed() {
    const value = fixedDraft.trim();
    if (!value) return;
    setFixedOpen(false);
    setFixedDraft("");
    void onDecide(row, { kind: "fixed", value });
  }

  return (
    <div className="space-y-1.5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {renaming ? (
          <span className="flex items-center gap-1">
            <Input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              placeholder={rawLabel ?? row.selector}
              aria-label={`Rename ${name}`}
              className="h-7 w-56 text-[12px]"
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={commitRename}>
              <Check className="h-3.5 w-3.5" />
              <span className="sr-only">Save name</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setRenaming(false)}
            >
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">Cancel rename</span>
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[12px] font-medium">
            {name}
            {canEdit ? (
              <button
                type="button"
                onClick={startRename}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Rename ${name}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        )}
        <StatusPill status={pill.tone} label={pill.label} />
        {row.section == null && row.formSection ? (
          <span className="text-[11px] text-muted-foreground">from “{row.formSection}”</span>
        ) : null}
      </div>

      {/* The payer's own words, kept underneath a rename as evidence — this is
          what makes a rename safe to make and easy to audit. */}
      {showRaw ? (
        <p className="text-[11px] text-muted-foreground">Payer’s label: {rawLabel}</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{classification.reason}</p>

      {/* Stale rows keep their controls. Staleness is INFORMATION — the last
          capture or fill did not see this field — not a lock: a drifted
          mapping is repaired by re-pointing it right here, which is the whole
          E6.5 F6.5.4 repair path. Locking the row would leave a broken mapping
          with no way to fix it from the editor. */}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Select
            value={classification.decision === "token" ? (row.token ?? "") : ""}
            onValueChange={(token) => void onDecide(row, { kind: "token", token })}
          >
            <SelectTrigger className="h-7 w-56 text-[12px]" aria-label={`Map ${name} to a token`}>
              <SelectValue placeholder="Map a token…" />
            </SelectTrigger>
            <SelectContent>
              {groupedTokens.map((group) => (
                <SelectGroup key={group.prefix}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((token) => (
                    <SelectItem key={token.token} value={token.token}>
                      {token.token}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          {fixedOpen ? (
            <span className="flex items-center gap-1">
              <Input
                autoFocus
                value={fixedDraft}
                onChange={(e) => setFixedDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitFixed();
                  if (e.key === "Escape") setFixedOpen(false);
                }}
                placeholder="Value to type every time"
                aria-label={`Fixed value for ${name}`}
                className="h-7 w-56 text-[12px]"
              />
              <Button
                size="sm"
                className="h-7 bg-[#1B4D3E] hover:bg-[#163F33]"
                disabled={fixedDraft.trim() === ""}
                onClick={commitFixed}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setFixedOpen(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[12px]"
              onClick={() => {
                setFixedDraft(row.hardcodedValue ?? "");
                setFixedOpen(true);
              }}
            >
              Fixed value…
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={classification.decision === "human"}
            onClick={() => void onDecide(row, { kind: "human" })}
          >
            Human fills this
          </Button>

          {/* Reversible at any time — the registry is a working surface, not a
              one-way queue. */}
          {classification.decision !== "undecided" ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[12px]"
              onClick={() => void onDecide(row, { kind: "unmap" })}
            >
              Unmap
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
