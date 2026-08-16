// The signed-in user's own profile (2026-08-16, /account).
//
// USER-scoped, not org-scoped, unlike almost every other hook here: your name
// and title are the same in every org you belong to. The key carries no org id
// so an org switch does not refetch it — but note that switching orgs calls
// queryClient.removeQueries() (auth-store setActiveOrg), which clears this too;
// that is a harmless refetch, not a correctness problem.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";
import { getMyProfile, updateMyProfile, type UserProfileInput } from "@/services/userProfile";
import { useAuthStore } from "@/lib/auth-store";

export function useMyProfile() {
  return useQuery({
    queryKey: queryKeys.myProfile(),
    queryFn: getMyProfile,
    staleTime: FIVE_MINUTES,
  });
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UserProfileInput) => updateMyProfile(input),
    onSuccess: (profile) => {
      qc.setQueryData(queryKeys.myProfile(), profile);
      // The sidebar footer and the Org Detail Access table read `fullName` off
      // the auth store, which loads it once at boot. Push the new value in so
      // the user's own name updates immediately instead of after a reload.
      if (profile.fullName) {
        useAuthStore.setState({ fullName: profile.fullName });
      }
    },
  });
}
