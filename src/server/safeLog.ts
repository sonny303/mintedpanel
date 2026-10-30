// Allowlisted server error logging for the nitro /api boundary (MINT-30,
// audit SEC-03).
//
// A PostgREST error reaches route code as a parsed plain object. Its `details`
// is Postgres's "Failing row contains (...)", the rejected row's own values
// with PHI included, and its `message` can quote an input back ("invalid input
// syntax for type date: ..."). So a thrown value is never logged as it is.
// Each fault becomes one JSON line of identifiers that cannot carry row data:
// the SQLSTATE, constraint name and error class (@/lib/errorIdentifiers), the
// route template and method, and a correlation id that the client also
// receives as `x-request-id`.
//
// A dev server (`import.meta.env.DEV`) also passes the raw error, so a local
// stack trace survives. Production builds compile that branch out.
import { describeError, type ErrorIdentifiers } from "@/lib/errorIdentifiers";

export const REQUEST_ID_HEADER = "x-request-id";

// The static words of the /api routes (api.ts and the route modules it
// dispatches to). A path segment is logged only when it is one of these. Ids,
// slugs and anything else a caller typed collapse to `:param`, and so does a
// word missing here: the list fails safe.
const ROUTE_WORDS: ReadonlySet<string> = new Set([
  "api",
  "access-context",
  "batch-learn",
  "caqh-attestation",
  "cases",
  "catalog",
  "claim",
  "client-access",
  "client-invites",
  "code",
  "context",
  "contracts",
  "documents",
  "download",
  "enrollment-explorer",
  "export",
  "exports",
  "fill-events",
  "finalize",
  "form-context",
  "groups",
  "health",
  "history",
  "intake",
  "internal",
  "link",
  "mappings",
  "me",
  "next-best-action",
  "orgs",
  "overrides",
  "page",
  "payer-forms",
  "portal-field-maps",
  "portals",
  "preview",
  "products",
  "profile",
  "proofs",
  "prove",
  "provider-invites",
  "providers",
  "publications",
  "report",
  "report.csv",
  "resend",
  "revoke",
  "rosters",
  "scopes",
  "select",
  "session",
  "shared-field-maps",
  "shared-portals",
  "shared-test-fills",
  "signout",
  "ssn-release",
  "steps",
  "summary",
  "targets",
  "tasks",
  "templates",
  "touches",
  "unresolved",
  "upload-intent",
  "validate",
  "view-prefs",
  "work-context",
]);
const METHOD_RE = /^[A-Z]{1,10}$/;
const MAX_ROUTE_SEGMENTS = 12;

export interface ErrorLogSite {
  method: string;
  route: string;
}

export interface SafeErrorLog extends ErrorLogSite, ErrorIdentifiers {
  requestId: string;
}

export function routeTemplate(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).slice(0, MAX_ROUTE_SEGMENTS);
  return `/${segments.map((s) => (ROUTE_WORDS.has(s) ? s : ":param")).join("/")}`;
}

/** A request reduced to its method and route template; never the query. */
export function requestSite(request: Request): ErrorLogSite {
  const method = request.method.toUpperCase();
  return {
    method: METHOD_RE.test(method) ? method : "OTHER",
    route: routeTemplate(new URL(request.url).pathname),
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
