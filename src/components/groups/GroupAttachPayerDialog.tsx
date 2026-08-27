// E6.2 F6.2.4 — eligibility-filtered attach TO THE GROUP. Step 1 is a
// MULTI-SELECT picker over the CATALOG, offering only payers whose covered
// states intersect the group's operating states (never a zero-overlap payer),
// with an ineligible-payers explainer. Step 2 reviews the user-checked states
// for EVERY selected payer at once (payer ∩ group operating states, with the
// group's facility count per state as context) — one block per payer, each
// built by reviewExpansion/planAttachmentSave exactly as the single-payer flow
// was, so archived rows still arrive pre-unchecked and re-attach RESTORES
// (never a duplicate). Save runs attachGroupPayers: one insert for the whole
// selection (OPA-RETIRE: targets only — no org_payer_assignments).
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
import { Input } from "@/components/ui/input";
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
import { useAttachGroupPayers } from "@/hooks/usePayerNetworkTargets";
import {
  alreadyAttachedPayerIds,
  attachPlanTotals,
  attachRowKey,
  defaultAttachSelection,
  planMultiAttachSave,
  reviewAttachSelection,
  splitAttachPicker,
  type PayerAttachReview,
} from "@/lib/groupPayerAttach";
import { PAYER_KIND_LABELS } from "@/lib/payerDirectory";
import type { Facility, Payer, PayerNetworkTarget, ProviderGroup } from "@/types";

/** Above this many eligible payers the picker earns a filter box. */
const SEARCH_THRESHOLD = 6;

