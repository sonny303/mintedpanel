// E4.5 TE-8 — document-store hooks. List reads are org-scoped queries over
// the RLS metadata path; upload/download are MUTATIONS through the narrow
// server endpoints (a signed URL must never sit in the query cache — it
// expires in seconds and every issue is audited). A successful upload
// invalidates the document prefix plus the owner/case/readiness families so
// every derived surface (tables, case verification, readiness advisories)
// re-derives (TE-6/TE-8).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  getDocumentDownload,
  listGroupDocuments,
  listOrgDocuments,
  listProviderDocuments,
  listUploaderNames,
  uploadDocument,
  type UploadDocumentInput,
} from "@/services/documents";

export function useProviderDocuments(providerId: string) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.providerDocuments(orgId, providerId),
    queryFn: () => listProviderDocuments(providerId),
    enabled: orgId !== "no-org" && Boolean(providerId),
    staleTime: FIVE_MINUTES,
  });
}

export function useGroupDocuments(groupId: string) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.groupDocuments(orgId, groupId),
    queryFn: () => listGroupDocuments(groupId),
    enabled: orgId !== "no-org" && Boolean(groupId),
    staleTime: FIVE_MINUTES,
  });
}

export function useOrgDocuments() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.orgDocuments(orgId),
    queryFn: listOrgDocuments,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

/** Uploader display names for the rows currently on screen (uploaded_by has
 * no FK embed — the touchlog author idiom). */
export function useDocumentUploaderNames(userIds: string[]) {
  const orgId = useActiveOrgId() ?? "no-org";
  const key = [...new Set(userIds)].filter(Boolean).sort().join(",");
  return useQuery({
    queryKey: queryKeys.documentUploaders(orgId, key),
    queryFn: () => listUploaderNames(userIds),
    enabled: orgId !== "no-org" && key.length > 0,
    staleTime: FIVE_MINUTES,
  });
}

export function useUploadDocument() {
  const orgId = useActiveOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadDocumentInput) => uploadDocument(input),
    onSuccess: () => {
      if (!orgId) return;
      // The document prefix catches provider/group/org lists at once; the
      // readiness families re-derive the advisory dimension (TE-6); case
      // detail re-derives required-document status off the same caches.
      queryClient.invalidateQueries({ queryKey: ["documents", orgId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.groupReadinessDocuments(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLog(orgId) });
    },
  });
}

/** Signed download as a mutation: issue the short-lived URL, then hand it to
 * the browser. Never cached. */
export function useDocumentDownload() {
  return useMutation({
    mutationFn: (documentId: string) => getDocumentDownload(documentId),
  });
}
