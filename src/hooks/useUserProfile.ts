// The signed-in user's own profile (2026-08-16, /account).
//
// USER-scoped, not org-scoped, unlike almost every other hook here: your name
// and title are the same in every org you belong to. The key carries no org id
// so an org switch does not refetch it — but note that switching orgs calls
// queryClient.removeQueries() (auth-store setActiveOrg), which clears this too;
// that is a harmless refetch, not a correctness problem.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";
import {
  getMyProfile,
  updateMyProfile,
  type UserProfileInput,
  type UserProfileSaveResult,
} from "@/services/userProfile";
import { useAuthStore } from "@/lib/auth-store";

type ProfileMutationContext = {
  actorUserId: string | null;
  authGeneration: number;
  contextEpoch: number;
};

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
    onMutate: (): ProfileMutationContext => {
      const state = useAuthStore.getState();
      return {
        actorUserId: state.user?.id ?? null,
        authGeneration: state.authGeneration,
        contextEpoch: state.contextEpoch,
      };
    },
    onSuccess: (result: UserProfileSaveResult, _input, context) => {
      const origin = context as ProfileMutationContext | undefined;
      const current = useAuthStore.getState();
      if (
        !origin ||
        !origin.actorUserId ||
        current.user?.id !== origin.actorUserId ||
        result.id !== origin.actorUserId
      )
        return;

      toast.success("Profile saved");
      if (result.metadataSync !== "synced") {
        toast.warning(
          result.metadataSync === "skipped"
            ? "Your profile was saved, but account metadata was not updated after the session changed."
            : "Your profile was saved, but account metadata could not be mirrored.",
        );
      }

      if (
        current.authGeneration !== origin.authGeneration ||
        current.contextEpoch !== origin.contextEpoch
      ) {
        // Auth metadata writes emit USER_UPDATED and invalidate protected
        // queries. Re-read the profile after that epoch change instead of
        // repopulating a cache that was cleared for the new auth snapshot.
        const refreshStart = useAuthStore.getState();
        const refreshAuthGeneration = refreshStart.authGeneration;
        const refreshContextEpoch = refreshStart.contextEpoch;
        void getMyProfile()
          .then((freshProfile) => {
            const latest = useAuthStore.getState();
            if (
              latest.user?.id !== origin.actorUserId ||
              latest.authGeneration !== refreshAuthGeneration ||
              latest.contextEpoch !== refreshContextEpoch ||
              !freshProfile ||
              freshProfile.id !== origin.actorUserId
            )
              return;
            qc.setQueryData(queryKeys.myProfile(), freshProfile);
            if (freshProfile.fullName) {
              useAuthStore.setState({ fullName: freshProfile.fullName });
            }
          })
          .catch(() => undefined);
        return;
      }

      const { metadataSync: _metadataSync, ...profile } = result;
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
