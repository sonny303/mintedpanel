// The allowlisted identifiers of a thrown value (MINT-30, audit SEC-03): what
// a server log may say about an error. Never its text. A PostgREST error's
// `details` is the rejected row and its `message` can quote an input, so only
// the SQLSTATE, the violated constraint's name (read from `message`, never
// `details`) and the error class survive. Pure and client-safe, so the SSR
// error boundary can use it too; src/server/safeLog.ts builds the /api log
// line on top of it.

// A Postgres SQLSTATE (5 characters) or a PostgREST PGRSTnnn code.
const ERROR_CODE_RE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;
// Postgres names the constraint in the primary message of a class-23
// (integrity) violation. Only a lowercase identifier is accepted; every
// constraint in supabase/migrations is one.
const CONSTRAINT_RE =
  /violates (?:check|unique|foreign key|exclusion) constraint "([a-z_][a-z0-9_]{0,62})"/;
const CLASS_NAME_RE = /^[A-Za-z_$][\w$]{0,63}$/;

export interface ErrorIdentifiers {
  errorClass: string;
  sqlstate?: string;
  constraint?: string;
}

function errorClassOf(error: unknown): string {
  if (error === null) return "null";
  if (typeof error !== "object") return typeof error;
  const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === "string" && CLASS_NAME_RE.test(name) ? name : "Object";
}

export function describeError(error: unknown): ErrorIdentifiers {
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
