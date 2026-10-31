// MINT-82 (RC-07) — the Luna-scale synthetic organization: identity, ownership
// and target guards. Mirrors scripts/uat/uat-fixture.mjs. Pure apart from
// node:crypto; nothing here opens a connection.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ids as uatIds, psqlEnvironment } from "../uat/uat-fixture.mjs";

export { psqlEnvironment };

export const LUNA_FIXTURE_VERSION = "2026-10-30.1";
export const LUNA_ORG_NAME = "Luna Demo (synthetic)";

export const STAGING_PROJECT_REF = "vmznysvietfaddakkegt";
export const STAGING_POOLER_HOST = "aws-0-ca-central-1.pooler.supabase.com";
export const PRODUCTION_PROJECT_REF = "fkvuhfsqcmujywzgczmc";
export const STAGING_CLUSTER = "7662742571317219726";
export const PRODUCTION_CLUSTER = "7642734024280108049";

/** Same shape as the UAT fixture's OWNERSHIP_MARKER, under its own key. It is
 * written into the jsonb receipts (audit_log.after) the seed leaves. */
export const LUNA_OWNERSHIP_MARKER = Object.freeze({
  minted_luna_scale_fixture: Object.freeze({ version: LUNA_FIXTURE_VERSION }),
});

// Every row id is self-certifying: its last 12 hex digits are a salted hash of
// its first 20. The teardown and verifier recognise seed rows from the id
// alone, so they need no copy of the parameters a run used, and a row someone
// adds through the app (a random v4 id) passes with probability 2^-48.
const ID_NAMESPACE = "minted-luna-scale";
export const ID_TAG_SALT = "minted-luna-scale-tag:v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function ownershipTag(prefix20) {
  return sha256Hex(`${ID_TAG_SALT}:${prefix20}`).slice(0, 12);
}

/** Deterministic v4-shaped id for (kind, key). Version-independent, so a
 * teardown written for one fixture version still removes another's rows. */
