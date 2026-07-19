// E6.2 F6.2.4 — eligibility-filtered attach TO THE GROUP. Phase 1: the picker
// queries the CATALOG and offers only payers whose covered states intersect
// the group's operating states (never a zero-overlap payer), with an
// ineligible-payers explainer. Phase 2: the user-reviewed states (payer ∩
// group operating states, with the group's facility count per state as
// context) — reviewExpansion/planAttachmentSave reused verbatim, so archived
// rows arrive pre-unchecked and re-attach RESTORES (never a duplicate). Save
// runs attachGroupPayer: the org-level enablement (org_payer_assignments) is
// created implicitly and never managed by the user.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import { useAttachGroupPayer } from "@/hooks/usePayerNetworkTargets";
import { expansionRowKey, planAttachmentSave, reviewExpansion } from "@/lib/payerExpansion";
import { groupAttachExpansion, splitAttachPicker } from "@/lib/groupPayerAttach";
import { PAYER_KIND_LABELS } from "@/lib/payerDirectory";
import type { Facility, Payer, PayerNetworkTarget, ProviderGroup } from "@/types";

export function GroupAttachPayerDialog({
  group,
  facilities,
  existingTargets,
  initialPayer,
  onClose,
}: {
  group: ProviderGroup;
  facilities: Facility[];
  /** The org's targets — filtered per payer inside. */
  existingTargets: PayerNetworkTarget[];
  /** Jump straight to the review (re-attach from the board). */
  initialPayer?: Payer | null;
  onClose: () => void;
}) {
  const [payer, setPayer] = useState<Payer | null>(initialPayer ?? null);
  const catalogQ = useGlobalPayers();

  const split = useMemo(
    () => splitAttachPicker(catalogQ.data ?? [], group),
    [catalogQ.data, group],
  );

  // A payer whose every proposed state already holds an ACTIVE target for
  // this group is fully attached — badge it in the picker.
  const fullyAttached = (payerId: string, overlap: string[]) => {
    const active = new Set(
      existingTargets
        .filter((t) => t.groupId === group.id && t.payerId === payerId && t.status === "active")
        .map((t) => t.state),
    );
    return overlap.length > 0 && overlap.every((s) => active.has(s));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{payer ? `Attach ${payer.name}` : "Attach a payer"}</DialogTitle>
        </DialogHeader>
        {payer ? (
          <GroupAttachReview
            payer={payer}
            group={group}
            facilities={facilities}
            existingTargets={existingTargets}
            onClose={onClose}
          />
        ) : catalogQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              Showing catalog payers that cover {group.name}&apos;s operating states (
              {(group.states ?? []).join(", ") || "none set"}).
            </p>
            {split.eligible.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No catalog payer covers this group&apos;s operating states.
              </p>
            ) : (
              <ul className="space-y-2">
                {split.eligible.map(({ payer: p, overlap }) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-[#E8E5E0] px-3 py-2 text-left hover:bg-[var(--mp-neutral-tint)]"
                      onClick={() => setPayer(p)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] font-medium text-foreground">{p.name}</span>
                        <span className="flex flex-none items-center gap-2 text-[12px] text-muted-foreground">
                          {fullyAttached(p.id, overlap) ? (
                            <span className="rounded bg-[var(--mp-ok-tint)] px-1.5 py-0.5 text-[11.5px] text-[var(--mp-ok-ink)]">
                              Attached
                            </span>
                          ) : null}
                          {PAYER_KIND_LABELS[p.payerKind ?? "commercial"]}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        Overlap: {overlap.join(", ")}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {split.ineligible.length > 0 ? (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  {split.ineligible.length} catalog{" "}
                  {split.ineligible.length === 1 ? "payer doesn't" : "payers don't"} overlap this
                  group&apos;s operating states
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {split.ineligible.map((p) => p.name).join(" · ")} — none cover{" "}
                    {(group.states ?? []).join(", ") || "the group's states"}. Widen the
                    group&apos;s operating states to attach one of these.
                  </p>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
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

function GroupAttachReview({
  payer,
  group,
  facilities,
  existingTargets,
  onClose,
}: {
  payer: Payer;
  group: ProviderGroup;
  facilities: Facility[];
  existingTargets: PayerNetworkTarget[];
  onClose: () => void;
}) {
  const attachMut = useAttachGroupPayer();

  const review = useMemo(() => {
    const existing = existingTargets.filter(
      (t) => t.groupId === group.id && t.payerId === payer.id,
    );
    return reviewExpansion(groupAttachExpansion(payer, group, facilities), existing);
  }, [payer, group, facilities, existingTargets]);

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
          {payer.name} doesn&apos;t cover any of {group.name}&apos;s operating states, so there are
          no state targets to create.
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
        Proposed states = {payer.name}&apos;s coverage ∩ {group.name}&apos;s operating states.
        Review before saving; uncheck any state to leave it out.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>State</TableHead>
            <TableHead>Context</TableHead>
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
                    aria-label={`Target ${row.state}`}
                  />
                </TableCell>
                <TableCell className="text-[13px]">{row.state}</TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {row.facilityCount > 0
                    ? `${row.facilityCount} ${row.facilityCount === 1 ? "facility" : "facilities"} in ${row.state}`
                    : "No facilities in this state yet"}
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
