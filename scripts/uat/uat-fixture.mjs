import { createHash } from "node:crypto";

export const FIXTURE_VERSION = "2026-09-22.1";
export const STAGING_PROJECT_REF = "vmznysvietfaddakkegt";
export const CONFIRMATION_TOKEN = "REBUILD MINTED UAT FIXTURE";
export const OWNERSHIP_MARKER = { minted_uat_fixture: { version: FIXTURE_VERSION } };

export const personas = [
  {
    key: "admin_alpha",
    email: "uat.admin.alpha@minted.invalid",
    name: "UAT Admin Alpha",
    role: "admin",
    org: 1,
  },
  {
    key: "admin_beta",
    email: "uat.admin.beta@minted.invalid",
    name: "UAT Admin Beta",
    role: "admin",
    org: 2,
  },
  {
    key: "admin_gamma",
    email: "uat.admin.gamma@minted.invalid",
    name: "UAT Admin Gamma",
    role: "admin",
    org: 3,
  },
  {
    key: "specialist_alpha",
    email: "uat.specialist.alpha@minted.invalid",
    name: "UAT Specialist Alpha",
    role: "specialist",
    org: 1,
  },
];

export const counts = Object.freeze({
  organizations: 3,
  personas: 4,
  groups: 5,
  facilities: 10,
  payers: 8,
  providers: 20,
  licenses: 30,
  providerFacilities: 30,
  payerTargets: 30,
  enrollmentFacts: 20,
  cases: 50,
  deletionCases: 10,
  tasks: 100,
  touches: 60,
});

export function fixtureUuid(kind, index) {
  const digest = createHash("sha256")
    .update(`minted-uat:${FIXTURE_VERSION}:${kind}:${index}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export const ids = Object.freeze({
  organizations: Array.from({ length: counts.organizations }, (_, i) =>
    fixtureUuid("organization", i + 1),
  ),
  groups: Array.from({ length: counts.groups }, (_, i) => fixtureUuid("group", i + 1)),
  facilities: Array.from({ length: counts.facilities }, (_, i) => fixtureUuid("facility", i + 1)),
  payers: Array.from({ length: counts.payers }, (_, i) => fixtureUuid("payer", i + 1)),
  providers: Array.from({ length: counts.providers }, (_, i) => fixtureUuid("provider", i + 1)),
  licenses: Array.from({ length: counts.licenses }, (_, i) => fixtureUuid("license", i + 1)),
  providerFacilities: Array.from({ length: counts.providerFacilities }, (_, i) =>
    fixtureUuid("provider-facility", i + 1),
  ),
  payerTargets: Array.from({ length: counts.payerTargets }, (_, i) =>
    fixtureUuid("payer-target", i + 1),
  ),
  enrollmentFacts: Array.from({ length: counts.enrollmentFacts }, (_, i) =>
    fixtureUuid("enrollment", i + 1),
  ),
  cases: Array.from({ length: counts.cases }, (_, i) => fixtureUuid("case", i + 1)),
  deletionCases: Array.from({ length: counts.deletionCases }, (_, i) =>
    fixtureUuid("case", 41 + i),
  ),
  tasks: Array.from({ length: counts.tasks }, (_, i) => fixtureUuid("task", i + 1)),
  touches: Array.from({ length: counts.touches }, (_, i) => fixtureUuid("touch", i + 1)),
});

export function assertSafeTarget({ supabaseUrl, databaseUrl }) {
  const api = new URL(supabaseUrl);
  const db = new URL(databaseUrl);
  const localApi = ["127.0.0.1", "localhost", "::1"].includes(api.hostname);
  const localDb = ["127.0.0.1", "localhost", "::1"].includes(db.hostname);
  const stagingApi =
    api.protocol === "https:" && api.hostname === `${STAGING_PROJECT_REF}.supabase.co`;
  const stagingDb =
    db.hostname.includes(STAGING_PROJECT_REF) ||
    (db.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(db.username).endsWith(`.${STAGING_PROJECT_REF}`));
  if (!((localApi && localDb) || (stagingApi && stagingDb))) {
    throw new Error(
      "Refusing unsafe target: only the fixed staging project or loopback local Supabase is allowed",
    );
  }
  if (api.username || api.password || !["http:", "https:"].includes(api.protocol)) {
    throw new Error("Invalid Supabase URL");
  }
  if (!db.protocol.startsWith("postgres")) throw new Error("UAT_DATABASE_URL must be PostgreSQL");
  return localApi ? "local" : "staging";
}

export function hasExactOwnershipMarker(user) {
  return user?.user_metadata?.minted_uat_fixture?.version === FIXTURE_VERSION;
}
