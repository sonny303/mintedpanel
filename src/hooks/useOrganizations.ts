// TanStack Query hook for the in-app organization intake (Epic 2a, E0.1). On
// success it wires the caller into the freshly-created org: refetch memberships
// (so the new org appears in the switcher and setActiveOrg will accept it), then
// reuse the store's org-switch path (setActiveOrg → queryClient.removeQueries
// resets the prior org's caches), and land INSIDE the new org's workspace.
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { createOrganization, type CreateOrganizationInput } from "@/services/organizations";

export function useCreateOrganization() {
  const navigate = useNavigate();
  const loadMemberships = useAuthStore((s) => s.loadMemberships);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) => createOrganization(input),
    onSuccess: async (orgId) => {
      // Pull the new membership into the store first; setActiveOrg only accepts
      // an org the caller is a member of, so this must precede the switch.
      await loadMemberships();
      setActiveOrg(orgId);
      // E6.1 F6.1.5 (supersedes E0.1 F0.1.5's Get-started landing): post-create
      // lands IN the one-time wizard flow, NOT back at the cross-org Portfolio.
      navigate({ to: "/onboarding/wizard" });
    },
  });
}
