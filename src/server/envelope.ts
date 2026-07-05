// Uniform API response envelope: every /api route returns `{ data, error, meta }`.
export interface ApiMeta {
  total?: number;
  page?: number;
  pageSize?: number;
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
