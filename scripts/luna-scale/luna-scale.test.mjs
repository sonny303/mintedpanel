// MINT-82 (RC-07) — generator, SQL and guard tests for the Luna-scale seed.
// Pure: no database, no network. `npm run test:luna-scale`.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  ID_TAG_SALT,
  LUNA_ORG_ID,
  PRODUCTION_CLUSTER,
  PRODUCTION_PROJECT_REF,
  STAGING_CLUSTER,
  STAGING_PROJECT_REF,
  SYNTHETIC_NPI_PREFIX_INDIVIDUAL,
  SYNTHETIC_NPI_PREFIX_ORGANIZATION,
  UAT_ORGANIZATION_IDS,
  assertConfirmation,
  assertDatabaseIdentity,
  assertLunaTarget,
  assertMemberEmails,
  confirmationToken,
  isLunaOwnedId,
  lunaUuid,
  ownedIdSqlPredicate,
} from "./luna-fixture.mjs";
import {
  CASE_STATUS_MIX,
  CANONICAL_STATUS_CONFIGS,
  DEFAULT_LUNA_PARAMS,
  FUNNEL_STAGES,
  LUNA_TABLES,
  PROVIDER_SCENARIOS,
  buildLunaDataset,
  paramsDigest,
  planCounts,
  summarizeDataset,
  validateLunaParams,
} from "./luna-dataset.mjs";
import {
  INSERT_CHUNK_ROWS,
  TABLE_COLUMNS,
  TEARDOWN_TABLES,
  buildApplySql,
  buildTeardownSql,
  sqlLiteral,
} from "./luna-sql.mjs";
import { main, parseArgs } from "./seed-luna-scale.mjs";
import { checkSnapshot } from "./verify-luna-scale.mjs";

const ANCHOR = "2026-10-30";
const dataset = buildLunaDataset(DEFAULT_LUNA_PARAMS, { anchorDate: ANCHOR });
const { tables } = dataset;
const STAGING = { kind: "staging", projectRef: STAGING_PROJECT_REF };

// ---------- an independent reading of the rules the seed must satisfy ----------

