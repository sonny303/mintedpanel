// Uniform API response envelope: every /api route returns `{ data, error, meta }`.
export interface ApiMeta {
  total?: number;
  page?: number;
  pageSize?: number;
  // Non-fatal resolution notes (e.g. a user token resolved to empty because
  // the auth metadata has no name). Advisory only; data is still complete.
  notes?: string[];
  // GET /api/providers/:id/profile only: the provider has several facilities
  // and no ?facilityId was sent, so facility.*/assignment.* tokens are empty
  // — the client must ask the user to pick; the server never guesses.
  // snake_case is the wire contract (see ProviderProfile in providerProfile.ts).
  needs_facility?: boolean;
  // POST /api/cases/:id/touches with bump_status only: whether the opt-in
  // In Progress -> Submitted transition landed. "skipped" means the touch was
  // written but the transition was rejected (illegal edge, role, concurrency);
  // status_bump_reason carries the caller-facing why. The touch itself is
  // always in `data` regardless — a skipped bump is never an error.
  status_bump?: "applied" | "skipped";
  status_bump_reason?: string;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
  meta: ApiMeta | null;
}

function jsonResponse<T>(status: number, body: ApiEnvelope<T>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function ok<T>(data: T, meta: ApiMeta | null = null, status = 200): Response {
  return jsonResponse(status, { data, error: null, meta });
}

export function fail(status: number, message: string): Response {
  return jsonResponse(status, { data: null, error: message, meta: null });
}
