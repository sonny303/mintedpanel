// TanStack Query hook for the signed-in user's own profile (display name).
// No cache invalidation: nothing queries the auth user; the auth store picks
// up the change via supabase-js's USER_UPDATED event.
import { useMutation } from "@tanstack/react-query";
import { updateDisplayName } from "@/services/userProfile";

export function useUpdateDisplayName() {
  return useMutation({
    mutationFn: (fullName: string) => updateDisplayName(fullName),
  });
}