/** Textbook Luhn over the CMS 80840 prefix: valid when the sum is 0 mod 10. */
function luhnValidNpi(npi) {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi}`.split("").map(Number).reverse();
  const sum = digits.reduce((acc, digit, index) => {
    if (index % 2 === 0) return acc + digit;
    const doubled = digit * 2;
    return acc + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return sum % 10 === 0;
}

const dayDiff = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The Provider Onboarding funnel rules (MINT-81, onboardingFunnel.ts on the
 * RC-06 branch), restated from its header comment, plus the gap that put the
 * provider there. Inputs mirror getOnboardingFunnelInput's filters. */
function classifyFunnel() {
  const licensesBy = new Map();
  for (const row of tables.state_licenses) {
    if (row.status !== null && row.status !== "active") continue;
    licensesBy.set(row.provider_id, [...(licensesBy.get(row.provider_id) ?? []), row]);
  }
  const facilityState = new Map(
    tables.facilities.filter((f) => f.is_active).map((f) => [f.id, f.state]),
  );
  const workBy = new Map();
  for (const row of tables.provider_facility_assignments) {
    const state = facilityState.get(row.facility_id);
    if (state)
      workBy.set(row.provider_id, new Set([...(workBy.get(row.provider_id) ?? []), state]));
  }
  const withCases = new Set(tables.credential_cases.map((row) => row.provider_id));
  const result = new Map();
  for (const p of tables.providers) {
    if (p.status === "terminated" || p.reference_only || p.is_test_provider) continue;
    const gaps = [];
    if (withCases.has(p.id)) {
      result.set(p.id, { stage: "credentialing", gaps });
      continue;
    }
    const licenses = (licensesBy.get(p.id) ?? []).filter((l) => /^[A-Z]{2}$/.test(l.state));
    const licenseStates = new Set(licenses.map((l) => l.state));
    const work = [...(workBy.get(p.id) ?? [])];
    if (!p.npi) gaps.push("no_npi");
    if (!p.caqh_id) gaps.push("no_caqh");
    if (!p.date_of_birth) gaps.push("no_dob");
    if (!p.ssn_last4) gaps.push("no_ssn_last4");
    if (licenses.length === 0) gaps.push("no_license");
    else if (work.some((state) => !licenseStates.has(state))) gaps.push("no_work_state_license");
    if (gaps.length > 0) {
      result.set(p.id, { stage: "profile_incomplete", gaps });
      continue;
    }
    for (const state of work.length > 0 ? work : [...licenseStates]) {
      const best = licenses
        .filter((l) => l.state === state)
        .sort(
          (a, b) =>
            Number(b.verified_status === "verified") - Number(a.verified_status === "verified") ||
            (b.expiration_date ?? "").localeCompare(a.expiration_date ?? ""),
        )[0];
      if (!best) continue;
      if (best.verified_status !== "verified") gaps.push("license_unverified");
      if (!best.expiration_date || best.expiration_date < ANCHOR) gaps.push("license_expired");
    }
    const attested = p.caqh_last_attested_date;
    const age = attested ? dayDiff(attested, ANCHOR) : null;
    if (age === null || age < 0 || age > 120) gaps.push("caqh_stale");
    if (p.verification_state === "pending_verification") gaps.push("pending_verification");
    result.set(p.id, {
      stage: gaps.length > 0 ? "awaiting_verification" : "ready_to_credential",
      gaps,
    });
  }
  return result;
}

function allRows() {
  return LUNA_TABLES.flatMap((table) => tables[table].map((row) => ({ table, row })));
}

// ---------- generator ----------

test("the dataset is deterministic for the same parameters and anchor", () => {
  const again = buildLunaDataset(DEFAULT_LUNA_PARAMS, { anchorDate: ANCHOR });
  assert.equal(JSON.stringify(again.tables), JSON.stringify(tables));
  assert.equal(again.paramsSha256, dataset.paramsSha256);
  const otherSeed = buildLunaDataset(
    { ...DEFAULT_LUNA_PARAMS, seed: "another-seed" },
    { anchorDate: ANCHOR },
  );
  assert.notEqual(
    otherSeed.tables.providers[0].last_name + otherSeed.tables.providers[1].last_name,
    tables.providers[0].last_name + tables.providers[1].last_name,
  );
  assert.notEqual(otherSeed.paramsSha256, dataset.paramsSha256);
  // A later anchor shifts dates, never ids: a re-run on another day repairs.
  const later = buildLunaDataset(DEFAULT_LUNA_PARAMS, { anchorDate: "2026-11-15" });
  assert.deepEqual(
    later.tables.providers.map((row) => row.id),
    tables.providers.map((row) => row.id),
  );
  assert.equal(later.paramsSha256, dataset.paramsSha256);
});

test("default counts match the Luna-scale brief and every count is a parameter", () => {
  const counts = planCounts(dataset);
  assert.equal(counts.organizations, 1);
  assert.equal(counts.providers, 3500);
  assert.equal(counts.provider_groups, 50);
  assert.equal(counts.facilities, 200);
  assert.equal(counts.payers, 7);
  assert.equal(new Set(tables.facilities.map((row) => row.state)).size, 25);
  assert.ok(counts.credential_cases > 3 * 1000, "cases cross the 1,000-row cap several times");
  assert.equal(counts.status_configs, 22);
  assert.equal(tables.organizations[0].name, "Luna Demo (synthetic)");

  const small = buildLunaDataset(
    { seed: "params", providers: 1234, groups: 12, locations: 40, states: 9, payers: 6 },
    { anchorDate: ANCHOR },
  );
  assert.equal(small.tables.providers.length, 1234);
  assert.equal(small.tables.provider_groups.length, 12);
  assert.equal(small.tables.facilities.length, 40);
  assert.equal(new Set(small.tables.facilities.map((row) => row.state)).size, 9);
  assert.equal(small.tables.payers.length, 6);
  // Fewer groups than states still reaches every state.
  const wide = buildLunaDataset(
    { seed: "wide", providers: 300, groups: 5, locations: 30, states: 20, payers: 8 },
    { anchorDate: ANCHOR },
  );
  assert.equal(new Set(wide.tables.facilities.map((row) => row.state)).size, 20);
});

test("parameter validation rejects counts the generator cannot honour", () => {
  assert.throws(() => validateLunaParams({ providers: 0 }), /providers/);
  assert.throws(() => validateLunaParams({ providers: 100_000 }), /providers/);
  assert.throws(() => validateLunaParams({ payers: 9 }), /payers/);
  assert.throws(() => validateLunaParams({ states: 51 }), /states/);
  assert.throws(() => validateLunaParams({ groups: 60, locations: 50 }), /locations/);
  assert.throws(() => validateLunaParams({ seed: "has space" }), /seed/);
  assert.throws(() => buildLunaDataset({}, { anchorDate: "2026-02-30" }), /calendar/);
  assert.notEqual(
    paramsDigest(validateLunaParams({ providers: 10 })),
    paramsDigest(validateLunaParams({})),
  );
});

test("every Provider Onboarding funnel stage and gap has members, as generated", () => {
  const funnel = classifyFunnel();
  const byStage = Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage, 0]));
  const gaps = new Set();
  for (const { stage, gaps: list } of funnel.values()) {
    byStage[stage] += 1;
    list.forEach((gap) => gaps.add(gap));
  }
  for (const stage of FUNNEL_STAGES) assert.ok(byStage[stage] > 0, `${stage} has members`);
  for (const gap of [
    "no_npi",
    "no_caqh",
    "no_dob",
    "no_ssn_last4",
    "no_license",
    "no_work_state_license",
    "license_unverified",
    "license_expired",
    "caqh_stale",
    "pending_verification",
  ]) {
    assert.ok(gaps.has(gap), `gap ${gap} occurs`);
  }
  // The independent classifier agrees with the scenario every provider was given.
  const stageOf = Object.fromEntries(PROVIDER_SCENARIOS.map(({ key, stage }) => [key, stage]));
  for (const [providerId, scenario] of dataset.providerScenario) {
    if (scenario === "terminated") {
      assert.equal(funnel.has(providerId), false);
      continue;
    }
    assert.equal(funnel.get(providerId).stage, stageOf[scenario] ?? "credentialing", scenario);
  }
  const summary = summarizeDataset(dataset);
  assert.equal(summary.funnel.credentialing, byStage.credentialing);
  assert.equal(summary.funnel.profile_incomplete, byStage.profile_incomplete);
});

test("NPIs pass the CMS check digit, use the documented synthetic prefixes and never repeat", () => {
  // Vectors MINT-7's tests treat as valid/invalid.
  for (const valid of ["1234567893", "1112223338", "9998887779"])
    assert.ok(luhnValidNpi(valid), valid);
  assert.equal(luhnValidNpi("1234567890"), false);
  const individual = tables.providers.map((row) => row.npi).filter(Boolean);
  const organization = tables.provider_groups.map((row) => row.npi_type2);
  for (const npi of individual) {
    assert.ok(luhnValidNpi(npi), npi);
    assert.ok(npi.startsWith(SYNTHETIC_NPI_PREFIX_INDIVIDUAL), npi);
  }
  for (const npi of organization) {
    assert.ok(luhnValidNpi(npi), npi);
    assert.ok(npi.startsWith(SYNTHETIC_NPI_PREFIX_ORGANIZATION), npi);
  }
  assert.equal(
    new Set([...individual, ...organization]).size,
    individual.length + organization.length,
  );
  assert.equal(individual.length, 3500 - summarizeDataset(dataset).scenarios.missing_npi);
});

test("ids and natural keys never collide", () => {
  const ids = allRows().map(({ row }) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  const unique = (table, key) => {
    const keys = tables[table].map(key);
    assert.equal(new Set(keys).size, keys.length, `${table} natural key`);
  };
  unique("credential_cases", (r) => `${r.provider_id}|${r.group_id}|${r.payer_id}|${r.state}`);
  unique("credential_cases", (r) => `${r.provider_id}|${r.payer_id}|${r.state}`);
  unique("provider_group_assignments", (r) => `${r.provider_id}|${r.group_id}`);
  unique("provider_facility_assignments", (r) => `${r.provider_id}|${r.facility_id}`);
  unique("payer_network_targets", (r) => `${r.group_id}|${r.payer_id}|${r.state}`);
  unique("case_facilities", (r) => `${r.case_id}|${r.facility_id}`);
  unique("state_licenses", (r) => `${r.provider_id}|${r.state}`);
  unique("status_configs", (r) => `${r.track}|${r.label}`);
  unique("enrollment_facts", (r) => `${r.provider_id}|${r.group_id}|${r.payer_id}|${r.state}`);
  unique("org_payer_assignments", (r) => r.payer_id);
  unique("providers", (r) => `${r.first_name} ${r.last_name}`);
  const primaries = (table, owner) => {
    const owners = tables[table].filter((r) => r.is_primary).map(owner);
    assert.equal(new Set(owners).size, owners.length, `${table} one primary`);
  };
  primaries("case_facilities", (r) => r.case_id);
  primaries("provider_facility_assignments", (r) => r.provider_id);
  primaries("provider_group_assignments", (r) => r.provider_id);
});

test("every row is tagged: a self-certifying id and the synthetic org", () => {
  for (const { table, row } of allRows()) {
    assert.ok(isLunaOwnedId(row.id), `${table} ${row.id}`);
    if (table !== "organizations") assert.equal(row.org_id, LUNA_ORG_ID, table);
  }
  assert.ok(isLunaOwnedId(LUNA_ORG_ID));
  for (const id of UAT_ORGANIZATION_IDS) assert.equal(isLunaOwnedId(id), false);
  let falsePositives = 0;
  for (let index = 0; index < 20_000; index += 1)
    if (isLunaOwnedId(randomUUID())) falsePositives += 1;
  assert.equal(falsePositives, 0);
  // The SQL predicate is the same rule: it salts the first 20 hex digits and
  // compares the last 12.
  const predicate = ownedIdSqlPredicate("id");
  assert.ok(
    predicate.includes(
      `convert_to('${ID_TAG_SALT}:' || left(replace(id::text, '-', ''), 20), 'UTF8')`,
    ),
  );
  assert.ok(predicate.startsWith("(right(replace(id::text, '-', ''), 12) = left(encode(sha256("));
  const hex = LUNA_ORG_ID.replaceAll("-", "");
  const tag = createHash("sha256")
    .update(`${ID_TAG_SALT}:${hex.slice(0, 20)}`)
    .digest("hex")
    .slice(0, 12);
  assert.equal(hex.slice(20), tag);
});

test("relationships stay inside the org and match the case-key rules", () => {
  const byId = (table) => new Map(tables[table].map((row) => [row.id, row]));
  const providers = byId("providers");
  const groups = byId("provider_groups");
  const facilities = byId("facilities");
  const payers = byId("payers");
  const cases = byId("credential_cases");
  const targets = new Set(
    tables.payer_network_targets.map((r) => `${r.group_id}|${r.payer_id}|${r.state}`),
  );
  const assignments = new Set(
    tables.provider_facility_assignments.map((r) => `${r.provider_id}|${r.facility_id}`),
  );
  for (const row of tables.credential_cases) {
    const facility = facilities.get(row.facility_id);
    assert.ok(
      providers.has(row.provider_id) && groups.has(row.group_id) && payers.has(row.payer_id),
    );
    assert.equal(facility.group_id, row.group_id, "the location belongs to the case's group");
    assert.equal(facility.state, row.state, "the location is in the case's state");
    assert.ok(payers.get(row.payer_id).states.includes(row.state), "the payer covers the state");
    assert.ok(
      targets.has(`${row.group_id}|${row.payer_id}|${row.state}`),
      "an active target exists",
    );
    assert.ok(assignments.has(`${row.provider_id}|${row.facility_id}`), "the provider works there");
  }
  for (const link of tables.case_facilities) {
    const parent = cases.get(link.case_id);
    assert.ok(parent);
    assert.equal(facilities.get(link.facility_id).state, parent.state);
    assert.ok(assignments.has(`${parent.provider_id}|${link.facility_id}`));
    if (link.is_primary) assert.equal(link.facility_id, parent.facility_id, "primary mirror");
  }
  for (const table of ["case_status_history", "tasks", "touches"]) {
    for (const row of tables[table]) assert.ok(cases.has(row.case_id), table);
  }
  for (const row of tables.provider_group_assignments) assert.ok(groups.has(row.group_id));
  for (const row of tables.facilities) assert.ok(groups.has(row.group_id));
  // Every case's history starts with the system seed row and ends at its status.
  const historyByCase = new Map();
  for (const row of tables.case_status_history) {
    historyByCase.set(row.case_id, [...(historyByCase.get(row.case_id) ?? []), row]);
  }
  for (const row of tables.credential_cases) {
    const chain = historyByCase.get(row.id);
    assert.equal(chain[0].from_status, null);
    assert.equal(chain[0].actor_kind, "system");
    assert.equal(chain.at(-1).to_status, row.case_status);
    for (let index = 1; index < chain.length; index += 1) {
      assert.equal(chain[index].from_status, chain[index - 1].to_status);
      assert.ok(chain[index].changed_at >= chain[index - 1].changed_at);
    }
  }
});

test("the case mix covers approved/effective, submitted, in review, not started and denied", () => {
  const statuses = new Set(tables.credential_cases.map((row) => row.case_status));
  for (const [status] of CASE_STATUS_MIX) assert.ok(statuses.has(status), status);
  const summary = summarizeDataset(dataset);
  assert.ok(summary.approvedEffective > 0 && summary.approvedAwaitingEffective > 0);
  assert.equal(new Set(tables.credential_cases.map((row) => row.payer_id)).size, 7);
});

test("the change feed has activity in the last 7, 30 and 90 days, and follow-ups in every bucket", () => {
  const { feed, followUps } = summarizeDataset(dataset);
  for (const window of ["7d", "30d", "90d"]) {
    assert.ok(feed[window].approvals > 0, `${window} approvals`);
    assert.ok(feed[window].locationLinks > 0, `${window} location links`);
    assert.ok(feed[window].licenseExpirations > 0, `${window} license expirations`);
  }
  assert.ok(feed["90d"].terminations > 0);
  assert.ok(
    feed["7d"].approvals < feed["30d"].approvals && feed["30d"].approvals < feed["90d"].approvals,
  );
  assert.ok(followUps.overdue > 0 && followUps.dueToday > 0 && followUps.upcoming > 0);
  // Approvals are user transitions with a from-status, never the system seed row.
  for (const row of tables.case_status_history.filter((r) => r.to_status === "approved")) {
    assert.equal(row.actor_kind, "user");
    assert.notEqual(row.from_status, null);
  }
});

test("touches never trip the auto-status trigger and dates never pass the anchor", () => {
  const status = new Map(tables.credential_cases.map((row) => [row.id, row.case_status]));
  const outcomes = new Set([
    "spoke_with_rep",
    "left_voicemail",
    "callback_scheduled",
    "got_reference_number",
    "sent",
    "reply_received",
    "info_requested",
    "draft_saved",
    "under_review",
    "confirmed_received",
    "no_confirmation",
    "approved",
    "denied",
  ]);
  for (const touch of tables.touches) {
    assert.equal(touch.source, "manual");
    if (touch.entry_type === "touchpoint") {
      assert.notEqual(
        status.get(touch.case_id),
        "not_started",
        "a touchpoint would auto-start the case",
      );
      assert.ok(["call", "email", "portal", "fax"].includes(touch.touch_type));
      assert.ok(outcomes.has(touch.outcome), touch.outcome);
    } else {
      assert.equal(touch.entry_type, "note");
      assert.equal(touch.touch_type, null);
    }
    assert.ok(touch.touch_date <= ANCHOR);
    if (touch.next_follow_up_date) assert.ok(touch.next_follow_up_date >= touch.touch_date);
  }
  for (const row of tables.case_status_history) assert.ok(row.changed_at.slice(0, 10) <= ANCHOR);
  for (const row of tables.credential_cases) {
    for (const key of [
      "created_at",
      "submitted_date",
      "approved_date",
      "confirmed_effective_date",
      "termination_date",
    ]) {
      if (row[key]) assert.ok(row[key].slice(0, 10) <= ANCHOR, key);
    }
  }
});

test("all personal data is obviously synthetic", () => {
  for (const row of tables.providers) {
    assert.match(row.email, /@example\.test$/);
    assert.match(row.phone, /^\(555\) 555-01\d\d$/);
    assert.ok(row.date_of_birth === null || row.date_of_birth === "1970-01-01");
    assert.ok(row.ssn_last4 === null || row.ssn_last4 === "0000");
    assert.match(
      row.home_street,
      /(Example Way|Synthetic Ave|Placeholder Rd|Fixture Ln|Sample St)$/,
    );
    assert.match(row.home_zip, /^000\d\d$/);
    assert.ok(row.caqh_id === null || /^99\d{6}$/.test(row.caqh_id));
  }
  for (const row of [...tables.facilities, ...tables.provider_groups]) {
    assert.match(row.name, /\(synthetic\)$/);
  }
  for (const row of tables.provider_groups) assert.match(row.tin, /^00\d{7}$/);
  for (const row of tables.payers) assert.match(row.name, /^Synthetic .* \(Luna demo\)$/);
  for (const row of tables.state_licenses) {
    assert.match(row.license_number, /^LUNA-SYN-[A-Z]{2}-\d{5}$/);
    if (row.verification_source_url)
      assert.match(row.verification_source_url, /^https:\/\/example\.test\//);
  }
});

test("status configs are exactly the create_organization seed", async () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  let latest = null;
  for (const name of files) {
    const text = await readFile(new URL(name, dir), "utf8");
    if (
      /FUNCTION public\.create_organization/.test(text) &&
      /INSERT INTO public\.status_configs/.test(text)
    ) {
      latest = text;
    }
  }
  assert.ok(latest, "a create_organization migration seeds status_configs");
  const block = latest.slice(latest.lastIndexOf("INSERT INTO public.status_configs"));
  const rows = [
    ...block
      .slice(0, block.indexOf(";"))
      .matchAll(/\(v_org_id, '(\w+)', +'([^']+)', +'(#[0-9A-F]{6})', +(\d+), '(\w+)'\)/g),
  ].map((m) => [m[1], m[2], m[3], Number(m[4]), m[5]]);
  assert.deepEqual(
    rows,
    CANONICAL_STATUS_CONFIGS.map((row) => [...row]),
  );
});

// ---------- SQL ----------

const applySql = buildApplySql(dataset, {
  target: STAGING,
  members: [{ email: "reviewer@example.test", role: "admin" }],
});
const teardownSql = buildTeardownSql({ target: STAGING });

test("apply SQL inserts every table in chunks under the statement limit, idempotently", () => {
  const counts = planCounts(dataset);
  for (const table of LUNA_TABLES.filter((t) => t !== "organizations")) {
    const statements = applySql.match(new RegExp(`INSERT INTO public\\.${table} \\(`, "g")) ?? [];
    assert.equal(statements.length, Math.ceil(counts[table] / INSERT_CHUNK_ROWS), table);
    assert.ok(applySql.includes(`expected ${counts[table]}'`), `${table} count is verified`);
  }
  const inserts = applySql
    .split(/(?=INSERT INTO public\.)/)
    .filter((s) => s.startsWith("INSERT INTO public."));
  for (const statement of inserts) {
    const body = statement.slice(0, statement.indexOf(";\n") + 1);
    assert.ok(Buffer.byteLength(body) < 1_000_000, "each statement stays well under a megabyte");
    if (/^INSERT INTO public\.(organizations|audit_log|memberships)/.test(statement)) continue;
    assert.match(body, /ON CONFLICT \(id\) DO NOTHING;$/);
  }
  assert.ok(applySql.includes("ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role"));
  assert.doesNotMatch(applySql, /DELETE FROM/);
  assert.doesNotMatch(applySql, /UPDATE public\.(?!organizations)/);
  // A trigger side effect (an unowned row appearing mid-apply) aborts it.
  const snapshot = applySql.indexOf("CREATE TEMP TABLE luna_unowned_before");
  const sideEffectCheck = applySql.indexOf("the database added % row(s)");
  assert.ok(snapshot > applySql.indexOf("INSERT INTO public.organizations"));
  assert.ok(snapshot < applySql.indexOf("INSERT INTO public.status_configs"));
  assert.ok(sideEffectCheck > applySql.lastIndexOf("INSERT INTO public.enrollment_facts"));
  assert.ok(sideEffectCheck < applySql.lastIndexOf("COMMIT;"));
  for (const table of LUNA_TABLES.filter((t) => t !== "organizations")) {
    assert.ok(applySql.includes(`SELECT '${table}'::text AS table_name`), table);
  }
});

