// 2026-10-20 — TanStack Query wrappers for the Admit & assign action.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitOnboarding } from "@/services/onboarding";
import type { OnboardingSubmitResult } from "@/types";

export function useSubmitOnboarding() {
  const qc = useQueryClient();
  return useMutation<OnboardingSubmitResult, Error, { providerId: string }>({
    mutationFn: ({ providerId }) => submitOnboarding(providerId),
    onSuccess: (data, vars) => {
      void qc.invalidateQueries({ queryKey: ["provider", vars.providerId] });
      void qc.invalidateQueries({ queryKey: ["providers"] });
      return data;
    },
  });
}
