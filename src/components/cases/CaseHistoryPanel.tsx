// Status history card on the case detail page (both tracks combined).
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import { History } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import type { StatusConfig, StatusHistoryEntry } from '@/types';

export function CaseHistoryPanel({
  history,
  statusById,
}: {
  history: StatusHistoryEntry[];
  statusById: Map<string, StatusConfig>;
}) {
  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
        <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" /> Status History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {history.length === 0 ? (
          <div className="p-6">
            <EmptyState message="No changes yet" />
          </div>
        ) : (
          <ul className="space-y-3 text-[13px]">
            {history.map((h) => {
              const from = h.fromStatusId ? statusById.get(h.fromStatusId)?.label ?? '—' : '—';
              const to = h.toStatusId ? statusById.get(h.toStatusId)?.label ?? '—' : '—';
              return (
                <li key={h.id} className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-foreground">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-2">
                        {h.track}
                      </span>
                      {from} → <span className="font-medium">{to}</span>
                    </div>
                    {h.changedByName ? (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        by {h.changedByName}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted-foreground text-right shrink-0 tabular-nums">
                    {fmtDateTime(h.changedAt)}
                  </div>
                </li>
              );
            })}

          </ul>
        )}
      </CardContent>
    </Card>
  );
}
