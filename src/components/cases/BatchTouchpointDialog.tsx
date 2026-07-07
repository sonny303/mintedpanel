// Story 8: log one payer call across several cases. Pick the payer + channel
// first, multi-select the payer's open cases, then set a per-case outcome and a
// per-case note (no shared call note). Saves one communication_event parent and
// one child touchpoint per case; "Got reference number" writes that case's
// payer_reference_id.
import { useMemo, useState } from "react";
import { format } from "date-fns";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useCasesForPayer, useLogBatchTouchpoint } from "@/hooks/useCommunicationEvents";
import { useSetPayerReference } from "@/hooks/useCases";
import {
  CHANNELS,
  outcomesForChannel,
  REFERENCE_NUMBER_OUTCOME,
  type Channel,
} from "@/lib/touchOutcomes";
import type { TouchOutcome } from "@/types";

interface RowState {
  selected: boolean;
  outcome: TouchOutcome;
  note: string;
  reference: string;
}

export function BatchTouchpointDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const payersQ = usePayers();
  const statusesQ = useStatusConfigs("credentialing");
  const logBatchM = useLogBatchTouchpoint();
  const setReferenceM = useSetPayerReference();

  const [payerId, setPayerId] = useState<string>("");
  const [channel, setChannel] = useState<Channel>("phone");
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const casesQ = useCasesForPayer(payerId || undefined);

  const openBucketById = useMemo(() => {
    const m = new Map<string, string>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s.actionBucket));
    return m;
  }, [statusesQ.data]);

  // Open = no status, or a status not in the 'complete' bucket (mirrors the app).
  const openCases = useMemo(
    () =>
      (casesQ.data ?? []).filter(
        (c) =>
          !c.credentialingStatusId || openBucketById.get(c.credentialingStatusId) !== "complete",
      ),
    [casesQ.data, openBucketById],
  );

  const defaultOutcome = outcomesForChannel(channel)[0].value;

  const resetRowsForChannel = (nextChannel: Channel) => {
    const nextDefault = outcomesForChannel(nextChannel)[0].value;
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const [id, r] of Object.entries(prev)) {
        next[id] = { ...r, outcome: nextDefault, reference: "" };
      }
      return next;
    });
  };

  const closeAndReset = () => {
    setPayerId("");
    setChannel("phone");
    setRows({});
    onClose();
  };

  const toggle = (caseId: string, checked: boolean) => {
    setRows((prev) => ({
      ...prev,
      [caseId]: checked
        ? { selected: true, outcome: defaultOutcome, note: "", reference: "" }
        : {
            ...(prev[caseId] ?? { outcome: defaultOutcome, note: "", reference: "" }),
            selected: false,
          },
    }));
  };

  const setRow = (caseId: string, patch: Partial<RowState>) => {
    setRows((prev) => ({
      ...prev,
      [caseId]: {
        ...(prev[caseId] ?? { selected: true, outcome: defaultOutcome, note: "", reference: "" }),
        ...patch,
      },
    }));
  };

  const selected = openCases.filter((c) => rows[c.caseId]?.selected);
  const canSave = Boolean(payerId) && selected.length > 0 && !logBatchM.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await logBatchM.mutateAsync({
        payerId,
        channel,
        occurredAt: format(new Date(), "yyyy-MM-dd"),
        children: selected.map((c) => {
          const r = rows[c.caseId];
          return { caseId: c.caseId, outcome: r.outcome, note: r.note.trim() || null };
        }),
      });
      // "Got reference number" writes each such case's payer_reference_id.
      const refWrites = selected
        .map((c) => ({ caseId: c.caseId, r: rows[c.caseId] }))
        .filter(({ r }) => r.outcome === REFERENCE_NUMBER_OUTCOME && r.reference.trim());
      for (const { caseId, r } of refWrites) {
        await setReferenceM.mutateAsync({ caseId, value: r.reference.trim() });
      }
      toast.success(
        `Logged call across ${selected.length} case${selected.length === 1 ? "" : "s"}`,
      );
      closeAndReset();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const activePayers = (payersQ.data ?? []).filter((p) => p.isActive);
  const statusLabel = (statusId: string | null) =>
    (statusesQ.data ?? []).find((s) => s.id === statusId)?.label ?? "No status";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeAndReset()}>
      <DialogContent className="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log payer call</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Payer
            </Label>
            <Select
              value={payerId}
              onValueChange={(v) => {
                setPayerId(v);
                setRows({});
              }}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue placeholder="Select a payer" />
              </SelectTrigger>
              <SelectContent>
                {activePayers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Channel
            </Label>
            <Select
              value={channel}
              onValueChange={(v) => {
                setChannel(v as Channel);
                resetRowsForChannel(v as Channel);
              }}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c.channel} value={c.channel}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!payerId ? (
          <p className="text-[13px] text-muted-foreground py-4">
            Pick a payer to see its open cases.
          </p>
        ) : casesQ.isLoading ? (
          <p className="text-[13px] text-muted-foreground py-4">Loading cases…</p>
        ) : openCases.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-4">No open cases for this payer.</p>
        ) : (
          <div className="space-y-2 mt-2">
            <p className="text-[12px] text-muted-foreground">
              Select the cases this call touched, then set each one’s outcome and note.
            </p>
            {openCases.map((c) => {
              const r = rows[c.caseId];
              const isSelected = Boolean(r?.selected);
              return (
                <div
                  key={c.caseId}
                  className="border border-border rounded-md p-3 space-y-2 bg-background"
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(v) => toggle(c.caseId, Boolean(v))}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-foreground">
                        {c.providerName} · {c.state}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {statusLabel(c.credentialingStatusId)}
                      </div>
                    </div>
                  </div>
                  {isSelected ? (
                    <div className="pl-6 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={r.outcome}
                          onValueChange={(v) => setRow(c.caseId, { outcome: v as TouchOutcome })}
                        >
                          <SelectTrigger className="h-8 text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {outcomesForChannel(channel).map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {r.outcome === REFERENCE_NUMBER_OUTCOME ? (
                          <Input
                            value={r.reference}
                            onChange={(e) => setRow(c.caseId, { reference: e.target.value })}
                            placeholder="Reference / submission ID"
                            className="h-8 text-[13px]"
                          />
                        ) : null}
                      </div>
                      <Textarea
                        value={r.note}
                        onChange={(e) => setRow(c.caseId, { note: e.target.value })}
                        placeholder="Note for this case…"
                        className="min-h-[56px] text-[13px] resize-none"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={closeAndReset} disabled={logBatchM.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
            onClick={handleSave}
            disabled={!canSave}
          >
            {logBatchM.isPending
              ? "Saving…"
              : `Log call${selected.length ? ` (${selected.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
