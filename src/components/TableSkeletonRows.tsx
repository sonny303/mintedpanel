// Renders skeleton placeholder rows inside a <tbody> for consistent loading states.
// Mirrors the skeleton markup used on the case list page.

import { Skeleton } from '@/components/ui/skeleton';

interface TableSkeletonRowsProps {
  rows: number;
  cols: number;
}

export function TableSkeletonRows({ rows, cols }: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-border h-10">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-3">
              <Skeleton className="h-4 w-20" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
