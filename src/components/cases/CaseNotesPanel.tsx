// Internal notes card on the case detail page with an inline add form.
// The mutation hook lives in the parent route (onSaveNote/saving).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { fmtDateTime } from "@/lib/format";
import { Plus, User } from "lucide-react";
import type { Note } from "@/types";

export function CaseNotesPanel({
  notes,
  canEdit,
  saving,
  onSaveNote,
}: {
  notes: Note[];
  canEdit: boolean;
  saving: boolean;
  onSaveNote: (content: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
        <CardTitle className="text-[14px] font-semibold">Internal Notes</CardTitle>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {open && canEdit ? (
          <AddNoteForm
            onCancel={() => setOpen(false)}
            onSave={async (content) => {
              await onSaveNote(content);
              setOpen(false);
            }}
            saving={saving}
          />
        ) : null}
        {notes.length === 0 ? (
          <div className="p-6">
            <EmptyState message="No notes yet" />
          </div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="bg-muted/30 p-3 rounded-md border border-border">
              <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
                {n.content}
              </p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-medium inline-flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {n.authorName ?? "—"}
                </span>
                <span className="tabular-nums">{fmtDateTime(n.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AddNoteForm({
  onCancel,
  onSave,
  saving,
}: {
  onCancel: () => void;
  onSave: (content: string) => void;
  saving: boolean;
}) {
  const [content, setContent] = useState("");
  return (
    <div className="space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add an internal note..."
        className="min-h-[80px] text-[13px] resize-none"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving || !content.trim()}
          onClick={() => onSave(content.trim())}
        >
          {saving ? "Saving…" : "Save note"}
        </Button>
      </div>
    </div>
  );
}
