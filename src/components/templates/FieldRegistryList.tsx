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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { TokenPicker } from "@/components/templates/TokenPicker";
import {
  AUTHORABLE_TRANSFORMS,
  STRUCTURED_FIELD_TYPES,
  controlTypeLabel,
  hardcodedValueMissingFromOptions,
  parseControlOptions,
  transformEffectCopy,
  type ControlOption,
} from "@/lib/controlOptions";
import {
  classifyFieldMap,
  displayNameOf,
  groupRegistryRows,
  type FieldDecision,
  type RegistryRow,
} from "@/lib/fieldRegistry";
import type { TokenGroup } from "@/lib/tokenGroups";

/** The three decisions a trainer actually has (D2), plus the reversal, plus
 * E6.10 value-shaping on a token-mapped row. */
export type RegistryDecision =
  | { kind: "token"; token: string }
  | { kind: "fixed"; value: string }
  | { kind: "human" }
  | { kind: "unmap" }
  | { kind: "transform"; transform: string | null };

/** Literals `applyCheckbox` already treats as checked / unchecked. */
const CHECKBOX_BOOLEAN_OPTIONS: ControlOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

interface Props {
  rows: readonly RegistryRow[];
  /** Ids the latest real fill did not find on the page — rendered as stale, never deleted (D7). */
  staleIds?: ReadonlySet<string>;
  canEdit: boolean;
  groupedTokens: TokenGroup[];
  onDecide: (row: RegistryRow, decision: RegistryDecision) => void | Promise<void>;
  onRename: (row: RegistryRow, displayLabel: string | null) => void | Promise<void>;
  /** Rename the admin section for every row in a group (writes `section`). */
  onRenameSection: (rows: RegistryRow[], section: string | null) => void | Promise<void>;
  /** Set when the list renders inside a modal dialog — see TokenPicker's
   * `modal` prop, which is what actually keeps the options clickable there. */
  pickerModal?: boolean;
}

const PILL: Record<FieldDecision, { label: string; tone: StatusColor }> = {
  token: { label: "Mapped", tone: "green" },
  fixed: { label: "Fixed value", tone: "green" },
  human: { label: "Human fills this", tone: "neutral" },
  undecided: { label: "Needs a decision", tone: "amber" },
  stale: { label: "Not found in the latest fill", tone: "neutral" },
  invalid: { label: "Needs attention", tone: "red" },
};

export function FieldRegistryList({
  rows,
  staleIds = new Set(),
  canEdit,
  groupedTokens,
  onDecide,
  onRename,
  onRenameSection,
  pickerModal = false,
}: Props) {
  const sections = groupRegistryRows(rows, staleIds);
  if (sections.length === 0) return null;

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.name} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <SectionHeader
              name={section.name}
              rows={section.rows}
              canEdit={canEdit}
              onRenameSection={onRenameSection}
            />
            {/* Per-section progress: "Tax ID: 2 of 5 mapped" is the level a
                trainer actually works at — one aggregate count over 23 fields
                says nothing about which part of the form is unfinished. */}
            <p className="shrink-0 text-[11px] text-muted-foreground">
              {section.mapped} of {section.total} mapped in section
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
                pickerModal={pickerModal}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Inline rename for a section heading. Writes the admin `section` column on
 * every row in the group — the captured `form_section` / page step stay as
 * fallback evidence, mirroring field display_label vs field_label (D6/D7). */
