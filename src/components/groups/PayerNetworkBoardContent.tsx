// E6.2 F6.2.3 — the Payer Network fulfillment board: the group's
// promise-vs-reality screen, alive from day 1. ONE row per targeted payer
// with a DERIVED pill (Targeted / In Progress + open count / Active + since)
// through the E6.0 rollup — nobody can set any value here; approving a case
// or recording/expiring an enrollment fact flips the row on the next render
// with zero board-side writes. Drill-down shows each provider's per-state
// evidence (case status, enrollment fact, exclusion, awaiting-generation)
// with denial history preserved beneath reapply cycles. Excluded combinations
// stay visible on their rows with one-click Restore; the buffer banner counts
// the E6.3 candidate math and names its most recent cause.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { RosterUploader } from "@/components/import/RosterUploader";
import { GroupAttachPayerDialog } from "@/components/groups/GroupAttachPayerDialog";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import { usePayerNetworkBoard } from "@/hooks/usePayerNetworkBoard";
import {
  usePayerNetworkTargets,
  useRemoveGroupPayer,
} from "@/hooks/usePayerNetworkTargets";
import { useVoidCaseGenerationExclusion } from "@/hooks/useGenerationPreview";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { useProviderGroupAssignments } from "@/hooks/useProviders";
import { EXCLUSION_REASON_LABELS } from "@/lib/generationPreview";
import { fmtDate } from "@/lib/format";
import { useIsAdmin } from "@/lib/permissions";
import type { SectionScanContext } from "@/lib/importSections";
import type { PayerBoardRow } from "@/lib/payerNetworkBoard";
import type { PayerFulfillment } from "@/lib/caseRollups";
import type { ProviderGroup } from "@/types";

const FULFILLMENT_PILL: Record<PayerFulfillment, { tone: "gray" | "blue" | "green"; label: string }> =
  {
    targeted: { tone: "gray", label: "Targeted" },
    in_progress: { tone: "blue", label: "In Progress" },
    active: { tone: "green", label: "Active" },
  };

