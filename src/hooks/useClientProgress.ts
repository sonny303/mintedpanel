// Query hook for the owner-facing /client-progress page (Client Progress v1).
// Additive file: the shared queryKeys registry is untouched, so the key is
// declared inline — org-scoped like every other key.
import { useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { listClientProgressProviders } from "@/services/clientProgress";

const THIRTY_SECONDS = 30_000;

export function useClientProgressProviders() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: ["client-progress-providers", orgId] as const,
    queryFn: listClientProgressProviders,
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}
