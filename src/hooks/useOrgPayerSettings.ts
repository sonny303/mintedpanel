// E4.2 payer governance — org × payer settings hooks (org-scoped keys).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  listOrgPayerSettings,
  upsertOrgPayerSetting,
  type OrgPayerSettingInput,
} from "@/services/orgPayerSettings";
import type { OrgPayerSetting } from "@/types";

export function useOrgPayerSettings() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.orgPayerSettings(orgId),
    queryFn: listOrgPayerSettings,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

/** The one payer's org setting from the cached list (null while loading or
 * when unconfigured — the resolution seam falls back either way). */
export function useOrgPayerSetting(payerId: string | null | undefined): OrgPayerSetting | null {
  const settingsQ = useOrgPayerSettings();
  if (!payerId) return null;
  return (settingsQ.data ?? []).find((s) => s.payerId === payerId) ?? null;
}

export function useUpsertOrgPayerSetting() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: OrgPayerSettingInput) => upsertOrgPayerSetting(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgPayerSettings(orgId) }),
  });
}
