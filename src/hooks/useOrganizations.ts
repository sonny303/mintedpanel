// TanStack Query hook for the in-app organization intake (Epic 2a). On success
// it wires the caller into the freshly-created org: refetch memberships (so the
// new org appears in the switcher and setActiveOrg will accept it), then reuse
// the store's org-switch path (setActiveOrg → queryClient.removeQueries resets
// the prior org's caches), and land on Home.
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { createOrganization } from "@/services/organizations";

export function useCreateOrganization() {
  const navigate = useNavigate();
  const loadMemberships = useAuthStore((s) => s.loadMemberships);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  return useMutation({
    mutationFn: (name: string) => createOrganization(name),
    onSuccess: async (orgId) => {
      // Pull the new membership into the store first; setActiveOrg only accepts
      // an org the caller is a member of, so this must precede the switch.
      await loadMemberships();
      setActiveOrg(orgId);
      // Redesign E0.0: land on the Portfolio (the new front door) after intake.
      navigate({ to: "/portfolio" });
    },
  });
}
