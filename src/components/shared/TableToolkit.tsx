// Shared table helpers used by Providers, Cases, and Tasks pages:
// SortableTh header, ColumnPicker dropdown, useInfiniteRows client-side pager.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { TableSortState } from '@/hooks/useTablePrefs';

interface SortableThProps {
  label: string;
  sortKey: string;
  sort: TableSortState | null;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'right';
}

export function SortableTh({ label, sortKey, sort, onSort, className, align = 'left' }: SortableThProps) {
  const active = sort?.key === sortKey;
  const Icon = active ? (sort!.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={cn(
        'text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'group inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground',
          align === 'right' ? 'ml-auto' : '',
        )}
      >
        <span>{label}</span>
        <Icon
          className={cn(
            'h-3 w-3',
            active ? 'text-foreground opacity-100' : 'opacity-0 group-hover:opacity-60',
          )}
        />
      </button>
    </th>
  );
}

interface StaticThProps {
  children: React.ReactNode;
  className?: string;
}

export function StaticTh({ children, className }: StaticThProps) {
  return (
    <th
      className={cn(
        'text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9',
        className,
      )}
    >
      {children}
    </th>
  );
}

interface ColumnPickerProps<ColKey extends string> {
  columns: readonly { key: ColKey; label: string }[];
  visible: Record<ColKey, boolean>;
  onChange: (key: ColKey, visible: boolean) => void;
  lockedKeys?: readonly ColKey[];
}

export function ColumnPicker<ColKey extends string>({
  columns,
  visible,
  onChange,
  lockedKeys = [],
}: ColumnPickerProps<ColKey>) {
  const locked = new Set<string>(lockedKeys);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 gap-2">
          <Columns3 className="h-4 w-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={visible[c.key]}
            disabled={locked.has(c.key)}
            onCheckedChange={(v) => onChange(c.key, Boolean(v))}
            onSelect={(e) => e.preventDefault()}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Empty values always sort to the bottom regardless of direction.
export function compareForSort(a: string | number | null, b: string | number | null, dir: 'asc' | 'desc'): number {
  const aEmpty = a === null || a === '' || a === undefined;
  const bEmpty = b === null || b === '' || b === undefined;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const mult = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * mult;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true }) * mult;
}

interface UseInfiniteRowsArgs<T> {
  items: T[];
  pageSize?: number;
  resetKey?: string;
}

// Client-side infinite scroll. Returns the visible slice plus a sentinel ref to
// attach at the end of the table wrapper. Resets when resetKey changes.
export function useInfiniteRows<T>({ items, pageSize = 50, resetKey = '' }: UseInfiniteRowsArgs<T>) {
  const [count, setCount] = useState(pageSize);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCount(pageSize);
    setLoadingMore(false);
  }, [resetKey, pageSize]);

  const visible = useMemo(() => items.slice(0, count), [items, count]);
  const hasMore = count < items.length;

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLoadingMore(true);
          // small delay so the spinner is visible during rapid scroll
          setTimeout(() => {
            setCount((c) => Math.min(c + pageSize, items.length));
            setLoadingMore(false);
          }, 120);
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length, pageSize]);

  return { visible, hasMore, loadingMore, sentinelRef, total: items.length };
}

interface InfiniteScrollSentinelProps {
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  loadingMore: boolean;
}

export function InfiniteScrollSentinel({ sentinelRef, hasMore, loadingMore }: InfiniteScrollSentinelProps) {
  if (!hasMore) return null;
  return (
    <div ref={sentinelRef} className="h-10 flex items-center justify-center text-[12px] text-muted-foreground">
      {loadingMore ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
          Loading more…
        </span>
      ) : null}
    </div>
  );
}
