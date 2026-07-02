// Reusable inline error UI for failed TanStack Query fetches inside tables and panels.
// Renders a message plus a Retry button that calls the provided refetch callback.
import { Button } from '@/components/ui/button';

interface QueryErrorRowProps {
  colSpan: number;
  onRetry: () => void;
  message?: string;
}

export function QueryErrorRow({ colSpan, onRetry, message = 'Failed to load data.' }: QueryErrorRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center">
        <div className="text-[13px] text-foreground mb-3">{message}</div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </td>
    </tr>
  );
}

interface QueryErrorPanelProps {
  onRetry: () => void;
  message?: string;
}

export function QueryErrorPanel({ onRetry, message = 'Failed to load data.' }: QueryErrorPanelProps) {
  return (
    <div className="border border-border rounded-md p-12 text-center">
      <div className="text-[13px] text-foreground mb-3">{message}</div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
