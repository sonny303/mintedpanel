// MINT-74 — the payer's saved SOP drafts on its Templates tab, so a draft saved
// from "+ New template" can be found and resumed where it was started. Drafts
// are admin-only under RLS (sop_template_drafts policies); the tab mounts this
// group for admins only. Renders nothing until the payer has a draft.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteSopTemplateDraft, useSopTemplateDrafts } from "@/hooks/useSopTemplateDrafts";
import { errorMessage } from "@/lib/dbErrors";
import { fmtDateTime } from "@/lib/format";
import {
  draftResumeSearch,
  payerTemplateDraftRows,
  type PayerTemplateDraftRow,
} from "@/lib/payerDetailView";

export function PayerTemplateDrafts({ payerId }: { payerId: string }) {
  const draftsQ = useSopTemplateDrafts();
  const deleteMut = useDeleteSopTemplateDraft();
  const [discarding, setDiscarding] = useState<PayerTemplateDraftRow | null>(null);
  const rows = useMemo(
    () => payerTemplateDraftRows(draftsQ.data ?? [], payerId),
    [draftsQ.data, payerId],
  );

  if (draftsQ.isError) {
    return (
      <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
        Couldn&apos;t load saved drafts.{" "}
        <button type="button" className="underline" onClick={() => void draftsQ.refetch()}>
          Retry
        </button>
      </div>
    );
  }
  if (rows.length === 0) return null;

  async function confirmDiscard(row: PayerTemplateDraftRow) {
    try {
      await deleteMut.mutateAsync(row.id);
      setDiscarding(null);
      toast.success("Draft discarded");
    } catch (err) {
      toast.error(errorMessage(err, "Could not discard the draft"));
    }
  }

  return (
    <section
      aria-labelledby="payer-template-drafts-heading"
      className="rounded-[6px] border border-[#E8E5E0]"
    >
      <h3
        id="payer-template-drafts-heading"
        className="border-b border-[#E8E5E0] bg-[#FBFBF9] px-3 py-2 text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground"
      >
        Drafts
      </h3>
      <ul>
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#F0EEEA] px-3 py-1.5 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {row.name}
            </span>
            <span className="text-[12px] text-muted-foreground">
              Last saved {fmtDateTime(row.updatedAt)}
              {row.updatedByName ? ` by ${row.updatedByName}` : ""}
            </span>
            <div className="flex items-center gap-1">
              <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-[12px]">
                <Link
                  to="/admin/templates/new"
                  search={draftResumeSearch(payerId, row.id)}
                  aria-label={`Resume ${row.name}`}
                >
                  Resume
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-[12px] text-muted-foreground"
                aria-label={`Discard ${row.name}`}
                onClick={() => setDiscarding(row)}
              >
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {discarding ? (
        <Dialog open onOpenChange={(o) => !o && !deleteMut.isPending && setDiscarding(null)}>
          <DialogContent className="sm:max-w-md border-[#E8E5E0] shadow-none">
            <DialogHeader>
              <DialogTitle>Discard this draft?</DialogTitle>
              <DialogDescription>
                “{discarding.name}” was never published, so no case uses it. Discarding deletes the
                saved work for everyone in this organization. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDiscarding(null)}
                disabled={deleteMut.isPending}
              >
                Keep draft
              </Button>
              <Button
                variant="destructive"
                onClick={() => void confirmDiscard(discarding)}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? "Discarding…" : "Discard draft"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
