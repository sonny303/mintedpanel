// E6.7 F6.7.2a — payer-contact hooks (no rendered UI in E6.7; the Payer
// Detail design consumes these later). Reads are org-scoped because contact
// VISIBILITY follows the parent payer's assignment-gated RLS; mutations
// invalidate only the touched payer's contact list — the RPCs own audit.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  deletePayerContact,
  listPayerContacts,
  upsertPayerContact,
  type PayerContactInput,
} from "@/services/payerContacts";

export function usePayerContacts(payerId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.payerContacts(orgId, payerId ?? ""),
    queryFn: () => listPayerContacts(payerId as string),
    enabled: orgId !== "no-org" && Boolean(payerId),
    staleTime: FIVE_MINUTES,
  });
}

function useInvalidatePayerContacts() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return (payerId: string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.payerContacts(orgId, payerId) });
  };
}

export function useUpsertPayerContact() {
  const invalidate = useInvalidatePayerContacts();
  return useMutation({
    mutationFn: (input: PayerContactInput) => upsertPayerContact(input),
    onSuccess: (contact) => invalidate(contact.payerId),
  });
}

export function useDeletePayerContact() {
  const invalidate = useInvalidatePayerContacts();
  return useMutation({
    mutationFn: ({ id }: { id: string; payerId: string }) => deletePayerContact(id),
    onSuccess: (_void, { payerId }) => invalidate(payerId),
  });
}
