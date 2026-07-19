// E6.2 F6.2.4 — the staged payer-attach preview + commit. Every staged row
// already passed the scan-time eligibility gate (resolved group_id/payer_id
// stamped by the descriptor's contextScan); this view derives what a commit
// will do against the CURRENT targets (create / restore archived /
// skip-already-active — the same skip-on-match rule the commit re-applies
// authoritatively) and commits through commitPayerAttachImportRun, which also
// creates the org-level enablement implicitly.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCancelImportRun,
  useCommitPayerAttachImportRun,
  useImportRun,
  useStagedImportRows,
} from "@/hooks/useImportRuns";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { useProviderGroups } from "@/hooks/useLookups";
import { decodeDelimited } from "@/lib/importSections";

type RowOutcome = "create" | "restore" | "skip";

interface PreviewLine {
  key: string;
  groupName: string;
  payerName: string;
  state: string;
  outcome: RowOutcome;
}

const OUTCOME_LABEL: Record<RowOutcome, string> = {
  create: "Will attach",
  restore: "Restores archived target",
  skip: "Already attached — skipped",
};

export function PayerAttachImportPreview({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const runQ = useImportRun(runId);
  const stagedQ = useStagedImportRows(runId);
  const targetsQ = usePayerNetworkTargets();
  const catalogQ = useGlobalPayers();
  const groupsQ = useProviderGroups();
  const commitMut = useCommitPayerAttachImportRun();
  const cancelMut = useCancelImportRun();
  const [confirming, setConfirming] = useState(false);

  const lines = useMemo<PreviewLine[] | undefined>(() => {
    if (!stagedQ.data || !targetsQ.data) return undefined;
    const groupNameById = new Map((groupsQ.data ?? []).map((g) => [g.id, g.name]));
    const payerNameById = new Map((catalogQ.data ?? []).map((p) => [p.id, p.name]));
    const targetByKey = new Map(
      targetsQ.data.map((t) => [`${t.groupId}|${t.payerId}|${t.state}`, t]),
    );
    const seen = new Set<string>();
    const out: PreviewLine[] = [];
    for (const row of stagedQ.data) {
      const mapped = row.mapped ?? {};
      const groupId = mapped.group_id;
      const payerId = mapped.payer_id;
      if (!groupId || !payerId) continue;
      for (const state of decodeDelimited(mapped.states ?? "")) {
        const key = `${groupId}|${payerId}|${state}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const match = targetByKey.get(key);
        out.push({
          key,
          groupName: groupNameById.get(groupId) ?? "Unknown group",
          payerName: payerNameById.get(payerId) ?? "Unknown payer",
          state,
          outcome: !match ? "create" : match.status === "archived" ? "restore" : "skip",
        });
      }
    }
    return out.sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) ||
        a.payerName.localeCompare(b.payerName) ||
        a.state.localeCompare(b.state),
    );
  }, [stagedQ.data, targetsQ.data, groupsQ.data, catalogQ.data]);

  if (runQ.isLoading || lines === undefined) return <Skeleton className="h-40 w-full" />;
  const run = runQ.data;
  if (!run) return null;

  if (run.state === "committed") {
    return (
      <Card className="border-[#E8E5E0]">
        <CardContent className="space-y-2 p-6">
          <p className="text-[14px] font-medium text-foreground">Payer attach committed</p>
          <p className="text-[13px] text-muted-foreground">
            The reviewed group × payer × state targets are attached (already-active rows skipped,
            archived rows restored). The fulfillment boards read them immediately.
          </p>
          <Link to="/groups" className="text-[13px] font-medium text-[#1B4D3E] underline">
            Open Groups
          </Link>
        </CardContent>
      </Card>
    );
  }

  const counts = {
    create: lines.filter((l) => l.outcome === "create").length,
    restore: lines.filter((l) => l.outcome === "restore").length,
    skip: lines.filter((l) => l.outcome === "skip").length,
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="New targets" value={counts.create} />
        <Metric label="Archived targets restored" value={counts.restore} />
        <Metric label="Already attached (skipped)" value={counts.skip} />
      </div>

      <Card className="border-[#E8E5E0]">
        <CardContent className="p-0">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#F0EEE9] text-[12px] text-muted-foreground">
                <th className="px-4 py-2 font-medium">Group</th>
                <th className="px-4 py-2 font-medium">Payer</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-b border-[#F0EEE9] last:border-b-0">
                  <td className="px-4 py-2">{l.groupName}</td>
                  <td className="px-4 py-2">{l.payerName}</td>
                  <td className="px-4 py-2">{l.state}</td>
                  <td className="px-4 py-2 text-muted-foreground">{OUTCOME_LABEL[l.outcome]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={cancelMut.isPending || commitMut.isPending}
          onClick={() =>
            cancelMut.mutate(runId, {
              onSuccess: () => {
                toast.success("Import cancelled");
                void navigate({ to: "/groups" });
              },
              onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't cancel"),
            })
          }
        >
          Cancel import
        </Button>
        <Button
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          disabled={commitMut.isPending || counts.create + counts.restore === 0}
          onClick={() => setConfirming(true)}
        >
          Commit attachments
        </Button>
      </div>

      {confirming ? (
        <Dialog open onOpenChange={(o) => !o && setConfirming(false)}>
          <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
            <DialogHeader>
              <DialogTitle>Commit payer attachments?</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              {counts.create} new {counts.create === 1 ? "target" : "targets"} will be attached
              {counts.restore > 0 ? ` and ${counts.restore} archived restored` : ""}. The org-level
              payer enablement is handled automatically.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={commitMut.isPending}
              >
                Back
              </Button>
              <Button
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                disabled={commitMut.isPending}
                onClick={() =>
                  commitMut.mutate(
                    { runId },
                    {
                      onSuccess: () => {
                        toast.success("Payer attachments committed");
                        setConfirming(false);
                      },
                      onError: (e) => toast.error(e instanceof Error ? e.message : "Commit failed"),
                    },
                  )
                }
              >
                {commitMut.isPending ? "Committing…" : "Commit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[#E8E5E0] bg-white p-4">
      <div className="text-[24px] font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[12px] text-muted-foreground">{label}</div>
    </div>
  );
}
