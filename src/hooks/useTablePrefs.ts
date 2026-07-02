// Load and auto-persist per-user table preferences (visible columns + sort).
// Reads on mount, debounces writes on every change. Falls back to defaults
// while loading or when no row exists.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { getTablePrefs, upsertTablePrefs, type TablePrefsPayload } from '@/services/tablePrefs';

export interface TableSortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface TablePrefsState<ColKey extends string> {
  visibleCols: Record<ColKey, boolean>;
  sort: TableSortState | null;
}

interface UseTablePrefsArgs<ColKey extends string> {
  pageKey: string;
  defaults: TablePrefsState<ColKey>;
  allKeys: readonly ColKey[];
}

export function useTablePrefs<ColKey extends string>({
  pageKey,
  defaults,
  allKeys,
}: UseTablePrefsArgs<ColKey>) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState<TablePrefsState<ColKey>>(defaults);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);

  // Load once per (user, page)
  useEffect(() => {
    let cancelled = false;
    skipNextSave.current = true;
    setLoaded(false);
    if (!userId) {
      setState(defaults);
      setLoaded(true);
      return;
    }
    getTablePrefs(pageKey)
      .then((row) => {
        if (cancelled) return;
        if (row) {
          const merged: Record<string, boolean> = { ...defaults.visibleCols };
          if (row.visibleCols) {
            for (const k of allKeys) {
              if (typeof row.visibleCols[k] === 'boolean') merged[k] = row.visibleCols[k]!;
            }
          }
          const sort: TableSortState | null =
            row.sortKey && (row.sortDir === 'asc' || row.sortDir === 'desc')
              ? { key: row.sortKey, dir: row.sortDir }
              : null;
          setState({ visibleCols: merged as Record<ColKey, boolean>, sort });
        } else {
          setState(defaults);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setState(defaults);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, pageKey]);

  // Auto-save (debounced) on every change after load
  useEffect(() => {
    if (!loaded || !userId) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload: TablePrefsPayload = {
        visibleCols: state.visibleCols as Record<string, boolean>,
        sortKey: state.sort?.key ?? null,
        sortDir: state.sort?.dir ?? null,
      };
      upsertTablePrefs(userId, pageKey, payload).catch(() => undefined);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, loaded, userId, pageKey]);

  const setVisible = useCallback((key: ColKey, visible: boolean) => {
    setState((prev) => ({ ...prev, visibleCols: { ...prev.visibleCols, [key]: visible } }));
  }, []);

  const cycleSort = useCallback((key: string) => {
    setState((prev) => {
      const cur = prev.sort;
      let next: TableSortState | null;
      if (!cur || cur.key !== key) next = { key, dir: 'asc' };
      else if (cur.dir === 'asc') next = { key, dir: 'desc' };
      else next = null;
      return { ...prev, sort: next };
    });
  }, []);

  return { state, setVisible, cycleSort, loaded };
}
