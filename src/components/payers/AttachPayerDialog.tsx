// E1.5 F1.5.1/F1.5.2 attach flow. Phase 1 is the catalog picker (OPA-RETIRE:
// globals via widened payers_select — not org_payer_assignments). Phase 2 is
// the reviewable group×state expansion (pure expandTargets/reviewExpansion).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAttachPayerTargets } from "@/hooks/usePayerNetworkTargets";
import {
  expandTargets,
  expansionRowKey,
  planAttachmentSave,
  reviewExpansion,
} from "@/lib/payerExpansion";
import { PAYER_KIND_LABELS, formatStates } from "@/lib/payerDirectory";
import type { Payer, PayerNetworkTarget } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

export function AttachPayerDialog({
  wizard,
  pickerPayers,
  initialPayer,
  onClose,
}: {
  wizard: SectionBodyProps["wizard"];
  /** The curated not-yet-attached shortlist offered in the picker phase. */
  pickerPayers: Payer[];
  /** Jump straight to the expansion review (re-attach / new-expansion). */
  initialPayer?: Payer | null;
  onClose: () => void;
}) {
  const [payer, setPayer] = useState<Payer | null>(initialPayer ?? null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{payer ? `Attach ${payer.name}` : "Attach a payer"}</DialogTitle>
        </DialogHeader>
        {payer ? (
          <ExpansionReview payer={payer} wizard={wizard} onClose={onClose} />
        ) : (
          <div className="space-y-2 py-2">
            {pickerPayers.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Every payer enabled for this organization is already attached.
              </p>
            ) : (
              <ul className="space-y-2">
                {pickerPayers.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-[#E8E5E0] px-3 py-2 text-left hover:bg-[var(--mp-neutral-tint)]"
                      onClick={() => setPayer(p)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] font-medium text-foreground">{p.name}</span>
                        <span className="flex-none text-[12px] text-muted-foreground">
                          {PAYER_KIND_LABELS[p.payerKind ?? "commercial"]}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        States: {formatStates(p.states)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExpansionReview({
  payer,
  wizard,
  onClose,
}: {
  payer: Payer;
  wizard: SectionBodyProps["wizard"];
  onClose: () => void;
}) {
  const attachMut = useAttachPayerTargets();
  const groupById = new Map(wizard.providerGroups.map((g) => [g.id, g]));

  const review = useMemo(() => {
    const existing: PayerNetworkTarget[] = wizard.payerNetworkTargets.filter(
      (t) => t.payerId === payer.id,
    );
    return reviewExpansion(
      expandTargets(payer.states, wizard.providerGroups, wizard.facilities),
      existing,
    );
  }, [payer, wizard.providerGroups, wizard.facilities, wizard.payerNetworkTargets]);

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(review.filter((r) => r.defaultChecked).map(expansionRowKey)),
  );

  const plan = planAttachmentSave(review, checked);
  const nothingToSave = plan.inserts.length === 0 && plan.restoreIds.length === 0;

  const handleSave = () => {
    attachMut.mutate(
      { payerId: payer.id, plan },
      {
        onSuccess: () => {
          toast.success(`${payer.name} attached`);
          onClose();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the targets"),
      },
    );
  };

  if (review.length === 0) {
    return (
      <div className="space-y-3 py-2">
        <p className="text-[13px] text-muted-foreground">
          {payer.name} doesn&apos;t operate in any state where this organization&apos;s groups have
          active facilities, so there are no group and state targets to create. Add facilities in a
          covered state ({formatStates(payer.states)}) and re-run this attach.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <p className="text-[13px] text-muted-foreground">
        Attaching expands the org-level intent into group and state targets from where each
        group&apos;s facilities are. Uncheck any row to leave it out.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Group</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Why</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {review.map((row) => {
            const key = expansionRowKey(row);
            const isActive = row.existing === "active";
            return (
              <TableRow key={key}>
                <TableCell>
                  <Checkbox
                    checked={isActive || checked.has(key)}
                    disabled={isActive}
                    onCheckedChange={(v) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                    aria-label={`Target ${groupById.get(row.groupId)?.name ?? "group"} in ${row.state}`}
                  />
                </TableCell>
                <TableCell className="text-[13px]">
                  {groupById.get(row.groupId)?.name ?? "Unknown group"}
                </TableCell>
                <TableCell className="text-[13px]">{row.state}</TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {row.facilityCount} {row.facilityCount === 1 ? "facility" : "facilities"} in{" "}
                  {row.state}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {isActive ? "Already attached" : row.existing === "archived" ? "Archived" : ""}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={attachMut.isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={attachMut.isPending || nothingToSave}
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
        >
          {attachMut.isPending ? "Saving…" : "Save targets"}
        </Button>
      </DialogFooter>
    </div>
  );
}
