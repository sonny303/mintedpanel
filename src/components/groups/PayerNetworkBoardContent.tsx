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
//
// Slice D (payer-and-cases screen 5) — the payer-issued GROUP ID display: the
// stored per-state PIN chip is worded the payer's way (groupIdLabel), and when
// the payer EXPECTS a group ID but a case closed Approved without one (the
// E6.8 "Didn't receive" escape, payer_group_provider_id NULL) the row shows a
// DERIVED amber "Awaiting ID" pill linking the capturing case; storing the PIN
// through the existing Group-IDs dialog resolves it by re-derivation. A payer
// that issues no group ID reads "No group ID issued" once Approved evidence
// exists. Read-only; never stored (awaitingGroupIdCases / groupIdNotIssued).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { CsvImportPanel } from "@/components/import/CsvImportPanel";
import { RosterUploader } from "@/components/import/RosterUploader";
import { GroupAttachPayerDialog } from "@/components/groups/GroupAttachPayerDialog";
import { useCases } from "@/hooks/useCases";
import { usePayers } from "@/hooks/useAdmin";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import { usePayerNetworkBoard } from "@/hooks/usePayerNetworkBoard";
import {
  usePayerNetworkTargets,
  useRemoveGroupPayer,
  useSetTargetIdentifier,
} from "@/hooks/usePayerNetworkTargets";
import { useVoidCaseGenerationExclusion } from "@/hooks/useGenerationPreview";
import { useResumableImportRun } from "@/hooks/useImportRuns";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { useProviderGroupAssignments } from "@/hooks/useProviders";
import { EXCLUSION_REASON_LABELS } from "@/lib/generationPreview";
import { fmtDate } from "@/lib/format";
import { awaitingGroupIdCases, groupIdNotIssued } from "@/lib/payerIssuedIds";
import { useIsAdmin } from "@/lib/permissions";
import type { SectionScanContext } from "@/lib/importSections";
import type { GroupIdCaseSlice } from "@/lib/payerIssuedIds";
import type { PayerBoardRow } from "@/lib/payerNetworkBoard";
import type { PayerFulfillment } from "@/lib/caseRollups";
import type { Payer, PayerNetworkTarget, ProviderGroup } from "@/types";

const FULFILLMENT_PILL: Record<
  PayerFulfillment,
  { tone: "gray" | "blue" | "green"; label: string }
