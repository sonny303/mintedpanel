// Per-user table preferences (visible columns) backed by user_table_prefs via
// the existing tablePrefs service. E4.0 F4.0.2 uses it for the default-hidden,
// toggleable Tracking ID column on the Cases work view. Keyed by (user, pageKey);
// RLS scopes the row to the current user.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { getTablePrefs, upsertTablePrefs, type TablePrefsPayload } from "@/services/tablePrefs";

export function useTablePrefs(pageKey: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const key = ["table-prefs", userId ?? "anon", pageKey];

  const query = useQuery({
    queryKey: key,
    queryFn: () => getTablePrefs(pageKey),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (prefs: TablePrefsPayload) => {
      if (!userId) throw new Error("No active user for table prefs");
      return upsertTablePrefs(userId, pageKey, prefs);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    prefs: query.data ?? null,
    savePrefs: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