test("apply SQL touches no id outside the synthetic org", () => {
  const uuids = new Set(
    applySql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g),
  );
  for (const id of uuids) {
    assert.ok(isLunaOwnedId(id) || UAT_ORGANIZATION_IDS.includes(id), `foreign id ${id}`);
  }
  // UAT org ids appear only in the member guard that refuses UAT personas.
  for (const id of UAT_ORGANIZATION_IDS) {
    assert.ok(applySql.indexOf(id) > applySql.indexOf("belongs to a UAT fixture org") - 400);
  }
});

test("both scripts refuse production, foreign identities and a missing confirmation inside SQL", () => {
  for (const sql of [applySql, teardownSql]) {
    assert.ok(sql.startsWith("-- Luna-scale"));
    assert.ok(sql.includes(`IF v_identity = '${PRODUCTION_CLUSTER}' THEN`));
    assert.ok(sql.includes(":'expected_database_identity'"));
    assert.ok(sql.includes(":'confirm_token'"));
    const firstWrite = Math.min(
      ...["INSERT INTO", "DELETE FROM", "UPDATE public."]
        .map((word) => sql.indexOf(word))
        .filter((index) => index >= 0),
    );
    assert.ok(
      sql.indexOf("pg_control_system()") < firstWrite,
      "the identity check runs before any write",
    );
    assert.ok(sql.indexOf("confirmation token mismatch") < firstWrite);
    assert.match(sql, /\nCOMMIT;\n/);
  }
  assert.ok(applySql.includes(`IS DISTINCT FROM '${confirmationToken("apply", STAGING)}'`));
  assert.ok(teardownSql.includes(`IS DISTINCT FROM '${confirmationToken("teardown", STAGING)}'`));
  const review = buildApplySql(dataset, { target: { kind: "review", projectRef: "REVIEW-ONLY" } });
  assert.ok(
    review.indexOf("RAISE EXCEPTION 'Luna-scale SQL refused: this is a review copy") <
      review.indexOf("INSERT INTO"),
  );
});

