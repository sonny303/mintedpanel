// Provider intake (slice 1). The provider has no Supabase login and no org, so
// this service calls /api/intake/* directly and skips requireActiveOrg() — the
// third such service (CLAUDE.md "Known warts"). The session is an HttpOnly
// cookie the browser sends on same-origin requests; nothing here stores it.

interface Envelope<T> {
  data: T | null;
  error: string | null;
}

async function intakeFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`/api/intake/${path}`, {
    ...init,
    credentials: "same-origin",
    headers: init.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => ({ data: null, error: null }))) as Envelope<T>;
  return { status: response.status, body };
}

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export interface IntakeLink {
  practiceName: string;
  email: string;
}

/** Null when the link is unknown, expired or revoked (one answer for all three). */
export async function readIntakeLink(token: string): Promise<IntakeLink | null> {
  const { status, body } = await intakeFetch<IntakeLink>("link", post({ t: token }));
  if (status === 404) return null;
  if (!body.data) throw new Error(body.error ?? `Request failed (${status})`);
  return body.data;
}

export async function requestIntakeCode(token: string): Promise<void> {
  const { status, body } = await intakeFetch<{ sent: boolean }>("code", post({ t: token }));
  if (!body.data) throw new Error(body.error ?? `Request failed (${status})`);
}

/** True when the code opened a session; false for any wrong, expired or used code. */
export async function openIntakeSession(token: string, code: string): Promise<boolean> {
  const { status, body } = await intakeFetch<{ signedIn: boolean }>(
    "session",
    post({ t: token, code }),
  );
  if (status === 400) return false;
  if (!body.data) throw new Error(body.error ?? `Request failed (${status})`);
  return true;
}

export interface IntakeMe {
  practiceName: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Null when there is no live session for this link. */
export async function readIntakeMe(token: string): Promise<IntakeMe | null> {
  const { status, body } = await intakeFetch<IntakeMe>("me", post({ t: token }));
  if (status === 401) return null;
  if (!body.data) throw new Error(body.error ?? `Request failed (${status})`);
  return body.data;
}

export async function signOutIntake(): Promise<void> {
  await intakeFetch("signout", post({}));
}