export function PayerNetworkBoardContent({ group }: { group: ProviderGroup }) {
  const isAdmin = useIsAdmin();
  const boardData = usePayerNetworkBoard(group.id);
  const targetsQ = usePayerNetworkTargets();
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();
  const catalogQ = useGlobalPayers();
  const assignmentsQ = useProviderGroupAssignments();
  const [attachOpen, setAttachOpen] = useState(false);
  const [removing, setRemoving] = useState<PayerBoardRow | null>(null);

  // The CSV scan's org context (eligibility resolves against these).
  const scanContext: SectionScanContext = useMemo(
    () => ({
      payerAttach: {
        groups: (groupsQ.data ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          tin: g.tin,
          states: g.states,
        })),
        payers: (catalogQ.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          payerSlug: p.payerSlug,
          aliases: p.aliases,
          states: p.states,
          status: p.status,
        })),
      },
    }),
    [groupsQ.data, catalogQ.data],
  );

  const rosterSize = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return new Set(
      (assignmentsQ.data ?? [])
        .filter(
          (a) =>
            a.groupId === group.id &&
            (a.endDate == null || a.endDate.slice(0, 10) >= today),
        )
        .map((a) => a.providerId),
    ).size;
  }, [assignmentsQ.data, group.id]);

  if (boardData.isLoading || boardData.board === undefined) {
    return <Skeleton className="h-48 w-full" />;
  }

  const board = boardData.board;
  const candidates = boardData.candidates ?? [];
  const cause = boardData.cause;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">
          {board.targetedPayerCount === 0
            ? "No payers targeted yet."
            : `${board.targetedPayerCount} of ${board.targetedPayerCount} targeted ${
                board.targetedPayerCount === 1 ? "payer" : "payers"
              } accounted for.`}
        </p>
        {isAdmin ? (
          <Button
            className="h-9 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            onClick={() => setAttachOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Attach payer
          </Button>
        ) : null}
      </div>

      {/* F6.2.3 — the candidates-awaiting-generation banner: count = the E6.3
          candidate math, cause named; Review & generate arrives with E6.3. */}
      {candidates.length > 0 ? (
        <Card className="border-[#FDE68A] bg-[#FEF3C7]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-[13px] text-[#92400E]">
              <span className="font-semibold">
                {candidates.length} {candidates.length === 1 ? "candidate" : "candidates"} awaiting
                generation
              </span>
              {cause ? (
                <>
                  {" — "}
                  {cause.label}
                  {cause.date ? ` ${fmtDate(cause.date)}` : ""}
                </>
              ) : null}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled
              title="The generation grid arrives with the next epic (E6.3)."
            >
              Review &amp; generate
            </Button>
          </CardContent>
        </Card>
      ) : rosterSize === 0 && board.rows.length > 0 ? (
        <Card className="border-[#E8E5E0]">
          <CardContent className="p-4 text-[13px] text-muted-foreground">
            No providers yet — add providers to create casework. The board records the
            contract&apos;s target state until then.
          </CardContent>
        </Card>
      ) : null}

      {board.rows.length === 0 ? (
        <Card className="border-[#E8E5E0]">
          <CardContent className="p-6 text-[13px] text-muted-foreground">
            No payers targeted for this group yet. Attach the contract&apos;s payers to record the
            target state — the board tracks fulfillment from day one, even with zero providers.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {board.rows.map((row) => (
            <BoardRowCard
              key={row.payerId}
              row={row}
              isAdmin={isAdmin}
              onRemove={() => setRemoving(row)}
            />
          ))}
        </ul>
      )}

      {isAdmin ? (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Attach payers from a CSV
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] p-4">
              <RosterUploader
                source="internal"
                variant="internal"
                entityKind="payer_attach"
                scanContext={scanContext}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {attachOpen ? (
        <GroupAttachPayerDialog
          group={group}
          facilities={facilitiesQ.data ?? []}
          existingTargets={targetsQ.data ?? []}
          onClose={() => setAttachOpen(false)}
        />
      ) : null}
      {removing ? (
        <RemovePayerDialog group={group} row={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </div>
  );
}

function BoardRowCard({
  row,
  isAdmin,
  onRemove,
}: {
  row: PayerBoardRow;
  isAdmin: boolean;
  onRemove: () => void;
}) {
  const pill = FULFILLMENT_PILL[row.fulfillment];
  const restoreMut = useVoidCaseGenerationExclusion();

  return (
    <li className="rounded-md border border-[#E8E5E0] bg-white">
      <Collapsible>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-foreground">{row.payerName}</span>
            <StatusPill status={pill.tone} label={pill.label} />
            {row.fulfillment === "in_progress" ? (
              <span className="text-[12px] text-muted-foreground">
                {row.openCount} open {row.openCount === 1 ? "case" : "cases"}
              </span>
            ) : null}
            {row.fulfillment === "active" && row.activeSince ? (
              <span className="text-[12px] text-muted-foreground">
                since {fmtDate(row.activeSince)}
              </span>
            ) : null}
            {row.factCount > 0 ? (
              <span className="rounded bg-[var(--mp-ok-tint)] px-1.5 py-0.5 text-[11.5px] text-[var(--mp-ok-ink)]">
                {row.factCount} enrolled by fact
              </span>
            ) : null}
            {row.hasDenial ? (
              <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[11.5px] text-[#92400E]">
                Denial on file
              </span>
            ) : null}
            <span className="text-[12px] text-muted-foreground">
              {row.targetStates.join(" · ")}
            </span>
          </div>
          <div className="flex flex-none items-center gap-2">
            {isAdmin ? (
              <Button variant="outline" size="sm" className="h-8" onClick={onRemove}>
                Remove payer
              </Button>
            ) : null}
            <CollapsibleTrigger
              className="flex items-center gap-1 rounded-md border border-[#E8E5E0] px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
              aria-label={`Show providers for ${row.payerName}`}
            >
              Providers
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </CollapsibleTrigger>
          </div>
        </div>

        {row.excluded.length > 0 ? (
          <div className="border-t border-[#F0EEE9] px-4 py-2">
            {row.excluded.map((x) => (
              <div
                key={x.exclusionId}
                className="flex flex-wrap items-center justify-between gap-2 py-1"
              >
                <span className="text-[12.5px] text-muted-foreground">
                  Excluded: {x.providerName} · {x.state} — {EXCLUSION_REASON_LABELS[x.reason]}
                  {x.note ? ` (${x.note})` : ""}
                </span>
                {isAdmin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={restoreMut.isPending}
                    onClick={() =>
                      restoreMut.mutate(x.exclusionId, {
                        onSuccess: () => toast.success("Combination restored to generation"),
                        onError: (e) =>
                          toast.error(e instanceof Error ? e.message : "Couldn't restore"),
                      })
                    }
                  >
                    Restore
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <CollapsibleContent>
          <div className="border-t border-[#F0EEE9] px-4 py-3">
            {row.providers.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                No providers at this payer yet — add providers to create casework.
              </p>
            ) : (
              <ul className="space-y-2">
                {row.providers.map((p) => (
                  <li key={p.providerId}>
                    <div className="text-[13px] font-medium text-foreground">{p.providerName}</div>
                    <ul className="mt-1 space-y-1">
                      {p.cells.map((cell) => (
                        <li
                          key={`${p.providerId}-${cell.state}-${cell.kind}`}
                          className="flex flex-wrap items-center gap-2 text-[12.5px]"
                        >
                          <span className="w-8 flex-none text-muted-foreground">{cell.state}</span>
                          {cell.kind === "case" && cell.caseStatus ? (
                            <>
                              <CaseStatusPill status={cell.caseStatus} />
                              {cell.caseId ? (
                                <Link
                                  to="/cases/$id"
                                  params={{ id: cell.caseId }}
                                  className="text-[12px] font-medium text-[#1B4D3E] underline"
                                >
                                  Open case
                                </Link>
                              ) : null}
                            </>
                          ) : cell.kind === "fact" ? (
                            <span className="rounded bg-[var(--mp-ok-tint)] px-1.5 py-0.5 text-[11.5px] text-[var(--mp-ok-ink)]">
                              Enrolled (fact)
                              {cell.factEffectiveDate
                                ? ` — effective ${fmtDate(cell.factEffectiveDate)}`
                                : ""}
                            </span>
                          ) : cell.kind === "excluded" ? (
                            <span className="text-muted-foreground">
                              Excluded —{" "}
                              {cell.exclusionReason
                                ? EXCLUSION_REASON_LABELS[cell.exclusionReason]
                                : "excluded"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Awaiting generation</span>
                          )}
                          {cell.kind === "case" && cell.denials && cell.denials.length > 0 ? (
                            <span className="basis-full pl-10 text-[12px] text-muted-foreground">
                              {cell.denials
                                .map(
                                  (d) =>
                                    `Denied${d.reasonLabel ? ` — ${d.reasonLabel}` : ""}${
                                      d.date ? `, ${fmtDate(d.date)}` : ""
                                    }`,
                                )
                                .join(" · ")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

// Removal = ARCHIVE (never delete): this group's targets flip to archived and
// the org-level enablement archives only when no other group still works the
// payer. Re-attach later restores the same rows (TS-124).
function RemovePayerDialog({
  group,
  row,
  onClose,
}: {
  group: ProviderGroup;
  row: PayerBoardRow;
  onClose: () => void;
}) {
  const removeMut = useRemoveGroupPayer();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Remove {row.payerName} from {group.name}?</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          The group&apos;s targets for this payer are archived — never deleted — so history stays
          intact and re-attaching later restores them. Existing cases are untouched.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={removeMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              removeMut.mutate(
                { groupId: group.id, payerId: row.payerId },
                {
                  onSuccess: () => {
                    toast.success(`${row.payerName} removed (targets archived)`);
                    onClose();
                  },
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Couldn't remove the payer"),
                },
              )
            }
            disabled={removeMut.isPending}
            className="bg-[#B91C1C] text-white hover:bg-[#991B1B]"
          >
            {removeMut.isPending ? "Working…" : "Remove payer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
