// E1.6 F1.6.3 — the catalog diff review queue. Renders only when unreviewed
// sync/manual diffs await (the inbound_leads shared-queue pattern): each row
// shows payer, field, old → new; Accept applies the identity change via the
// review RPC, Reject records the decision. History rows are never edited.
import { toast } from "sonner";
import { GitCompareArrows } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCatalogChanges, useReviewCatalogChange } from "@/hooks/usePayerCatalog";
import { fmtDate } from "@/lib/format";
import type { Payer, PayerCatalogChange } from "@/types";

function ChangeRow({ change, payerName }: { change: PayerCatalogChange; payerName: string }) {
  const review = useReviewCatalogChange();

  const act = (accept: boolean) =>
    review.mutate(
      { changeId: change.id, accept },
      {
        onSuccess: () => toast.success(accept ? "Change applied" : "Change rejected"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't review the change"),
      },
    );

  return (
    <div className="rounded-md border border-[#E8E5E0] bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-foreground">{payerName}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            <span className="font-medium">{change.field}</span>:{" "}
            <span className="line-through">{change.oldValue || "(empty)"}</span>{" "}
            <span aria-hidden="true">→</span> {change.newValue || "(empty)"}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {change.source === "sync" ? "Detected by sync" : "Manual"} · {fmtDate(change.createdAt)}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8"
            disabled={review.isPending}
            onClick={() => act(false)}
          >
            Reject
          </Button>
          <Button
            type="button"
            className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={review.isPending}
            onClick={() => act(true)}
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PayerCatalogChangesPanel({ payers }: { payers: readonly Payer[] }) {
  const { data, isLoading } = useCatalogChanges();
  const unreviewed = (data ?? []).filter((c) => c.reviewState === "unreviewed");
  if (isLoading || unreviewed.length === 0) return null;

  const nameById = new Map(payers.map((p) => [p.id, p.name]));

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold text-foreground">Catalog changes to review</h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {unreviewed.length}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Sync-detected differences land here instead of overwriting the catalog. Accepting applies
          the identity change; rejecting records the decision.
        </p>
        <div className="space-y-2">
          {unreviewed.map((change) => (
            <ChangeRow
              key={change.id}
              change={change}
              payerName={nameById.get(change.payerId) ?? "Unknown payer"}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
