// E6.2 F6.2.5 — enrollment-fact hooks. The board and the candidate buffer
// derive from this one org-scoped cache; create/expire invalidate it and the
// audit log, and everything else (Active pills, suppressed candidates, the
// buffer banner) re-derives with zero further writes.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  createEnrollmentFact,
  expireEnrollmentFact,
  listEnrollmentFacts,
  type EnrollmentFactInput,
} from "@/services/enrollmentFacts";

export function useEnrollmentFacts() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.enrollmentFacts(orgId),
    queryFn: listEnrollmentFacts,
    enabled: orgId !== "no-org",
  });
}

function useInvalidateFacts() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.enrollmentFacts(orgId) });
    qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
  };
}

export function useCreateEnrollmentFact() {
  const invalidate = useInvalidateFacts();
  return useMutation({
    mutationFn: (input: EnrollmentFactInput) => createEnrollmentFact(input),
    onSuccess: invalidate,
  });
}

export function useExpireEnrollmentFact() {
  const invalidate = useInvalidateFacts();
  return useMutation({
    mutationFn: (id: string) => expireEnrollmentFact(id),
    onSuccess: invalidate,
  });
}
