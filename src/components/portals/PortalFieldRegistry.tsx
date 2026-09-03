// The field-mapping block: add a field, decide every captured row, see when
// the queue is empty. Mounted by BOTH hosts of the same job — the Template
// Editor's Form setup step (authoring) and the payer Portals drawer
// (maintenance) — over one `useFieldRegistryEditor` instance, so a decision
// means the same thing and writes the same row wherever it is made.
//
// Presentation only: every write lives in the hook, and the host decides
// whether it is mounted at all (there must be a registered portal).
import { useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldRegistryList } from "@/components/templates/FieldRegistryList";
import type { FieldRegistryEditor } from "@/hooks/useFieldRegistryEditor";
import type { RegistryRow } from "@/lib/fieldRegistry";

export interface PortalFieldRegistryProps {
  editor: FieldRegistryEditor;
  canEdit: boolean;
  /** Shown instead of the list when the portal has no captured fields yet. */
  emptyState?: ReactNode;
  /** Set by a modal-dialog host so the token picker stays clickable there. */
  pickerModal?: boolean;
}

export function PortalFieldRegistry({
  editor,
  canEdit,
  emptyState,
  pickerModal = false,
}: PortalFieldRegistryProps) {
  const [addFieldLabel, setAddFieldLabel] = useState("");

  async function submitField() {
    if (await editor.addField(addFieldLabel)) setAddFieldLabel("");
  }

  return (
    <>
      {canEdit ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={addFieldLabel}
            onChange={(e) => setAddFieldLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitField();
            }}
            placeholder="Add a field by name…"
            aria-label="Add a field to the registry"
            className="h-7 w-64 text-[12px]"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px]"
            disabled={addFieldLabel.trim() === ""}
            onClick={() => void submitField()}
          >
            Add field
          </Button>
        </div>
      ) : null}

      {/* E6.9 F6.9.3: EVERY row, always — decided rows included. The old queue
          dropped a field the moment it was approved, so a wrong mapping was
          unreachable. */}
      {editor.rows.length > 0 ? (
        <FieldRegistryList
          rows={editor.rows as RegistryRow[]}
          staleIds={editor.staleIds}
          canEdit={canEdit}
          groupedTokens={editor.groupedTokens}
          onDecide={editor.decide}
          onRename={editor.rename}
          onRenameSection={editor.renameSection}
          pickerModal={pickerModal}
        />
      ) : (
        (emptyState ?? null)
      )}

      {editor.rows.length > 0 && editor.coverage.needsDecision === 0 ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#1B4D3E]" />
          Every captured field has a decision.
        </p>
      ) : null}
    </>
  );
}