test("teardown covers every table written, child before parent, and only seed rows", () => {
  const written = [...LUNA_TABLES.filter((table) => table !== "organizations"), "memberships"];
  assert.deepEqual([...TEARDOWN_TABLES].sort(), [...written].sort());
  const position = (table) => teardownSql.indexOf(`DELETE FROM public.${table} WHERE`);
  for (const table of written) assert.ok(position(table) > 0, `${table} is deleted`);
  // child -> parent foreign keys among the seeded tables.
  const fks = [
    ["touches", "credential_cases"],
    ["touches", "tasks"],
    ["tasks", "credential_cases"],
    ["tasks", "providers"],
    ["case_status_history", "credential_cases"],
    ["case_status_history", "touches"],
    ["case_facilities", "credential_cases"],
    ["case_facilities", "facilities"],
    ["enrollment_facts", "providers"],
    ["enrollment_facts", "payers"],
    ["enrollment_facts", "provider_groups"],
    ["credential_cases", "providers"],
    ["credential_cases", "facilities"],
    ["credential_cases", "payers"],
    ["credential_cases", "provider_groups"],
    ["credential_cases", "status_configs"],
    ["state_licenses", "providers"],
    ["provider_facility_assignments", "providers"],
    ["provider_facility_assignments", "facilities"],
    ["provider_group_assignments", "providers"],
    ["provider_group_assignments", "provider_groups"],
    ["providers", "provider_groups"],
    ["payer_network_targets", "payers"],
    ["payer_network_targets", "provider_groups"],
    ["org_payer_assignments", "payers"],
    ["facilities", "provider_groups"],
  ];
  for (const [child, parent] of fks) {
    assert.ok(position(child) < position(parent), `${child} before ${parent}`);
  }
  for (const statement of teardownSql.match(/DELETE FROM public\.\w+ WHERE [^;]+;/g)) {
    assert.ok(
      statement.endsWith(`WHERE org_id = '${LUNA_ORG_ID}'::uuid AND pg_temp.luna_owned(id);`),
      statement,
    );
  }
  assert.doesNotMatch(teardownSql, /DELETE FROM public\.(organizations|audit_log|roster_)/);
  assert.match(teardownSql, /UPDATE public\.organizations SET lifecycle_state = 'inactive'/);
  assert.match(teardownSql, /refused: the synthetic org holds rows the seed did not create/);
  assert.match(
    buildTeardownSql({ target: STAGING, allowUnowned: true }),
    /luna_allow_unowned', 'true'/,
  );
  // Every column the generator writes is in the SQL column spec, and back.
  for (const table of LUNA_TABLES) {
    for (const row of tables[table])
      assert.deepEqual(Object.keys(row).sort(), Object.keys(TABLE_COLUMNS[table]).sort(), table);
  }
});

