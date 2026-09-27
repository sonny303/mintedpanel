import { supabase } from "@/integrations/supabase/externalClient";
import {
  getContextRevisionSnapshot,
  observeContextRevisionForRequest,
} from "@/lib/contextRevision";
import type {
  ClientInviteResult,
  EnrollmentAudience,
  EnrollmentContext,
} from "@/services/clientAccess";

interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}

export class ClientAccessApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ClientAccessApiError";
  }
}

async function accessRequest<T>(
  path: string,
  init?: RequestInit,
  options: { rejectStale?: boolean } = {},
): Promise<T> {
  const before = getContextRevisionSnapshot();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ClientAccessApiError(401, "Your session has expired. Sign in again.");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }
  const isAuthoritativeContextSnapshot = path.includes("/api/me/access-context");
  if (isAuthoritativeContextSnapshot) {
    // Context discovery/selection carries its authoritative revision in the
    // JSON envelope. Do not compare that snapshot with the browser's current
    // revision or notify the observer here: the auth store installs it only
    // after its actor/generation checks, avoiding refresh recursion while the
    // context is still being resolved.
    const after = getContextRevisionSnapshot();
    if (after.epoch !== before.epoch) {
      throw new ClientAccessApiError(409, "Access context changed; retry the request");
    }
  } else if (observeContextRevisionForRequest(response, before, options)) {
    // Mutations retain committed one-time results while still allowing a
    // trusted revision header to trigger context refresh. Other protected
    // responses reject a response that crossed an auth/context epoch.
    throw new ClientAccessApiError(409, "Access context changed; retry the request");
  }
  if (!response.ok || !body || body.error) {
    throw new ClientAccessApiError(
      response.status,
      body?.error ?? "Unable to resolve access context",
    );
  }
  return body.data as T;
}

export function fetchEnrollmentContext(options?: {
  signal?: AbortSignal;
}): Promise<EnrollmentContext> {
  return accessRequest<EnrollmentContext>("/api/me/access-context", { signal: options?.signal });
}

export function selectEnrollmentContext(
  input: {
    audience: Exclude<EnrollmentAudience, null>;
    orgId: string;
    contextRevision: string;
  },
  options?: { signal?: AbortSignal },
): Promise<EnrollmentContext> {
  return accessRequest<EnrollmentContext>("/api/me/access-context/select", {
    method: "POST",
    body: JSON.stringify(input),
    signal: options?.signal,
  });
}

export function claimClientInvite(
  token: string,
  options?: { signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  return accessRequest<Record<string, unknown>>(
    "/api/me/client-invites/claim",
    {
      method: "POST",
      body: JSON.stringify({ token }),
      signal: options?.signal,
    },
    { rejectStale: false },
  );
}

export function createClientInvite(
  input: {
    orgId: string;
    recipientEmail: string;
    groupIds: string[];
  },
  options?: { signal?: AbortSignal },
): Promise<ClientInviteResult> {
  return accessRequest<ClientInviteResult>(
    "/api/internal/client-invites",
    {
      method: "POST",
      body: JSON.stringify(input),
      signal: options?.signal,
    },
    { rejectStale: false },
  );
}