function SectionHeader({
  name,
  rows,
  canEdit,
  onRenameSection,
}: {
  name: string;
  rows: RegistryRow[];
  canEdit: boolean;
  onRenameSection: Props["onRenameSection"];
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");

  // Evidence under a rename: the payer's captured heading, when it differs.
  const captured =
    rows
      .map((r) => r.formSection?.trim() || r.pageStep?.trim() || "")
      .find((s) => s !== "" && s !== name) ?? null;

  function startRename() {
    setDraftName(name);
    setRenaming(true);
  }

  function commitRename() {
    const next = draftName.trim();
    setRenaming(false);
    if (next === name) return;
    // Empty clears the admin section and falls back to the captured heading.
    void onRenameSection(rows, next === "" ? null : next);
  }

  if (renaming) {
    return (
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        <Input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          placeholder={captured ?? name}
          aria-label={`Rename section ${name}`}
          className="h-7 w-64 text-[12px]"
        />
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={commitRename}>
          <Check className="h-3.5 w-3.5" />
          <span className="sr-only">Save section name</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => setRenaming(false)}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Cancel section rename</span>
        </Button>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="flex items-center gap-1 text-[12px] font-medium">
        {name}
        {canEdit ? (
          <button
            type="button"
            onClick={startRename}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Rename section ${name}`}
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : null}
      </span>
      {captured ? (
        <span className="text-[11px] text-muted-foreground">Captured: {captured}</span>
      ) : null}
    </span>
  );
}

function RegistryRowEditor({
  row,
  stale,
  canEdit,
  groupedTokens,
  onDecide,
  onRename,
  pickerModal,
}: {
  row: RegistryRow;
  stale: boolean;
  canEdit: boolean;
  groupedTokens: TokenGroup[];
  onDecide: Props["onDecide"];
  onRename: Props["onRename"];
  pickerModal: boolean;
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
  const capturedOptions = parseControlOptions(row.controlOptions) ?? [];
  const isStructured = STRUCTURED_FIELD_TYPES.has(row.fieldType ?? "");
  const typeChip = controlTypeLabel(row.fieldType);
  const staleHardcoded = hardcodedValueMissingFromOptions(row.hardcodedValue, capturedOptions);
  const shapingCopy = transformEffectCopy(row.transform);
  const checkboxBoolean = (row.fieldType ?? "") === "checkbox" && capturedOptions.length === 0;
  const pickerOptions =
    capturedOptions.length > 0 ? capturedOptions : checkboxBoolean ? CHECKBOX_BOOLEAN_OPTIONS : [];

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
        <StatusPill status="neutral" label={typeChip} />
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
      {shapingCopy && classification.decision === "token" ? (
        <p className="text-[11px] text-muted-foreground">Shapes the value: {shapingCopy}</p>
      ) : null}
      {staleHardcoded ? (
        <p className="text-[11px] text-[#B91C1C]">
          Fixed value “{row.hardcodedValue}” is not in the captured options.
        </p>
      ) : null}
      {capturedOptions.length > 0 ? (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">
            {capturedOptions.length} option{capturedOptions.length === 1 ? "" : "s"} this control
            accepts
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {capturedOptions.map((opt) => (
              <li key={`${opt.value}:${opt.label}`}>
                {opt.value}
                {opt.label && opt.label !== opt.value ? ` — ${opt.label}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : isStructured ? (
        <p className="text-[11px] text-muted-foreground">
          No captured options — re-capture this page to read what the control accepts.
        </p>
      ) : null}

      {/* Stale rows keep their controls. Staleness is INFORMATION — the latest
          real fill did not find this field on the page — not a lock: a drifted
          mapping is repaired by re-pointing it right here, which is the whole
          E6.5 F6.5.4 repair path. Locking the row would leave a broken mapping
          with no way to fix it from the editor. */}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <TokenPicker
            aria-label={`Map ${name} to a token`}
            value={classification.decision === "token" ? (row.token ?? "") : ""}
            groupedTokens={groupedTokens}
            onValueChange={(token) => void onDecide(row, { kind: "token", token })}
            modal={pickerModal}
          />

          {pickerOptions.length > 0 ? (
            <Select
              value={row.hardcodedValue ?? undefined}
              onValueChange={(value) => void onDecide(row, { kind: "fixed", value })}
            >
              <SelectTrigger
                className="h-7 w-56 text-[12px]"
                aria-label={`Fixed value for ${name}`}
              >
                <SelectValue placeholder="Fixed value…" />
              </SelectTrigger>
              <SelectContent>
                {pickerOptions
                  .filter((opt) => opt.value !== "")
                  .map((opt) => (
                    <SelectItem key={`${opt.value}:${opt.label}`} value={opt.value}>
                      {opt.label && opt.label !== opt.value
                        ? `${opt.value} — ${opt.label}`
                        : opt.value}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : fixedOpen ? (
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

          {classification.decision === "token" ? (
            <select
              aria-label={`Value shaping for ${name}`}
              className="h-7 rounded-[4px] border border-[#E8E5E0] bg-white px-2 text-[12px]"
              value={row.transform ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                void onDecide(row, {
                  kind: "transform",
                  transform: next === "" ? null : next,
                });
              }}
            >
              <option value="">No shaping</option>
              <option value={AUTHORABLE_TRANSFORMS[0]}>State name → 2-letter code</option>
              <option value={AUTHORABLE_TRANSFORMS[1]}>Date → MM/DD/YYYY</option>
            </select>
          ) : null}

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