test("SQL literals escape quotes and refuse backslashes", () => {
  assert.equal(sqlLiteral("O'Hara", "text"), "'O''Hara'");
  assert.equal(sqlLiteral(null, "text"), "NULL");
  assert.equal(sqlLiteral(["AZ", "CA"], "text[]"), "ARRAY['AZ','CA']::text[]");
  assert.equal(sqlLiteral([], "text[]"), "'{}'::text[]");
  assert.equal(sqlLiteral({ a: "b'c" }, "jsonb"), `'{"a":"b''c"}'::jsonb`);
  assert.throws(() => sqlLiteral("a\\b", "text"), /backslash/);
  assert.throws(() => sqlLiteral(1.5, "int"), /integer/);
});

// ---------- target guards ----------

const direct = `postgres://postgres:x@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
const pooler = `postgres://postgres.${STAGING_PROJECT_REF}:x@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`;
const api = `https://${STAGING_PROJECT_REF}.supabase.co`;
const allowed = [STAGING_PROJECT_REF];

test("target guard accepts allowlisted staging and explicit local rehearsal only", () => {
  assert.deepEqual(
    assertLunaTarget({ supabaseUrl: api, databaseUrl: direct, allowedRefs: allowed }),
    STAGING,
  );
  assert.deepEqual(
    assertLunaTarget({
      supabaseUrl: api,
      databaseUrl: `${pooler}?sslmode=require`,
      allowedRefs: allowed,
    }),
    STAGING,
  );
  const local = {
    supabaseUrl: "http://127.0.0.1:54321",
    databaseUrl: "postgres://postgres:postgres@localhost:54322/postgres",
    allowedRefs: [],
  };
  assert.throws(() => assertLunaTarget(local), /--local-rehearsal/);
  assert.deepEqual(assertLunaTarget({ ...local, allowLocal: true }), {
    kind: "local",
    projectRef: "local",
  });
});