export function GroupAttachPayerDialog({
  group,
  facilities,
  existingTargets,
  initialPayer,
  onClose,
}: {
  group: ProviderGroup;
  facilities: Facility[];
  /** The org's targets — partitioned per payer inside. */
  existingTargets: PayerNetworkTarget[];
  /** Jump straight to the review with one payer preselected (re-attach). */
  initialPayer?: Payer | null;
  onClose: () => void;
}) {
  const catalogQ = useGlobalPayers();
  const attachMut = useAttachGroupPayers();

  const split = useMemo(
    () => splitAttachPicker(catalogQ.data ?? [], group),
    [catalogQ.data, group],
  );

  const [step, setStep] = useState<"select" | "review">(initialPayer ? "review" : "select");
  const [query, setQuery] = useState("");
  // Open with already-attached payers pre-checked (or just initialPayer on
  // re-attach) so the board's current targets are visible in the same pass
  // as any new ones the coordinator adds.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (initialPayer) return new Set([initialPayer.id]);
    return alreadyAttachedPayerIds(existingTargets, group.id);
  });
  // Checked STATE rows, payer-scoped. Seeded with each payer's defaults the
  // first time that payer reaches the review, so stepping back to change the
  // selection never discards state choices already made.
  const [checked, setChecked] = useState<Set<string>>(() =>
    initialPayer
      ? defaultAttachSelection(
          reviewAttachSelection([initialPayer], group, facilities, existingTargets),
        )
      : new Set<string>(),
  );
  const [seeded, setSeeded] = useState<Set<string>>(
    () => new Set(initialPayer ? [initialPayer.id] : []),
  );

  const selectedPayers = useMemo(() => {
    const byId = new Map(split.eligible.map((e) => [e.payer.id, e.payer]));
    if (initialPayer) byId.set(initialPayer.id, initialPayer);
    return [...selectedIds].flatMap((id) => {
      const payer = byId.get(id);
      return payer ? [payer] : [];
    });
  }, [split.eligible, initialPayer, selectedIds]);

  const reviews = useMemo(
    () => reviewAttachSelection(selectedPayers, group, facilities, existingTargets),
    [selectedPayers, group, facilities, existingTargets],
  );

  const plans = useMemo(() => planMultiAttachSave(reviews, checked), [reviews, checked]);
  const totals = attachPlanTotals(plans);

  const filtered = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return split.eligible;
    return split.eligible.filter((e) => e.payer.name.toLowerCase().includes(wanted));
  }, [split.eligible, query]);

  // A payer whose every proposed state already holds an ACTIVE target for
  // this group is fully attached — badge it in the picker.
  const activeStates = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const t of existingTargets) {
      if (t.groupId !== group.id || t.status !== "active") continue;
      const set = map.get(t.payerId);
      if (set) set.add(t.state);
      else map.set(t.payerId, new Set([t.state]));
    }
    return map;
  }, [existingTargets, group.id]);
  const fullyAttached = (payerId: string, overlap: string[]) => {
    const active = activeStates.get(payerId);
    return active !== undefined && overlap.length > 0 && overlap.every((s) => active.has(s));
  };

  const toggle = (payerId: string, on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(payerId);
      else next.delete(payerId);
      return next;
    });

  const goToReview = () => {
    // Seed defaults only for payers the reviewer hasn't seen yet.
    const fresh = reviews.filter((r) => !seeded.has(r.payer.id));
    if (fresh.length > 0) {
      const defaults = defaultAttachSelection(fresh);
      setChecked((prev) => new Set([...prev, ...defaults]));
      setSeeded((prev) => new Set([...prev, ...fresh.map((r) => r.payer.id)]));
    }
    setStep("review");
  };

  const handleSave = () => {
    attachMut.mutate(plans, {
      onSuccess: () => {
        toast.success(
          totals.payerCount === 1
            ? `${reviews.find((r) => r.payer.id === plans[0]?.payerId)?.payer.name ?? "Payer"} attached`
            : `${totals.payerCount} payers attached`,
        );
        onClose();
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the targets"),
    });
  };

  const title =
    step === "select"
      ? "Attach payers"
      : selectedPayers.length === 1
        ? `Attach ${selectedPayers[0].name}`
        : `Attach ${selectedPayers.length} payers`;

  return (
    <Dialog open onOpenChange={(o) => !o && !attachMut.isPending && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {step === "review" ? (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              Proposed states = each payer&apos;s coverage ∩ {group.name}&apos;s operating states.
              Review before saving; uncheck any state to leave it out.
            </p>
            {reviews.map((review) => (
              <PayerReviewBlock
                key={review.payer.id}
                review={review}
                groupName={group.name}
                checked={checked}
                onToggle={(key, on) =>
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(key);
                    else next.delete(key);
                    return next;
                  })
                }
              />
            ))}
            <DialogFooter>
              {initialPayer ? null : (
                <Button
                  variant="outline"
                  onClick={() => setStep("select")}
                  disabled={attachMut.isPending}
                >
                  Back
                </Button>
              )}
              <Button variant="outline" onClick={onClose} disabled={attachMut.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={attachMut.isPending || plans.length === 0}
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              >
                {attachMut.isPending
                  ? "Saving…"
                  : totals.payerCount > 1
                    ? `Save targets (${totals.payerCount} payers, ${totals.stateCount} states)`
                    : "Save targets"}
              </Button>
            </DialogFooter>
          </div>
        ) : catalogQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              Showing catalog payers that cover {group.name}&apos;s operating states (
              {(group.states ?? []).join(", ") || "none set"}). Select as many as you need — they
              are reviewed and attached together.
            </p>
            {split.eligible.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No catalog payer covers this group&apos;s operating states.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {split.eligible.length > SEARCH_THRESHOLD ? (
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter payers"
                      aria-label="Filter payers"
                      className="h-9 max-w-[16rem]"
                    />
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-3 text-[12px]">
                    <button
                      type="button"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() =>
                        setSelectedIds(
                          (prev) => new Set([...prev, ...filtered.map((e) => e.payer.id)]),
                        )
                      }
                    >
                      Select all{query.trim() ? " shown" : ""}
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                      disabled={selectedIds.size === 0}
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {filtered.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No eligible payer matches &ldquo;{query.trim()}&rdquo;.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {filtered.map(({ payer: p, overlap }) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[#E8E5E0] px-3 py-2 hover:bg-[var(--mp-neutral-tint)]">
                          <Checkbox
                            className="mt-0.5"
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={(v) => toggle(p.id, v === true)}
                            aria-label={`Select ${p.name}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-3">
                              <span className="text-[13px] font-medium text-foreground">
                                {p.name}
                              </span>
                              <span className="flex flex-none items-center gap-2 text-[12px] text-muted-foreground">
                                {fullyAttached(p.id, overlap) ? (
                                  <span className="rounded bg-[var(--mp-ok-tint)] px-1.5 py-0.5 text-[11.5px] text-[var(--mp-ok-ink)]">
                                    Attached
                                  </span>
                                ) : null}
                                {PAYER_KIND_LABELS[p.payerKind ?? "commercial"]}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[12px] text-muted-foreground">
                              Overlap: {overlap.join(", ")}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </>
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
              <Button
                onClick={goToReview}
                disabled={selectedIds.size === 0}
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              >
                {selectedIds.size > 1 ? `Review ${selectedIds.size} payers` : "Review states"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One payer's state table inside the review. Rows are keyed payer-scoped so
 * two payers proposing the same state stay independent. */
function PayerReviewBlock({
  review,
  groupName,
  checked,
  onToggle,
}: {
  review: PayerAttachReview;
  groupName: string;
  checked: ReadonlySet<string>;
  onToggle: (key: string, on: boolean) => void;
}) {
  const { payer, rows } = review;
  const selectedCount = rows.filter(
    (r) => r.existing === "active" || checked.has(attachRowKey(payer.id, r)),
  ).length;

  return (
    <div className="rounded-md border border-[#E8E5E0]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EEE9] px-3 py-2">
        <span className="text-[13px] font-semibold text-foreground">{payer.name}</span>
        <span className="text-[12px] text-muted-foreground">
          {rows.length === 0
            ? "No overlapping states"
            : review.fullyAttached
              ? "Already attached in every proposed state"
              : `${selectedCount} of ${rows.length} ${rows.length === 1 ? "state" : "states"} selected`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
          {payer.name} doesn&apos;t cover any of {groupName}&apos;s operating states, so there are
          no state targets to create.
        </p>
      ) : (
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
            {rows.map((row) => {
              const key = attachRowKey(payer.id, row);
              const isActive = row.existing === "active";
              return (
                <TableRow key={key}>
                  <TableCell>
                    <Checkbox
                      checked={isActive || checked.has(key)}
                      disabled={isActive}
                      onCheckedChange={(v) => onToggle(key, v === true)}
                      aria-label={`Target ${row.state} for ${payer.name}`}
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
      )}
    </div>
  );
}
