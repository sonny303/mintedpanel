// Payer & Cases design bundle, screen 3 Manage (Slice C) — the two lifecycle
// actions, on the E6.8 seams.
//
// §2.2 ARCHIVE-VERB COLLAPSE: the app used to carry two removal verbs — the
// E4.2 org-assignment archive ("Remove from my network",
// archive_org_payer_assignment) and the E6.8 payer archive (archived_at). With
// the seeded catalog gone the payer list IS the org's network, so both produced
// the same user-visible outcome. ONE verb ships here: Archive → archive_payer
// (reversible, nothing deleted, blocked while open cases exist). The
// assignment-archive service/hook stay in the tree per the additive rule; no UI
// calls them anymore.
//
// Both typed rejections are SURFACED, never swallowed into a generic toast:
// PayerArchiveBlockedError carries openCaseCount (rendered as the blocking
// count with a link to those cases, and the confirm stays disabled), and
// PayerMergeConflictError carries the conflicting C-<n> case list (rendered
// verbatim so the user knows exactly which cases collide on the 4-part key).
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useArchivePayer, useMergePayer, useReactivatePayer } from "@/hooks/useAdmin";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import { payerMergeCandidates } from "@/lib/payerDetailView";
import { useIsAdmin } from "@/lib/permissions";
import { PayerArchiveBlockedError, PayerMergeConflictError } from "@/services/payers";
import type { Payer } from "@/types";