test("target guard refuses production outright, whatever the allowlist says", () => {
  const prodApi = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
  const prodDb = `postgres://postgres:x@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
  const prodPooler = `postgres://postgres.${PRODUCTION_PROJECT_REF}:x@aws-0-us-east-2.pooler.supabase.com:5432/postgres`;
  for (const [supabaseUrl, databaseUrl, allowedRefs] of [
    [prodApi, prodDb, [PRODUCTION_PROJECT_REF]],
    [prodApi, prodDb, allowed],
    [prodApi, prodPooler, [STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF]],
    [api, prodDb, allowed],
    [api, prodPooler, allowed],
    [api, direct, [STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF]],
  ]) {
    assert.throws(
      () => assertLunaTarget({ supabaseUrl, databaseUrl, allowedRefs }),
      /Refusing production/,
    );
  }
});

test("target guard refuses unlisted refs, mixed targets, spoofed hosts and overrides", () => {
  assert.throws(
    () => assertLunaTarget({ supabaseUrl: api, databaseUrl: direct, allowedRefs: [] }),
    /is empty/,
  );
  const other = "abcdefghijklmnopqrst";
  assert.throws(
    () =>
      assertLunaTarget({
        supabaseUrl: `https://${other}.supabase.co`,
        databaseUrl: `postgres://postgres:x@db.${other}.supabase.co/postgres`,
        allowedRefs: allowed,
      }),
    /not in LUNA_SCALE_ALLOWED_PROJECT_REFS/,
  );
  for (const databaseUrl of [
    direct.replace(".supabase.co", ".supabase.co.attacker.invalid"),
    `${direct}?host=db.other.supabase.co`,
    `${direct}?hostaddr=192.0.2.1`,
    `${direct}?sslmode=disable`,
    `${direct}#x`,
    direct.replace("/postgres", "/other"),
    direct.replace(":5432", ":6543"),
    `postgres://postgres:x@db.${other}.supabase.co:5432/postgres`,
    pooler.replace("ca-central-1", "us-west-1"),
    pooler.replace(`postgres.${STAGING_PROJECT_REF}`, "postgres.wrong"),
    "postgres://postgres:postgres@localhost:54322/postgres",
  ]) {
    assert.throws(
      () =>
        assertLunaTarget({ supabaseUrl: api, databaseUrl, allowedRefs: allowed, allowLocal: true }),
      databaseUrl,
    );
  }
  assert.throws(
    () =>
      assertLunaTarget({ supabaseUrl: `${api}/rest`, databaseUrl: direct, allowedRefs: allowed }),
    /SUPABASE_URL/,
  );
});

