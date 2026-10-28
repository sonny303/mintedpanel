// Provider intake hooks. Not org-scoped: the provider has no org context, and
// these keys never enter a persisted cache.
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  openIntakeSession,
  readIntakeLink,
  readIntakeMe,
  requestIntakeCode,
} from "@/services/intake";

export function useIntakeLink(token: string) {
  return useQuery({
    queryKey: ["intake-link", token],
    queryFn: () => readIntakeLink(token),
    retry: false,
    staleTime: Infinity,
  });
}

export function useIntakeMe(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ["intake-me", token],
    queryFn: () => readIntakeMe(token),
    enabled,
    retry: false,
  });
}

export function useRequestIntakeCode() {
  return useMutation({ mutationFn: (token: string) => requestIntakeCode(token) });
}

export function useOpenIntakeSession() {
  return useMutation({
    mutationFn: (vars: { token: string; code: string }) => openIntakeSession(vars.token, vars.code),
  });
}
