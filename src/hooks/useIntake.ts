// 2026-10-20 — TanStack Query wrappers for the provider self-onboarding intake
// RPCs (anon path). Mirrors the useSsnVault hook pattern.
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  requestIntakeCode,
  submitIntake,
  validateProviderIntakeToken,
  verifyIntakeCode,
} from "@/services/intake";
import type { IntakeSubmitResult, IntakeVerifyResult } from "@/types";

export function useValidateProviderIntakeToken(token: string | undefined) {
  return useQuery({
    queryKey: ["provider-intake-token", token],
    queryFn: () => validateProviderIntakeToken(token ?? ""),
    enabled: Boolean(token),
    retry: false,
    staleTime: 0,
  });
}

export function useRequestIntakeCode() {
  return useMutation({
    mutationFn: (token: string) => requestIntakeCode(token),
  });
}

export function useVerifyIntakeCode() {
  return useMutation({
    mutationFn: ({ token, code }: { token: string; code: string }) =>
      verifyIntakeCode(token, code),
  });
}

export function useSubmitIntake() {
  return useMutation<
    IntakeSubmitResult,
    Error,
    { sessionToken: string; payload: Record<string, unknown> }
  >({
    mutationFn: ({ sessionToken, payload }) => submitIntake(sessionToken, payload),
  });
}

export type { IntakeVerifyResult };
