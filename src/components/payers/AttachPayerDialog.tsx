// Attach-payer review dialog (E1.5 F1.5.1–F1.5.4). One flow serves fresh
// attach, re-attach after archive, and the "new expansion available" review:
// pick a curated payer (or arrive with one preselected), review the derived
// group×state expansion, uncheck exceptions, save. Only checked rows write —
// new rows insert, previously-archived rows restore (pre-UNCHECKED per
// F1.5.3), already-active rows render locked. The prerequisite note is
// informational only (R4/Q8 — no validation attaches to it).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { payerMetaSummary } from "@/components/payers/payerDisplay";
import { useAttachTargets } from "@/hooks/usePayerNetworkTargets";
import {
  describeEmptyExpansion,
  expandTargets,
  planAttach,
  type ExpansionInput,
} from "@/lib/payerExpansion";
import type { Payer, PayerNetworkTarget } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

const rowKey = (row: { groupId: string; state: string }) => `${row.groupId} ${row.state}`;

export function AttachPayerDialog({
  wizard,
  payers,
  selectablePayers,
  targets,
  initialPayerId = null,
  onClose,
}: {
  wizard: SectionBodyProps["wizard"];
  /** The full curated shortlist — resolves prerequisite payer names. */
  payers: Payer[];
  /** Payers offered in the picker (curated, not yet actively attached). */
  selectablePayers: Payer[];
  targets: PayerNetworkTarget[];
  /** Preselects a payer and locks the picker (the review-expansion flow). */
  initialPayerId?: string | null;
  onClose: () => void;
}) {
  const [payerId, setPayerId] = useState<string>(initialPayerId ?? "");
  // null = defaults from the plan; a save-scoped override map once touched.
  const [checkedOverrides, setCheckedOverrides] = useState<Record<string, boolean> | null>(null);

  const payer = payers.find((p) => p.id === payerId) ?? null;
  const prerequisite = payer?.prerequisitePayerId
    ? (payers.find((p) => p.id === payer.prerequisitePayerId)?.name ?? "another payer")
    : null;

  const expansionInput: ExpansionInput | null = payer
    ? {
        payerStates: payer.states,
        groups: wizard.providerGroups,
        facilities: wizard.facilities,
      }
    : null;

  const plan = useMemo(() => {
    if (!payer) return [];
    const expansion = expandTargets({
      payerStates: payer.states,
      groups: wizard.providerGroups,
      facilities: wizard.facilities,
    });
    return planAttach(
      expansion,
      targets.filter((t) => t.payerId === payer.id),
    );
  }, [payer, targets, wizard.providerGroups, wizard.facilities]);

  const isChecked = (key: string, fallback: boolean) => checkedOverrides?.[key] ?? fallback;
  const decidable = plan.filter((row) => row.kind !== "active");
  const selected = decidable.filter((row) => isChecked(rowKey(row), row.defaultChecked));

  const attachMut = useAttachTargets();

  const save = () => {
    if (!payer || selected.length === 0) return;
    attachMut.mutate(
      {
        payerId: payer.id,
        create: selected
          .filter((row) => row.kind === "new")
          .map((row) => ({ groupId: row.groupId, state: row.state })),
        restoreIds: selected
          .filter((row) => row.kind === "archived")
          .map((row) => row.targetId as string),
      },
      {
        onSuccess: () => {
          toast.success(`${payer.name} attached`);
          onClose();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't attach the payer"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach payer</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {initialPayerId ? (
            <div className="text-[13px] font-medium text-foreground">
              {payer?.name}
              {payer && payerMetaSummary(payer) ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  {payerMetaSummary(payer)}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="attach-payer-select">Payer</Label>
              <Select
                value={payerId}
                onValueChange={(v) => {
                  setPayerId(v);
                  setCheckedOverrides(null);
                }}
              >
                <SelectTrigger id="attach-payer-select">
                  <SelectValue placeholder="Choose a payer" />
                </SelectTrigger>
                <SelectContent>
                  {selectablePayers.map((p) => {
                    const meta = payerMetaSummary(p);
                    return (
                      <SelectItem key={p.id} value={p.id}>
                        {meta ? `${p.name} — ${meta}` : p.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {prerequisite ? (
            <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 flex-none" />
              <span>
                Requires {prerequisite}. That prerequisite is checked when cases are generated —
                attaching now is fine.
              </span>
            </p>
          ) : null}

          {payer ? (
            plan.length === 0 ? (
              <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-4 py-3 text-[13px] text-[#92400E]">
                {expansionInput ? describeEmptyExpansion(payer.name, expansionInput) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] text-muted-foreground">
                  {payer.name} expands to these group and state targets. Uncheck any row you don't
                  want to pursue.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <span className="sr-only">Include</span>
                      </TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.map((row) => {
                      const key = rowKey(row);
                      return (
                        <TableRow key={key} className="h-10">
                          <TableCell>
                            <Checkbox
                              aria-label={`Target ${row.groupName} in ${row.state}`}
                              checked={row.kind === "active" || isChecked(key, row.defaultChecked)}
                              disabled={row.kind === "active" || attachMut.isPending}
                              onCheckedChange={(checked) =>
                                setCheckedOverrides((prev) => ({
                                  ...(prev ?? {}),
                                  [key]: checked === true,
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-[13px]">{row.groupName}</TableCell>
                          <TableCell className="text-[13px]">{row.state}</TableCell>
                          <TableCell className="text-[12px] text-muted-foreground">
                            {row.reason}
                            {row.kind === "active" ? " — already active" : ""}
                            {row.kind === "archived" ? " — previously archived" : ""}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={attachMut.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E]"
            onClick={save}
            disabled={!payer || selected.length === 0 || attachMut.isPending}
          >
            Attach {selected.length} {selected.length === 1 ? "target" : "targets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
