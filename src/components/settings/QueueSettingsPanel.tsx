// E4.2 F4.2.5 — org-level My Cases queue ranking settings. The admin reorders
// and enables/disables the four fixed ranking inputs; the queue derivation reads
// the saved config live (no per-case/per-user priority stored). Reordering uses
// accessible move up/down buttons (TE-10 — no drag dependency). "Reset to
// default" always available. Saving reranks every user's queue immediately.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useQueueRankingConfig,
  useResetQueueRankingConfig,
  useSaveQueueRankingConfig,
} from "@/hooks/useQueueRankingConfig";
import {
  DEFAULT_QUEUE_RANKING_ORDER,
  isDefaultOrder,
  moveGroup,
  QUEUE_RANKING_GROUP_HINTS,
  QUEUE_RANKING_GROUP_LABELS,
  QUEUE_RANKING_GROUPS,
  type QueueRankingGroup,
} from "@/lib/queueSettings";

export function QueueSettingsPanel() {
  const configQ = useQueueRankingConfig();
  const saveMut = useSaveQueueRankingConfig();
  const resetMut = useResetQueueRankingConfig();

  // Local draft: enabled groups in priority order + the disabled remainder.
  const [order, setOrder] = useState<QueueRankingGroup[]>(DEFAULT_QUEUE_RANKING_ORDER);
  const [enabled, setEnabled] = useState<Set<QueueRankingGroup>>(
    new Set(DEFAULT_QUEUE_RANKING_ORDER),
  );

  useEffect(() => {
    if (configQ.data === undefined) return;
    const saved = configQ.data?.order ?? DEFAULT_QUEUE_RANKING_ORDER;
    // Show enabled (saved) groups first in their order, then disabled ones.
    const disabled = QUEUE_RANKING_GROUPS.filter((g) => !saved.includes(g));
    setOrder([...saved, ...disabled]);
    setEnabled(new Set(saved));
  }, [configQ.data]);

  if (configQ.data === undefined && configQ.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  const enabledOrder = order.filter((g) => enabled.has(g));
  const onDefault = configQ.data === null;

  const move = (index: number, delta: -1 | 1) => setOrder((o) => moveGroup(o, index, delta));

  const toggle = (g: QueueRankingGroup) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const save = () => {
    if (enabledOrder.length === 0) {
      toast.error("Keep at least one ranking input enabled.");
      return;
    }
    saveMut.mutate(enabledOrder, {
      onSuccess: () => toast.success("Queue ranking saved — every user's queue reranks now."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the ranking."),
    });
  };

  const reset = () => {
    resetMut.mutate(undefined, {
      onSuccess: () => toast.success("Reset to the default ranking."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reset the ranking."),
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Rank the inputs the My Cases queue uses. Higher rows win ties; disabled inputs are ignored.
        {onDefault ? " Currently using the shipped default." : " Currently using a custom order."}
      </p>

      <ol className="space-y-2">
        {order.map((g, i) => {
          const isEnabled = enabled.has(g);
          const enabledIndex = enabledOrder.indexOf(g);
          return (
            <li
              key={g}
              className="flex items-center gap-3 rounded-md border border-[#E8E5E0] bg-white p-3"
            >
              <Checkbox
                checked={isEnabled}
                onCheckedChange={() => toggle(g)}
                aria-label={`Enable ${QUEUE_RANKING_GROUP_LABELS[g]}`}
              />
              <div className="flex-1">
                <p
                  className={`text-[13px] font-medium ${isEnabled ? "" : "text-muted-foreground"}`}
                >
                  {QUEUE_RANKING_GROUP_LABELS[g]}
                </p>
                <p className="text-[12px] text-muted-foreground">{QUEUE_RANKING_GROUP_HINTS[g]}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={i === 0}
                  aria-label={`Move ${QUEUE_RANKING_GROUP_LABELS[g]} up`}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={i === order.length - 1}
                  aria-label={`Move ${QUEUE_RANKING_GROUP_LABELS[g]} down`}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                {isEnabled ? (
                  <span className="ml-2 w-5 text-right text-[12px] tabular-nums text-muted-foreground">
                    #{enabledIndex + 1}
                  </span>
                ) : (
                  <span className="ml-2 w-5 text-right text-[12px] text-muted-foreground">—</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-2">
        <Button
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          disabled={saveMut.isPending || isDefaultOrder(enabledOrder)}
          onClick={save}
        >
          {saveMut.isPending ? "Saving…" : "Save ranking"}
        </Button>
        <Button variant="outline" disabled={resetMut.isPending || onDefault} onClick={reset}>
          Reset to default
        </Button>
      </div>
    </div>
  );
}
