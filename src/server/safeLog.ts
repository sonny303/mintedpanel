// Allowlisted server error logging for the nitro /api boundary (MINT-30,
// audit SEC-03).
//
// A PostgREST error reaches route code as a parsed plain object. Its `details`
// is Postgres's "Failing row contains (...)", the rejected row's own values
// with PHI included, and its `message` can quote an input back ("invalid input
// syntax for type date: ..."). So a thrown value is never logged as it is.
// Each fault becomes one JSON line of identifiers that cannot carry row data:
// the SQLSTATE, the violated constraint's name (read from `message`, never
// `details`), the error class, the route template and method, and a
// correlation id that the client also receives as `x-request-id`.
//
// A dev server (`import.meta.env.DEV`) also passes the raw error, so a local
// stack trace survives. Production builds compile that branch out.

export const REQUEST_ID_HEADER = "x-request-id";

// A Postgres SQLSTATE (5 characters) or a PostgREST PGRSTnnn code.
const ERROR_CODE_RE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;
// Postgres names the constraint in the primary message of a class-23
// (integrity) violation. Only a lowercase identifier is accepted; every
// constraint in supabase/migrations is one.
const CONSTRAINT_RE =
  /violates (?:check|unique|foreign key|exclusion) constraint "([a-z_][a-z0-9_]{0,62})"/;
const CLASS_NAME_RE = /^[A-Za-z_$][\w$]{0,63}$/;
// A path segment is logged only when it is a static lowercase route word. Ids,
// tokens and anything else a caller typed collapse to `:param`.
const ROUTE_WORD_RE = /^[a-z][a-z-]{0,39}$/;
const METHOD_RE = /^[A-Z]{1,10}$/;
const MAX_ROUTE_SEGMENTS = 12;

export interface ErrorLogSite {
  method: string;
  route: string;
}

export interface SafeErrorLog extends ErrorLogSite {
  requestId: string;
  errorClass: string;
  sqlstate?: string;
  constraint?: string;
}

export function routeTemplate(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).slice(0, MAX_ROUTE_SEGMENTS);
  return `/${segments.map((s) => (ROUTE_WORD_RE.test(s) ? s : ":param")).join("/")}`;
}

/** A request reduced to its method and route template; never the query. */
export function requestSite(request: Request): ErrorLogSite {
  const method = request.method.toUpperCase();
  return {
    method: METHOD_RE.test(method) ? method : "OTHER",
    route: routeTemplate(new URL(request.url).pathname),
  };
}

function errorClassOf(error: unknown): string {
  if (error === null) return "null";
  if (typeof error !== "object") return typeof error;
  const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === "string" && CLASS_NAME_RE.test(name) ? name : "Object";
}

/** The allowlisted identifiers of a thrown value. Never its text. */
export function describeError(
  error: unknown,
): Pick<SafeErrorLog, "errorClass" | "sqlstate" | "constraint"> {
  const errorClass = errorClassOf(error);
  if (typeof error !== "object" || error === null) return { errorClass };
  const { code, message } = error as { code?: unknown; message?: unknown };
  const sqlstate = typeof code === "string" && ERROR_CODE_RE.test(code) ? code : undefined;
  const constraint =
    sqlstate?.startsWith("23") && typeof message === "string"
      ? CONSTRAINT_RE.exec(message)?.[1]
      : undefined;
  return {
    errorClass,
    ...(sqlstate ? { sqlstate } : {}),
    ...(constraint ? { constraint } : {}),
  };
}

/** Log a server fault as allowlisted fields only. Returns the correlation id
 *  so the caller can hand it to the client with `withRequestId`. */
export function logServerError(scope: string, error: unknown, site: ErrorLogSite): string {
  const requestId = crypto.randomUUID();
  const entry: SafeErrorLog = { requestId, ...site, ...describeError(error) };
  if (import.meta.env.DEV) console.error(scope, JSON.stringify(entry), error);
  else console.error(scope, JSON.stringify(entry));
  return requestId;
}

export function withRequestId(response: Response, requestId: string): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}