function ArchiveDialog({ payer, onClose }: { payer: Payer; onClose: () => void }) {
  const archiveMut = useArchivePayer();
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleArchive = () => {
    setError(null);
    archiveMut.mutate(payer.id, {
      onSuccess: () => {
        toast.success(`${payer.name} archived`);
        onClose();
      },
      onError: (e) => {
        // The typed rejection carries the count — show it, and keep the
        // confirm disabled until those cases are closed or moved.
        if (e instanceof PayerArchiveBlockedError) {
          setBlockedCount(e.openCaseCount);
          setError(e.message);
          return;
        }
        setError(e instanceof Error ? e.message : "Couldn't archive the payer.");
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Archive {payer.name}</DialogTitle>
          <DialogDescription>
            Takes it out of daily work without deleting anything.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-[13px] text-muted-foreground">
          <li>· Hidden from Payer Setup — reachable via “Show archived”, reactivate any time</li>
          <li>· Templates and captured enrollment IDs are kept</li>
          <li>· No new cases can be created for it</li>
        </ul>
        {blockedCount != null ? (
          <p
            role="alert"
            className="rounded-[4px] border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]"
          >
            {blockedCount} open case{blockedCount === 1 ? "" : "s"} must be closed or moved first.{" "}
            <Link
              to="/cases"
              className="font-medium underline underline-offset-2"
              onClick={onClose}
            >
              View open cases
            </Link>
          </p>
        ) : error ? (
          <p
            role="alert"
            className="rounded-[4px] border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={archiveMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleArchive}
            disabled={archiveMut.isPending || blockedCount != null}
          >
            {archiveMut.isPending ? "Archiving…" : "Archive payer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({ payer, onClose }: { payer: Payer; onClose: () => void }) {
  const payersQ = useGlobalPayers();
  const mergeMut = useMergePayer();
  const [survivorId, setSurvivorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const candidates = useMemo(
    () => payerMergeCandidates(payersQ.data ?? [], payer.id),
    [payersQ.data, payer.id],
  );

  const handleMerge = () => {
    if (!survivorId) return;
    setError(null);
    setConflicts([]);
    mergeMut.mutate(
      { loserId: payer.id, survivorId },
      {
        onSuccess: (result) => {
          toast.success(
            `${payer.name} merged into ${result.survivor.name} — ${result.movedOpenCases} open case${
              result.movedOpenCases === 1 ? "" : "s"
            } and ${result.movedTemplates} template${
              result.movedTemplates === 1 ? "" : "s"
            } moved.`,
          );
          onClose();
        },
        onError: (e) => {
          // The typed conflict names the colliding cases (4-part case key) —
          // render the list so the user can go close or move exactly those.
          if (e instanceof PayerMergeConflictError) {
            setConflicts(e.conflictingCases);
            setError(e.message);
            return;
          }
          setError(e instanceof Error ? e.message : "Couldn't merge the payer.");
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Merge {payer.name}</DialogTitle>
          <DialogDescription>
            For duplicates or acquisitions — everything moves to the surviving payer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="merge-survivor">Merge into</Label>
          <Select value={survivorId} onValueChange={setSurvivorId}>
            <SelectTrigger id="merge-survivor" className="h-9" aria-label="Surviving payer">
              <SelectValue placeholder="Choose the surviving payer…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="space-y-1.5 text-[13px] text-muted-foreground">
          <li>· Templates, portals, and captured IDs move to the survivor</li>
          <li>· Open cases repoint to the survivor</li>
          <li>· “{payer.name}” becomes an alias on the survivor, so search still finds it</li>
        </ul>
        <p className="text-[12.5px] text-[#B45309]">This can&apos;t be undone from the app.</p>
        {error ? (
          <div
            role="alert"
            className="space-y-1.5 rounded-[4px] border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]"
          >
            <p>{error}</p>
            {conflicts.length > 0 ? (
              <p className="font-mono text-[12px]">{conflicts.join(" · ")}</p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mergeMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleMerge}
            disabled={mergeMut.isPending || survivorId === ""}
          >
            {mergeMut.isPending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionRow({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[#F0EEEA] px-5 py-4 first:border-t-0">
      <div className="min-w-[240px] flex-1">
        <div className="text-[14px] font-semibold text-foreground">{title}</div>
        <p className="text-[12.5px] text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function PayerManageTab({ payer }: { payer: Payer }) {
  const isAdmin = useIsAdmin();
  const reactivateMut = useReactivatePayer();
  const [dialog, setDialog] = useState<"archive" | "merge" | null>(null);

  const handleReactivate = () => {
    reactivateMut.mutate(payer.id, {
      onSuccess: () => toast.success(`${payer.name} reactivated`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reactivate the payer"),
    });
  };

  if (!isAdmin) {
    return (
      <section className="rounded-[6px] border border-[#E8E5E0] bg-white px-5 py-10 text-center">
        <div className="text-[14px] font-semibold text-foreground">Managed by an admin</div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Archiving and merging a payer changes it for every organization, so both are admin
          actions.
        </p>
      </section>
    );
  }

  const archived = payer.archivedAt != null;

  return (
    <>
      <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
        <div className="border-b border-[#E8E5E0] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-foreground">Manage payer</h2>
        </div>
        {archived ? (
          <ActionRow
            title="Reactivate"
            body="Bring it back into daily work — scope, templates, and captured IDs are untouched."
            action={
              <Button
                className="flex-none bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                disabled={reactivateMut.isPending}
                onClick={handleReactivate}
              >
                {reactivateMut.isPending ? "Reactivating…" : "Reactivate payer"}
              </Button>
            }
          />
        ) : (
          <ActionRow
            title="Archive"
            body="Take it out of daily work — hidden from Payer Setup, reactivable, nothing deleted. Blocked while open cases exist."
            action={
              <Button variant="outline" className="flex-none" onClick={() => setDialog("archive")}>
                Archive payer
              </Button>
            }
          />
        )}
        <ActionRow
          title="Merge into another payer"
          body="For duplicates or acquisitions — templates, IDs, and open cases move to the survivor; this name becomes an alias."
          action={
            <Button variant="outline" className="flex-none" onClick={() => setDialog("merge")}>
              Merge payer
            </Button>
          }
        />
      </section>

      {dialog === "archive" ? (
        <ArchiveDialog payer={payer} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "merge" ? <MergeDialog payer={payer} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