export function lunaUuid(kind, key) {
  const h = sha256Hex(`${ID_NAMESPACE}:${kind}:${key}`);
  const prefix = `${h.slice(0, 12)}4${h.slice(13, 16)}a${h.slice(17, 20)}`;
  const hex = prefix + ownershipTag(prefix);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isLunaOwnedId(id) {
  if (typeof id !== "string" || !UUID_RE.test(id)) return false;
  const hex = id.replaceAll("-", "");
  return hex.slice(20) === ownershipTag(hex.slice(0, 20));
}

/** The SQL twin of isLunaOwnedId. Built-in sha256() (PostgreSQL 11+), so it
 * needs no extension. Pinned against the JS rule in luna-scale.test.mjs. */
export function ownedIdSqlPredicate(column) {
  return `(right(replace(${column}::text, '-', ''), 12) = left(encode(sha256(convert_to('${ID_TAG_SALT}:' || left(replace(${column}::text, '-', ''), 20), 'UTF8')), 'hex'), 12))`;
}

export const LUNA_ORG_ID = lunaUuid("organization", 1);

// ---------- synthetic identifiers ----------

/** CMS NPI check digit: Luhn over the 80840 card-issuer prefix (the rule in
 * src/lib/rosterTransforms.ts isValidNpi and MINT-7's providerIdentity.ts). */
export function npiCheckDigit(first9) {
  if (!/^\d{9}$/.test(first9)) throw new Error("NPI payload must be nine digits");
  const prefixed = `80840${first9}`;
  let sum = 0;
  let double = true;
  for (let index = prefixed.length - 1; index >= 0; index -= 1) {
    let digit = Number(prefixed[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

// Synthetic NPI prefixes. Real NPIs begin with 1 or 2; NPPES has issued the
// 1-series. These sit high in the 2-series. They were NOT checked against
// NPPES (lookups are not allowed for this fixture), so collision with a real
// number is unlikely but not proven; every holder is a synthetic row.
export const SYNTHETIC_NPI_PREFIX_INDIVIDUAL = "2999";
export const SYNTHETIC_NPI_PREFIX_ORGANIZATION = "2998";

export function syntheticNpi(prefix, serial) {
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > 99_999) {
    throw new Error("Synthetic NPI serial must be 1..99999");
  }
  const first9 = `${prefix}${String(serial).padStart(5, "0")}`;
  return `${first9}${npiCheckDigit(first9)}`;
}

// ---------- target guards ----------

const LOOPBACK = new Set(["127.0.0.1", "localhost"]);
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const POOLER_RE = /^aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com$/;

export function parseAllowedRefs(value) {
  return String(value ?? "")
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean);
}

function mentionsProduction(...values) {
  return values.some((value) => String(value).toLowerCase().includes(PRODUCTION_PROJECT_REF));
}

const DB_URL_RE = /^(?:postgres|postgresql):\/\/([^/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
const DB_HOST_RE = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/;

/**
 * Parse LUNA_DATABASE_URL into the parts psql will be handed one by one, or
 * throw. Strict on purpose: libpq splits the authority at the FIRST "@" and
 * reads a comma as a host list, while WHATWG URL splits at the LAST "@". So a
 * URL like postgresql://u:x@evil.example,y@127.0.0.1/postgres reads as local
 * to one and connects remote with the other. Refused here:
 *   - anything but exactly one raw "@" (percent-encode an "@" in a password);
 *   - any "," in the authority (host lists);
 *   - "/", "@", ",", "\" or whitespace in the user; "%" or anything but a plain
 *     hostname / IPv4 address in the host;
 *   - any path but /postgres, any query but one sslmode=require|verify-full.
 */
export function parseDatabaseUrl(raw) {
  const text = String(raw ?? "");
  const match = DB_URL_RE.exec(text);
  if (!match) {
    throw new Error("LUNA_DATABASE_URL must be postgresql://user:password@host[:port]/postgres");
  }
  const [, authority, path = "", query = "", hash = ""] = match;
  if ((authority.match(/@/g) ?? []).length !== 1) {
    throw new Error(
      "Refusing LUNA_DATABASE_URL: it must hold exactly one @ between the user and the host (percent-encode an @ in the password as %40)",
    );
  }
  if (authority.includes(",")) {
    throw new Error(
      "Refusing LUNA_DATABASE_URL: host lists (a comma in the host part) are refused",
    );
  }
  const at = authority.indexOf("@");
  const userinfo = authority.slice(0, at);
  const hostport = authority.slice(at + 1);
  const colon = userinfo.indexOf(":");
  let user;
  let password;
  try {
    user = decodeURIComponent(colon === -1 ? userinfo : userinfo.slice(0, colon));
    password = decodeURIComponent(colon === -1 ? "" : userinfo.slice(colon + 1));
  } catch {
    throw new Error(
      "Refusing LUNA_DATABASE_URL: the user or password is not valid percent-encoding",
    );
  }
  if (!user || /[/@,\\\s]/.test(user)) {
    throw new Error("Refusing LUNA_DATABASE_URL: the user must not contain / @ , \\ or spaces");
  }
  const host = DB_HOST_RE.exec(hostport.toLowerCase());
  if (!host) {
    throw new Error(
      "Refusing LUNA_DATABASE_URL: the host must be a plain hostname or IPv4 address with an optional port",
    );
  }
  if (path !== "/postgres") {
    throw new Error("LUNA_DATABASE_URL must target the PostgreSQL postgres database");
  }
  if (hash) throw new Error("Refusing LUNA_DATABASE_URL: a #fragment is not allowed");
  const parameters = [...new URLSearchParams(query.replace(/^\?/, ""))];
  if (
    parameters.length > 1 ||
    parameters.some(
      ([key, value]) => key !== "sslmode" || !["require", "verify-full"].includes(value),
    )
  ) {
    throw new Error(
      "Refusing database connection overrides: only sslmode=require or verify-full is allowed",
    );
  }
  return {
    host: host[1],
    port: host[2] ?? "",
    user,
    password,
    dbname: "postgres",
    sslmode: parameters[0]?.[1] ?? null,
  };
}

/**
 * The environment psql runs with: every inherited PG* variable stripped, then
 * the validated parts set one by one. psql is never handed the URL, so libpq
 * never parses it.
 */
export function psqlConnectionEnvironment(databaseUrl, environment = {}) {
  const connection = parseDatabaseUrl(databaseUrl);
  return {
    ...psqlEnvironment(environment),
    PGHOST: connection.host,
    ...(connection.port ? { PGPORT: connection.port } : {}),
    PGUSER: connection.user,
    PGDATABASE: connection.dbname,
    ...(connection.password ? { PGPASSWORD: connection.password } : {}),
    ...(connection.sslmode ? { PGSSLMODE: connection.sslmode } : {}),
    PGCONNECT_TIMEOUT: "15",
  };
}

/** Mask the password (and the raw URL) in any text psql or Node produced. */
export function maskConnection(text, databaseUrl) {
  let out = String(text ?? "");
  if (databaseUrl) out = out.replaceAll(databaseUrl, "<LUNA_DATABASE_URL>");
  try {
    const { password } = parseDatabaseUrl(databaseUrl);
    if (password) {
      out = out
        .replaceAll(password, "<password>")
        .replaceAll(encodeURIComponent(password), "<password>");
    }
  } catch {
    // An unparseable URL never reached psql.
  }
  return out;
}

/**
 * Classify the target or throw. Production is refused before anything else.
 * A hosted target must be the same project on both URLs and be named in the
 * LUNA_SCALE_ALLOWED_PROJECT_REFS allowlist. --local-rehearsal is a closed
 * mode: both URLs must be on 127.0.0.1 or localhost, and nothing else is
 * accepted in it, whatever the allowlist names. Without it, loopback is refused.
 */
export function assertLunaTarget({ supabaseUrl, databaseUrl, allowedRefs, allowLocal = false }) {
  if (!supabaseUrl || !databaseUrl)
    throw new Error("SUPABASE_URL and LUNA_DATABASE_URL are required");
  if (allowedRefs.some((ref) => ref === PRODUCTION_PROJECT_REF)) {
    throw new Error(
      "Refusing production: LUNA_SCALE_ALLOWED_PROJECT_REFS must never name production",
    );
  }
  if (mentionsProduction(supabaseUrl, databaseUrl)) {
    throw new Error("Refusing production: the Luna-scale seed never targets production");
  }
  let api;
  try {
    api = new URL(supabaseUrl);
  } catch {
    throw new Error("Invalid SUPABASE_URL");
  }
  if (
    api.username ||
    api.password ||
    !["http:", "https:"].includes(api.protocol) ||
    api.search ||
    api.hash ||
    !["", "/"].includes(api.pathname) ||
    (supabaseUrl.match(/@/g) ?? []).length > 0
  ) {
    throw new Error("Invalid SUPABASE_URL");
  }
  const db = parseDatabaseUrl(databaseUrl);

  const localApi = LOOPBACK.has(api.hostname);
  const localDb = LOOPBACK.has(db.host);
  if (allowLocal) {
    if (!(localApi && localDb)) {
      throw new Error(
        "Refusing --local-rehearsal: it accepts only 127.0.0.1 or localhost for both SUPABASE_URL and LUNA_DATABASE_URL",
      );
    }
    return { kind: "local", projectRef: "local" };
  }
  if (localApi || localDb) {
    throw new Error(
      localApi && localDb
        ? "Refusing local target without --local-rehearsal"
        : "Refusing unsafe target: local and hosted URLs are mixed",
    );
  }

  const apiMatch = /^([a-z0-9]+)\.supabase\.co$/.exec(api.hostname);
  if (api.protocol !== "https:" || api.port || !apiMatch || !PROJECT_REF_RE.test(apiMatch[1])) {
    throw new Error(
      "Refusing unsafe target: SUPABASE_URL must be https://<project-ref>.supabase.co",
    );
  }
  const projectRef = apiMatch[1];
  if (!(db.port === "" || db.port === "5432")) {
    throw new Error("Refusing unsafe target: the database must be reached on port 5432");
  }
  const direct = db.host === `db.${projectRef}.supabase.co` && db.user === "postgres";
  const pooled =
    POOLER_RE.test(db.host) &&
    db.user === `postgres.${projectRef}` &&
    (projectRef !== STAGING_PROJECT_REF || db.host === STAGING_POOLER_HOST);
  if (!direct && !pooled) {
    throw new Error(
      "Refusing unsafe target: the database URL is not the same project as SUPABASE_URL",
    );
  }
  if (allowedRefs.length === 0) {
    throw new Error("Refusing unsafe target: LUNA_SCALE_ALLOWED_PROJECT_REFS is empty");
  }
  if (!allowedRefs.includes(projectRef)) {
    throw new Error(
      `Refusing unsafe target: project ${projectRef} is not in LUNA_SCALE_ALLOWED_PROJECT_REFS`,
    );
  }
  return { kind: "staging", projectRef };
}

/** What the database's own pg_control_system() must answer for this target. */
export function assertDatabaseIdentity(target, identity, expectedForOtherRef) {
  if (!/^\d+$/.test(identity ?? "")) {
    throw new Error("Luna database identity preflight returned no identity");
  }
  if (identity === PRODUCTION_CLUSTER) {
    throw new Error("Refusing production: the database identity is the production cluster");
  }
  if (target.kind === "local") {
    if (identity === STAGING_CLUSTER) {
      throw new Error("Refusing local rehearsal: the database identity is hosted staging");
    }
    return identity;
  }
  const expected =
    target.projectRef === STAGING_PROJECT_REF ? STAGING_CLUSTER : expectedForOtherRef;
  if (!expected) {
    throw new Error(
      `Project ${target.projectRef} is not the pinned staging project; set LUNA_SCALE_EXPECTED_DATABASE_IDENTITY to its audited system identifier`,
    );
  }
  if (identity !== expected) {
    throw new Error("Luna database identity mismatch; re-audit the target before seeding");
  }
  return identity;
}

export function confirmationToken(action, target) {
  const verb = action === "teardown" ? "TEAR DOWN" : "SEED";
  return `${verb} LUNA SCALE ON ${target.projectRef}`;
}

export function assertConfirmation(action, target, given) {
  const expected = confirmationToken(action, target);
  if (given !== expected) {
    throw new Error(`${action} needs explicit confirmation. Re-run with --confirm "${expected}"`);
  }
}

// ---------- member access ----------

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const MEMBER_ROLES = ["admin", "specialist", "billing"];
/** UAT persona orgs: adding one of their users here breaks the UAT verifier's
 * "cannot read another organization" assertion, so the SQL refuses them too. */
export const UAT_ORGANIZATION_IDS = uatIds.organizations;
/** The isolation gate's single-org logins (scripts/verify-org-isolation.mjs
 * header, scripts/mock-api-server.mjs FIXTURES). Refused even when the env
 * vars that name them are not set. */
export const ISOLATION_GATE_LOGINS = Object.freeze([
  "testkansas@minted.com",
  "testsouthpark@minted.com",
]);

/**
 * Normalise the --member-email list. Refuses the UAT personas (minted.invalid)
 * and every isolation-gate login (the two hard-coded ones, KANSAS_EMAIL,
 * SPVIEW_EMAIL, plus any LUNA_SCALE_PROTECTED_EMAILS): the gate's single-org
 * assertions fail the moment one of them belongs to a second organization.
 */
export function assertMemberEmails(emails, role, environment = {}) {
  if (!MEMBER_ROLES.includes(role)) {
    throw new Error(`--member-role must be one of ${MEMBER_ROLES.join(", ")}`);
  }
  const protectedEmails = new Set(
    [
      ...ISOLATION_GATE_LOGINS,
      environment.KANSAS_EMAIL,
      environment.SPVIEW_EMAIL,
      environment.LUNA_SCALE_PROTECTED_EMAILS,
    ]
      .flatMap((value) => String(value ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const out = [];
  for (const raw of emails) {
    const email = String(raw).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error(`Invalid --member-email: ${raw}`);
    if (email.endsWith("@minted.invalid")) {
      throw new Error("Refusing a UAT persona as a Luna member; use your own staging login");
    }
    if (protectedEmails.has(email)) {
      throw new Error(
        "Refusing an isolation-gate login as a Luna member; the gate needs it single-org",
      );
    }
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

export function membershipId(email) {
  return lunaUuid("membership", email.toLowerCase());
}

/** True when this file is the process entry point. realpath on both sides, so
 * a path with spaces (percent-encoded in the URL) or a symlinked checkout
 * still runs main() instead of exiting 0 having done nothing. */
export function isEntryPoint(argv1, moduleUrl) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