> = {
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
  // Both caches are already warmed by usePayerNetworkBoard — free reads for
  // the Slice D group-ID derivation (payer expectation flags + case columns).
  const payersQ = usePayers();
  const casesQ = useCases();
  const assignmentsQ = useProviderGroupAssignments();
  const payerAttachRun = useResumableImportRun("internal", "payer_attach", "internal");
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
          (a) => a.groupId === group.id && (a.endDate == null || a.endDate.slice(0, 10) >= today),
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
              } accounted for.`}{" "}
          <Link
            to="/generation/runs"
            className="font-medium text-[#1B4D3E] underline underline-offset-2"
          >
            Run history
          </Link>
        </p>
        {isAdmin ? (
          <Button
            className="h-9 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            onClick={() => setAttachOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Attach payers
          </Button>
        ) : null}
      </div>

      {/* F6.2.3 — the candidates-awaiting-generation banner: count = the E6.3
          candidate math, cause named; Generate cases opens the shared grid. */}
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
            {/* E6.3 — the one door: the grid opens scoped to this group. */}
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link to="/generation" search={{ group: group.id }}>
                Generate cases
              </Link>
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
              groupId={group.id}
              isAdmin={isAdmin}
              payer={(payersQ.data ?? []).find((p) => p.id === row.payerId) ?? null}
              approvedCases={(casesQ.data ?? []).filter(
                (c) =>
                  c.groupId === group.id &&
                  c.payerId === row.payerId &&
                  c.caseStatus === "approved",
              )}
              targets={(targetsQ.data ?? []).filter(
                (t) => t.groupId === group.id && t.payerId === row.payerId && t.status === "active",
              )}
              onRemove={() => setRemoving(row)}
            />
          ))}
        </ul>
      )}

      {isAdmin ? (
        // The pattern this panel standardized site-wide (2026-07-20) started
        // here — now rendered through the ONE shared disclosure.
        <CsvImportPanel label="Attach payers from a CSV" defaultOpen={payerAttachRun !== undefined}>
          <RosterUploader
            source="internal"
            variant="internal"
            entityKind="payer_attach"
            scanContext={scanContext}
          />
        </CsvImportPanel>
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
  groupId,
  isAdmin,
  payer,
  approvedCases,
  targets,
  onRemove,
}: {
  row: PayerBoardRow;
  groupId: string;
  isAdmin: boolean;
  /** The catalog row — carries the E6.7 group-ID expectation flags + label. */
  payer: Payer | null;
  /** The pair's APPROVED cases (group-stamped) — the Awaiting-ID inputs. */
  approvedCases: GroupIdCaseSlice[];
  /** The group's ACTIVE targets for this payer — carriers of the payer-issued
   * GROUP identifier (group PIN), one per state (2026-07-20 re-scope). */
  targets: PayerNetworkTarget[];
  onRemove: () => void;
}) {
  const pill = FULFILLMENT_PILL[row.fulfillment];
  const restoreMut = useVoidCaseGenerationExclusion();
  const [editingGroupIds, setEditingGroupIds] = useState(false);
  const setIds = targets.filter((t) => (t.payerIssuedId ?? "").trim());
  // Slice D — the payer's own wording for the group ID chip, and the derived
  // Awaiting-ID / no-ID states (never stored; re-derives on every render).
  const groupIdLabel = payer?.groupIdLabel?.trim() || "Group ID";
  const awaitingIds = awaitingGroupIdCases(payer, approvedCases, targets);
  const noGroupId = groupIdNotIssued(payer, approvedCases.length);

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
            {/* 2026-07-20 re-scope: the payer-issued GROUP identifier lives on
                the payer entry here — per state where payers differ. Since
                Slice D the chip is worded the payer's way (groupIdLabel). */}
            {setIds.length > 0 ? (
              <span className="rounded-[4px] bg-[#F4F2EF] px-1.5 py-0.5 text-[11.5px] text-foreground">
                {groupIdLabel}: {setIds.map((t) => `${t.state} ${t.payerIssuedId}`).join(" · ")}
              </span>
            ) : null}
            {/* Slice D — expected + approved + NULL payer_group_provider_id
                (E6.8 "Didn't receive") derives the wait, linking the capturing
                case; a stored PIN above resolves it. */}
            {awaitingIds.map((a) => (
              <span key={a.state} className="inline-flex items-center gap-1.5">
                <StatusPill
                  status="amber"
                  label={row.targetStates.length > 1 ? `Awaiting ID · ${a.state}` : "Awaiting ID"}
                />
                <Link
                  to="/cases/$id"
                  params={{ id: a.caseId }}
                  className="font-mono text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
                >
                  {a.caseNumber != null ? `C-${a.caseNumber}` : "Open case"}
                </Link>
              </span>
            ))}
            {noGroupId ? <StatusPill status="neutral" label="No group ID issued" /> : null}
            {isAdmin && targets.length > 0 ? (
              <button
                type="button"
                className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setEditingGroupIds(true)}
              >
                {setIds.length > 0 ? "Edit group IDs" : "Add group ID"}
              </button>
            ) : null}
          </div>
          <div className="flex flex-none items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link
                to="/generation"
                search={{ group: groupId, payer: row.payerId, pivot: "payer" }}
              >
                Generate cases
              </Link>
            </Button>
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

      {editingGroupIds ? (
        <GroupIdsDialog
          payerName={row.payerName}
          targets={targets}
          onClose={() => setEditingGroupIds(false)}
        />
      ) : null}
    </li>
  );
}

// 2026-07-20 re-scope — capture the payer-issued GROUP identifier on the
// payer entry, per active target state (payers that issue one group PIN
// across states just repeat it). Audited status-preserving UPDATEs; blank
// clears. Admin-only, matching every other board write.
function GroupIdsDialog({
  payerName,
  targets,
  onClose,
}: {
  payerName: string;
  targets: PayerNetworkTarget[];
  onClose: () => void;
}) {
  const setIdMut = useSetTargetIdentifier();
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(targets.map((t) => [t.id, t.payerIssuedId ?? ""])),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      for (const t of targets) {
        const next = (drafts[t.id] ?? "").trim() || null;
        const prev = (t.payerIssuedId ?? "").trim() || null;
        if (next !== prev) {
          await setIdMut.mutateAsync({ id: t.id, payerIssuedId: next });
        }
      }
      toast.success("Group identifiers saved");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the group identifiers");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Group identifiers — {payerName}</DialogTitle>
          <DialogDescription>
            The group enrollment ID this payer issued under the group&apos;s contract, per state.
            Leave a state blank if none was issued (provider-level IDs live on each provider&apos;s
            enrollment record — both can coexist).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {targets.map((t) => (
            <div key={t.id} className="space-y-1.5">
              <Label htmlFor={`group-id-${t.id}`}>{t.state}</Label>
              <Input
                id={`group-id-${t.id}`}
                value={drafts[t.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                placeholder="As issued by the payer"
                className="h-9"
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button className="bg-[#1B4D3E] hover:bg-[#163F33]" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          <DialogTitle>
            Remove {row.payerName} from {group.name}?
          </DialogTitle>
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
