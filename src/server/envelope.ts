// Uniform API response envelope: every /api route returns `{ data, error, meta }`.
export interface ApiMeta {
  total?: number;
  page?: number;
  pageSize?: number;
  // Non-fatal resolution notes (e.g. a user token resolved to empty because
  // the auth metadata has no name). Advisory only; data is still complete.
  notes?: string[];
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
