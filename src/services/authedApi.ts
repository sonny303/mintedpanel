// The one browser -> /api fetch for sanctioned surfaces (CLAUDE.md "Data
// access"): the caller's JWT + active org, the { data, error } envelope, and
// the access-context revision check.
import { supabase } from "@/integrations/supabase/externalClient";
import { requireActiveOrg } from "@/lib/audit";
import {
  getContextRevisionSnapshot,
  observeContextRevisionForRequest,
} from "@/lib/contextRevision";

interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}

export async function authedApiFetch<T>(
  path: string,
  init?: RequestInit,
  options: { rejectStale?: boolean } = {},
): Promise<T> {
  const orgId = requireActiveOrg();
  // Capture before any asynchronous auth/session work. An auth transition
  // during getSession or response parsing must invalidate this response.
  const before = getContextRevisionSnapshot();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      "x-org-id": orgId,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (observeContextRevisionForRequest(response, before, options)) {
    throw new Error("Access context changed; retry the request");
  }
  if (!response.ok || envelope.data === null) {
    throw new Error(envelope.error ?? `Request failed (${response.status})`);
  }
  return envelope.data;
}