test("database identity must be the audited cluster and never production", () => {
  assert.throws(() => assertDatabaseIdentity(STAGING, PRODUCTION_CLUSTER), /production/);
  assert.throws(() => assertDatabaseIdentity(STAGING, "123"), /mismatch/);
  assert.equal(assertDatabaseIdentity(STAGING, STAGING_CLUSTER), STAGING_CLUSTER);
  const other = { kind: "staging", projectRef: "abcdefghijklmnopqrst" };
  assert.throws(
    () => assertDatabaseIdentity(other, "999"),
    /LUNA_SCALE_EXPECTED_DATABASE_IDENTITY/,
  );
  assert.equal(assertDatabaseIdentity(other, "999", "999"), "999");
  const local = { kind: "local", projectRef: "local" };
  assert.throws(() => assertDatabaseIdentity(local, STAGING_CLUSTER), /hosted staging/);
  assert.throws(() => assertDatabaseIdentity(local, "not a number"), /no identity/);
});

test("confirmation tokens are bound to the action and the project", () => {
  assert.equal(confirmationToken("apply", STAGING), `SEED LUNA SCALE ON ${STAGING_PROJECT_REF}`);
  assert.equal(
    confirmationToken("teardown", STAGING),
    `TEAR DOWN LUNA SCALE ON ${STAGING_PROJECT_REF}`,
  );
  assert.throws(() => assertConfirmation("apply", STAGING, null), /--confirm "SEED LUNA SCALE ON/);
  assert.throws(() => assertConfirmation("apply", STAGING, confirmationToken("teardown", STAGING)));
  assert.throws(() => assertConfirmation("apply", STAGING, "SEED LUNA SCALE ON otherproject"));
  assert.doesNotThrow(() =>
    assertConfirmation("teardown", STAGING, confirmationToken("teardown", STAGING)),
  );
});

test("member access refuses UAT personas and isolation-gate logins", () => {
  assert.deepEqual(
    assertMemberEmails([" Reviewer@Example.test ", "reviewer@example.test"], "admin"),
    ["reviewer@example.test"],
  );
  assert.throws(
    () => assertMemberEmails(["uat.admin.alpha@minted.invalid"], "admin"),
    /UAT persona/,
  );
  assert.throws(
    () =>
      assertMemberEmails(["kansas@example.test"], "admin", { KANSAS_EMAIL: "Kansas@example.test" }),
    /isolation-gate/,
  );
  assert.throws(
    () =>
      assertMemberEmails(["x@example.test"], "admin", {
        LUNA_SCALE_PROTECTED_EMAILS: "y@example.test, x@example.test",
      }),
    /isolation-gate/,
  );
  assert.throws(() => assertMemberEmails(["not-an-email"], "admin"), /Invalid/);
  assert.throws(() => assertMemberEmails([], "owner"), /--member-role/);
});

// ---------- the runner ----------

const stagingEnvironment = {
  SUPABASE_URL: api,
  LUNA_DATABASE_URL: `postgres://postgres:private-test-password@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`,
  LUNA_SCALE_ALLOWED_PROJECT_REFS: STAGING_PROJECT_REF,
  PGHOST: "production.invalid",
};

function spies(identity = STAGING_CLUSTER) {
  const calls = { identity: 0, sql: [], reports: [], files: [] };
  return {
    calls,
    deps: {
      environment: stagingEnvironment,
      today: () => ANCHOR,
      executeIdentity: async (command, args, options) => {
        calls.identity += 1;
        assert.equal(command, "psql");
        assert.ok(!Object.keys(options.env).some((key) => key.startsWith("PG")));
        return { stdout: `${identity}\n` };
      },
      runSql: async (url, sql, variables) => calls.sql.push({ url, sql, variables }),
      writeFile: async (path, text) => calls.files.push({ path, text }),
      report: (message) => calls.reports.push(message),
    },
  };
}

test("the runner never writes without a mode, a target, a confirmation and a matching identity", async () => {
  assert.throws(() => parseArgs([]), /exactly one/);
  assert.throws(() => parseArgs(["--apply", "--teardown"]), /exactly one/);
  for (const [argv, environment, pattern] of [
    [["--apply"], stagingEnvironment, /--confirm "SEED LUNA SCALE ON vmznysvietfaddakkegt"/],
    [
      ["--teardown", "--confirm", `SEED LUNA SCALE ON ${STAGING_PROJECT_REF}`],
      stagingEnvironment,
      /TEAR DOWN/,
    ],
    [
      ["--apply", "--confirm", "SEED LUNA SCALE ON fkvuhfsqcmujywzgczmc"],
      { ...stagingEnvironment, SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` },
      /Refusing production/,
    ],
    [
      ["--apply", "--confirm", "x"],
      { ...stagingEnvironment, LUNA_SCALE_ALLOWED_PROJECT_REFS: "" },
      /is empty/,
    ],
    [
      ["--apply", "--confirm", "x"],
      { ...stagingEnvironment, LUNA_DATABASE_URL: undefined },
      /required/,
    ],
  ]) {
    const { calls, deps } = spies();
    await assert.rejects(main(argv, { ...deps, environment }), pattern);
    assert.equal(calls.identity, 0, "no connection before the guards pass");
    assert.equal(calls.sql.length, 0);
  }
  for (const identity of [PRODUCTION_CLUSTER, "123456789", "garbage"]) {
    const { calls, deps } = spies(identity);
    await assert.rejects(
      main(["--apply", "--confirm", `SEED LUNA SCALE ON ${STAGING_PROJECT_REF}`], deps),
      /identity|production/,
    );
    assert.equal(calls.identity, 1);
    assert.equal(calls.sql.length, 0);
  }
});

test("a confirmed staging apply binds the observed identity and the token into psql", async () => {
  const { calls, deps } = spies();
  const token = `SEED LUNA SCALE ON ${STAGING_PROJECT_REF}`;
  await main(
    [
      "--apply",
      "--confirm",
      token,
      "--member-email",
      "reviewer@example.test",
      "--member-role",
      "specialist",
    ],
    deps,
  );
  assert.equal(calls.sql.length, 1);
  const [{ sql, variables }] = calls.sql;
  assert.deepEqual(variables, {
    expected_database_identity: STAGING_CLUSTER,
    confirm_token: token,
  });
  assert.ok(sql.includes(`IS DISTINCT FROM '${token}'`));
  assert.ok(sql.includes("lower(u.email) = 'reviewer@example.test'"));
  assert.ok(sql.includes("'specialist')\n  ON CONFLICT (org_id, user_id)"));
  assert.ok(!calls.reports.join("").includes("private-test-password"));

  const teardown = spies();
  await main(
    ["--teardown", "--confirm", `TEAR DOWN LUNA SCALE ON ${STAGING_PROJECT_REF}`],
    teardown.deps,
  );
  assert.match(teardown.calls.sql[0].sql, /DELETE FROM public\.touches WHERE/);
  assert.doesNotMatch(teardown.calls.sql[0].sql, /INSERT INTO public\.providers/);
});

test("dry-run and emit-sql never connect", async () => {
  const { calls, deps } = spies();
  const result = await main(["--dry-run"], deps);
  assert.equal(calls.identity, 0);
  assert.equal(calls.sql.length, 0);
  assert.deepEqual(result.counts, planCounts(dataset));
  const output = calls.reports.join("");
  assert.match(output, /DRY RUN \(no connection; nothing written\)/);
  assert.match(output, /providers\s+3,500/);
  assert.match(output, /target: staging vmznysvietfaddakkegt/);

  const teardown = spies();
  await main(["--dry-run", "--teardown"], teardown.deps);
  assert.match(teardown.calls.reports.join(""), /Luna-scale teardown: DRY RUN/);
  assert.equal(teardown.calls.identity + teardown.calls.sql.length, 0);

  const emitted = spies();
  await main(["--emit-sql", "/tmp/never-written.sql"], emitted.deps);
  assert.equal(emitted.calls.identity + emitted.calls.sql.length, 0);
  assert.match(emitted.calls.files[0].text, /this is a review copy/);
});

test("the verifier checks counts against the last receipt and the invariants", () => {
  const counts = planCounts(dataset);
  const owned = Object.fromEntries(
    LUNA_TABLES.filter((t) => t !== "organizations").map((t) => [t, counts[t]]),
  );
  const good = {
    org: { name: "Luna Demo (synthetic)", lifecycle_state: "active" },
    last_receipt: { event: "apply", counts },
    owned: { ...owned, memberships: 1 },
    cross_org_case_links: 0,
    cases_without_primary_location: 0,
    seed_rows_outside_org: 0,
  };
  assert.deepEqual(checkSnapshot(good), []);
  assert.match(
    checkSnapshot({ ...good, owned: { ...good.owned, providers: 3499 } }).join(),
    /providers: 3499/,
  );
  assert.match(checkSnapshot({ ...good, cross_org_case_links: 2 }).join(), /cross_org_case_links/);
  const zero = Object.fromEntries(Object.keys(good.owned).map((t) => [t, 0]));
  assert.deepEqual(
    checkSnapshot({
      ...good,
      org: { ...good.org, lifecycle_state: "inactive" },
      last_receipt: { event: "teardown" },
      owned: zero,
    }),
    [],
  );
  assert.match(
    checkSnapshot({ ...good, last_receipt: { event: "teardown" } }).join(),
    /remain after the teardown/,
  );
});
