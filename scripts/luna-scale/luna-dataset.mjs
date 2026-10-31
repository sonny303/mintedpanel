// MINT-82 (RC-07) — deterministic generator for the Luna-scale synthetic org.
// Same parameters + same anchor date => byte-identical rows. Pure: no clock
// read (the caller passes the anchor date), no I/O. Rows are snake_case and
// carry only the columns the seed writes; database defaults (case_number,
// case_email_token, context_version, ...) are left to the database.
import { createHash } from "node:crypto";
import {
  LUNA_FIXTURE_VERSION,
  LUNA_ORG_ID,
  LUNA_ORG_NAME,
  SYNTHETIC_NPI_PREFIX_INDIVIDUAL,
  SYNTHETIC_NPI_PREFIX_ORGANIZATION,
  lunaUuid,
  syntheticNpi,
} from "./luna-fixture.mjs";

// The first 25 are the default footprint; the rest let --states grow to 50.
export const STATE_POOL = Object.freeze([
  ["AZ", "Arizona"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["KY", "Kentucky"],
  ["MA", "Massachusetts"],
  ["MD", "Maryland"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["NC", "North Carolina"],
  ["NJ", "New Jersey"],
  ["NV", "Nevada"],
  ["NY", "New York"],
  ["OH", "Ohio"],
  ["PA", "Pennsylvania"],
  ["SC", "South Carolina"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AR", "Arkansas"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NH", "New Hampshire"],
  ["NM", "New Mexico"],
  ["ND", "North Dakota"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["RI", "Rhode Island"],
  ["SD", "South Dakota"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
]);

// Coverage is a catalog property: a payer only gets targets and cases in the
// states it lists. The first template covers every state, so every state
// always has at least one payer.
const PAYER_TEMPLATES = Object.freeze([
  ["blue", "Synthetic Blue Plan (Luna demo)", "commercial", "all"],
  ["evergreen", "Synthetic Evergreen Health (Luna demo)", "commercial", "all"],
  ["medicare-advantage", "Synthetic Medicare Advantage (Luna demo)", "medicare_advantage", "all"],
  ["medicare", "Synthetic Traditional Medicare (Luna demo)", "medicare", "all"],
  ["harbor", "Synthetic Harbor Mutual (Luna demo)", "commercial", "even"],
  ["medicaid-mco", "Synthetic Medicaid MCO (Luna demo)", "medicaid_mco", "odd"],
  ["tricare", "Synthetic TRICARE Region (Luna demo)", "tricare", "thirds"],
  ["summit", "Synthetic Summit Choice (Luna demo)", "commercial", "half"],
]);

const DISCIPLINES = Object.freeze([
  {
    key: "pt",
    weight: 0.7,
    credentials: "PT, DPT",
    taxonomy: "225100000X",
    specialty: "Physical Therapy",
  },
  {
    key: "pta",
    weight: 0.1,
    credentials: "PTA",
    taxonomy: "225200000X",
    specialty: "Physical Therapy",
  },
  {
    key: "ot",
    weight: 0.12,
    credentials: "OTR/L",
    taxonomy: "225X00000X",
    specialty: "Occupational Therapy",
  },
  {
    key: "slp",
    weight: 0.08,
    credentials: "CCC-SLP",
    taxonomy: "235Z00000X",
    specialty: "Speech-Language Pathology",
  },
]);

const FIRST_NAMES = Object.freeze(
  "Alex Arden Avery Bailey Blake Briar Cameron Casey Charlie Dakota Dana Drew Eden Ellis Elliot Emerson Finley Frankie Gray Harper Hayden Hollis Jamie Jesse Jordan Jules Kai Kendall Kerry Lane Logan Marley Micah Morgan Noel Oakley Parker Peyton Quinn Reese Remy Riley Rowan Sage Sam Shay Skyler Sloane Spencer Sutton Tatum Taylor Teagan Toby Val Wren Wynn Zion".split(
    " ",
  ),
);
// Invented two-part surnames: not drawn from any real roster.
const SURNAME_HEADS = Object.freeze(
  "Ash Bram Cor Dal Ever Fen Gal Hol Ister Jun Kel Lor Mar Nor Orin Pell Quill Ros Sel Thorn Ulm Ven Wil Yar Zel".split(
    " ",
  ),
);
const SURNAME_TAILS = Object.freeze(
  "bridge by cott dale den field ford gate hart holm ley mere more ridge shaw stead ton vale wick worth".split(
    " ",
  ),
);
const STREETS = Object.freeze([
  "Example Way",
  "Synthetic Ave",
  "Placeholder Rd",
  "Fixture Ln",
  "Sample St",
]);
const CITIES = Object.freeze(["Testville", "Sampleton", "Mockford", "Demoburg", "Fixtureport"]);

// The Provider Onboarding funnel (MINT-81, src/lib/onboardingFunnel.ts on the
// RC-06 branch) has four stages; the scenarios below put members in each and in
// every gap the funnel names. Weights are fractions of --providers; every
// scenario is guaranteed at least one provider when there are enough of them.
export const PROVIDER_SCENARIOS = Object.freeze([
  { key: "missing_npi", stage: "profile_incomplete", weight: 0.02 },
  { key: "missing_caqh", stage: "profile_incomplete", weight: 0.02 },
  { key: "missing_dob", stage: "profile_incomplete", weight: 0.02 },
  { key: "missing_ssn_last4", stage: "profile_incomplete", weight: 0.02 },
  { key: "no_license", stage: "profile_incomplete", weight: 0.02 },
  { key: "missing_work_state_license", stage: "profile_incomplete", weight: 0.02 },
  { key: "license_unverified", stage: "awaiting_verification", weight: 0.025 },
  { key: "license_expired", stage: "awaiting_verification", weight: 0.025 },
  { key: "caqh_stale", stage: "awaiting_verification", weight: 0.025 },
  { key: "pending_verification", stage: "awaiting_verification", weight: 0.025 },
  { key: "ready", stage: "ready_to_credential", weight: 0.08 },
  { key: "terminated", stage: "terminated", weight: 0.01 },
  // credentialing takes the remainder.
]);
export const FUNNEL_STAGES = Object.freeze([
  "profile_incomplete",
  "awaiting_verification",
  "ready_to_credential",
  "credentialing",
]);

export const CASE_STATUS_MIX = Object.freeze([
  ["approved", 0.34],
  ["submitted", 0.16],
  ["in_review", 0.14],
  ["not_started", 0.14],
  ["in_progress", 0.1],
  ["denied", 0.07],
  ["action_required", 0.05],
]);
const OPEN_STATUSES = new Set(["in_progress", "submitted", "in_review", "action_required"]);
const PIPELINE_MIRROR = Object.freeze({
  not_started: "not_started",
  in_progress: "drafting",
  submitted: "submitted",
  in_review: "in_review",
  action_required: "action_required",
  approved: "approved",
  denied: "denied",
});
// src/lib/caseStatus.ts's canonical -> legacy credentialing label mirror.
const LEGACY_LABEL_MIRROR = Object.freeze({
  not_started: "Not Started",
  in_progress: "In Progress",
  submitted: "Submitted",
  in_review: "Submitted",
  action_required: "Waiting on Provider",
  approved: "Approved",
  denied: "Denied",
});

// The 22 canonical rows create_organization seeds (latest body:
// supabase/migrations/20260925035408_e612_client_access_context.sql).
export const CANONICAL_STATUS_CONFIGS = Object.freeze([
  ["credentialing", "Not Started", "#9CA3AF", 5, "ours"],
  ["credentialing", "In-Network", "#059669", 10, "complete"],
  ["credentialing", "OON", "#DC2626", 20, "complete"],
  ["credentialing", "In Progress", "#2563EB", 30, "ours"],
  ["credentialing", "Waiting on Provider", "#D97706", 31, "waiting_provider"],
  ["credentialing", "Submitted", "#0891B2", 32, "waiting_payer"],
  ["credentialing", "Approved", "#059669", 35, "complete"],
  ["credentialing", "Denied", "#DC2626", 40, "ours"],
  ["credentialing", "Not Required", "#9CA3AF", 45, "complete"],
  ["contracting", "Not Started", "#9CA3AF", 10, "ours"],
  ["contracting", "In Progress", "#2563EB", 20, "ours"],
  ["contracting", "Denied", "#DC2626", 30, "ours"],
  ["contracting", "Contracted", "#0891B2", 40, "waiting_payer"],
  ["contracting", "In-Network", "#059669", 50, "complete"],
  ["contracting", "OON", "#DC2626", 60, "complete"],
  ["location", "Prospect", "#9CA3AF", 10, "ours"],
  ["location", "Planned", "#2563EB", 20, "ours"],
  ["location", "Interviewing", "#0891B2", 30, "ours"],
  ["location", "Pending Fulfillment", "#D97706", 40, "ours"],
  ["location", "Ready for Launch", "#059669", 50, "ours"],
  ["location", "Live", "#059669", 60, "complete"],
  ["location", "Inactive", "#9CA3AF", 70, "complete"],
]);

/** Apply order: every table after the tables it references. Teardown runs it
 * backwards. `organizations` is upserted, never deleted (see the runbook). */
export const LUNA_TABLES = Object.freeze([
  "organizations",
  "status_configs",
  "payers",
  "org_payer_assignments",
  "provider_groups",
  "facilities",
  "payer_network_targets",
  "providers",
  "provider_group_assignments",
  "provider_facility_assignments",
  "state_licenses",
  "credential_cases",
  "case_facilities",
  "tasks",
  "touches",
  // After touches: case_status_history.evidence_touch_id references them.
  "case_status_history",
  "enrollment_facts",
]);

export const DEFAULT_LUNA_PARAMS = Object.freeze({
  seed: "luna-scale-2026-10-30",
  providers: 3500,
  // The ticket text says "one national group"; the planning session asked for
  // about 50 state groups, which is what Luna-like orgs look like. 50 wins.
  groups: 50,
  locations: 200,
  states: 25,
  payers: 7,
});

export function validateLunaParams(input = {}) {
  const params = { ...DEFAULT_LUNA_PARAMS, ...input };
  const int = (key, min, max) => {
    const value = params[key];
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`--${key} must be an integer from ${min} to ${max}`);
    }
  };
  if (typeof params.seed !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(params.seed)) {
    throw new Error("--seed must be 1-64 letters, digits, dots, dashes or underscores");
  }
  int("providers", 1, 99_999);
  int("groups", 1, 999);
  int("states", 1, STATE_POOL.length);
  int("locations", Math.max(params.groups, params.states), 9_999);
  int("payers", 1, PAYER_TEMPLATES.length);
  return Object.freeze({
    seed: params.seed,
    providers: params.providers,
    groups: params.groups,
    locations: params.locations,
    states: params.states,
    payers: params.payers,
  });
}

/** sha256 of the fixture version + parameters (not the anchor date): a re-run
 * with the same digest is a repair, a different digest needs a teardown. */
export function paramsDigest(params) {
  const canonical = JSON.stringify({
    version: LUNA_FIXTURE_VERSION,
    params: Object.fromEntries(
      Object.keys(params)
        .sort()
        .map((key) => [key, params[key]]),
    ),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------- deterministic randomness and dates ----------

function seedHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32, one independent stream per purpose. */
export function createPrng(seed) {
  let state = seedHash(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted(entries) {
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    shuffle(list) {
      const out = [...list];
      for (let index = out.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [out[index], out[swap]] = [out[swap], out[index]];
      }
      return out;
    },
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDay(iso) {
  if (!ISO_DATE_RE.test(iso)) throw new Error("--anchor-date must be YYYY-MM-DD");
  const [year, month, day] = iso.split("-").map(Number);
  const value = Date.UTC(year, month - 1, day);
  if (new Date(value).toISOString().slice(0, 10) !== iso) {
    throw new Error("--anchor-date must be a real calendar date");
  }
  return value / 86_400_000;
}

function isoDay(day) {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function at(day, hour, minute = 0) {
  return `${isoDay(day)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
}

const pad = (value, width) => String(value).padStart(width, "0");

/** Exact per-scenario counts (largest remainder), at least one each once the
 * roster is big enough; credentialing takes the rest. */
function allocateScenarios(total) {
  const counts = PROVIDER_SCENARIOS.map(({ key, weight }) => [key, Math.floor(weight * total)]);
  if (total >= PROVIDER_SCENARIOS.length * 2) {
    for (const entry of counts) if (entry[1] === 0) entry[1] = 1;
  }
  const assigned = counts.reduce((sum, [, count]) => sum + count, 0);
  return [...counts, ["credentialing", Math.max(0, total - assigned)]];
}

function payerCoversState(coverage, stateIndex, stateCount) {
  switch (coverage) {
    case "all":
      return true;
    case "even":
      return stateIndex % 2 === 0;
    case "odd":
      return stateIndex % 2 === 1;
    case "thirds":
      return stateIndex % 3 === 0;
    case "half":
      return stateIndex < Math.ceil(stateCount / 2);
    default:
      return false;
  }
}

// ---------- generator ----------

export function buildLunaDataset(inputParams, { anchorDate }) {
  const params = validateLunaParams(inputParams);
  const anchor = toDay(anchorDate);
  const stream = (label) => createPrng(`${params.seed}:${label}`);
  const states = STATE_POOL.slice(0, params.states).map(([code, name]) => ({ code, name }));

  const tables = Object.fromEntries(LUNA_TABLES.map((table) => [table, []]));
  const providerScenario = new Map();

  tables.organizations.push({ id: LUNA_ORG_ID, name: LUNA_ORG_NAME, lifecycle_state: "active" });

  const statusConfigIdByLabel = new Map();
  CANONICAL_STATUS_CONFIGS.forEach(([track, label, color, sortOrder, bucket], index) => {
    const id = lunaUuid("status-config", index + 1);
    if (track === "credentialing") statusConfigIdByLabel.set(label, id);
    tables.status_configs.push({
      id,
      org_id: LUNA_ORG_ID,
      track,
      label,
      color,
      sort_order: sortOrder,
      action_bucket: bucket,
    });
  });

  // Payers are ORG-SCOPED (org_id = the Luna org), so no other organization's
  // global catalog grows and nothing outside this org changes.
  const payers = PAYER_TEMPLATES.slice(0, params.payers).map(([key, name, kind, coverage]) => {
    const coveredStates = states.filter((_, index) =>
      payerCoversState(coverage, index, states.length),
    );
    return {
      id: lunaUuid("payer", key),
      key,
      name,
      kind,
      states: coveredStates.map((s) => s.code),
    };
  });
  for (const payer of payers) {
    tables.payers.push({
      id: payer.id,
      org_id: LUNA_ORG_ID,
      name: payer.name,
      payer_kind: payer.kind,
      states: payer.states,
      status: "active",
      is_active: true,
      source: "seed",
      aliases: [],
    });
    tables.org_payer_assignments.push({
      id: lunaUuid("org-payer", payer.key),
      org_id: LUNA_ORG_ID,
      payer_id: payer.id,
      status: "active",
    });
  }

  // Facilities: group g owns facilities f ≡ g (mod groups); the first half of
  // a group's facilities sit in its home state, the rest in the next state.
  const facilityCountByGroup = Array.from(
    { length: params.groups },
    (_, g) =>
      Math.floor(params.locations / params.groups) + (g < params.locations % params.groups ? 1 : 0),
  );
  const facilityStateIndex = [];
  for (let f = 0; f < params.locations; f += 1) {
    const g = f % params.groups;
    const k = Math.floor(f / params.groups);
    const offset = k >= Math.ceil(facilityCountByGroup[g] / 2) ? 1 : 0;
    facilityStateIndex.push((g + offset) % states.length);
  }
  // Coverage: every state gets at least one location.
  const covered = () => new Set(facilityStateIndex);
  for (let s = 0; s < states.length; s += 1) {
    if (covered().has(s)) continue;
    const perState = new Map();
    for (const index of facilityStateIndex) perState.set(index, (perState.get(index) ?? 0) + 1);
    for (let f = params.locations - 1; f >= 0; f -= 1) {
      if ((perState.get(facilityStateIndex[f]) ?? 0) > 1) {
        facilityStateIndex[f] = s;
        break;
      }
    }
  }

  const facilities = [];
  const facilityRng = stream("facilities");
  for (let f = 0; f < params.locations; f += 1) {
    const g = f % params.groups;
    const state = states[facilityStateIndex[f]];
    facilities.push({
      id: lunaUuid("facility", f + 1),
      serial: f + 1,
      groupIndex: g,
      state: state.code,
      effectiveDay: anchor - facilityRng.int(120, 1800),
    });
  }
  const groups = Array.from({ length: params.groups }, (_, g) => {
    const own = facilities.filter((facility) => facility.groupIndex === g);
    const home = own[0]?.state ?? states[g % states.length].code;
    const homeName = states.find((s) => s.code === home)?.name ?? home;
    return {
      id: lunaUuid("group", g + 1),
      serial: g + 1,
      home,
      homeName,
      facilities: own,
      states: [...new Set(own.map((facility) => facility.state))].sort(),
    };
  });
  for (const group of groups) {
    const serial = pad(group.serial, 2);
    tables.provider_groups.push({
      id: group.id,
      org_id: LUNA_ORG_ID,
      name: `Luna Demo ${group.homeName} Group ${serial} LLC (synthetic)`,
      tin: `00${pad(group.serial, 7)}`,
      npi_type2: syntheticNpi(SYNTHETIC_NPI_PREFIX_ORGANIZATION, group.serial),
      states: group.states,
      is_active: true,
      billing_street: `${100 + group.serial} ${STREETS[group.serial % STREETS.length]}`,
      billing_city: CITIES[group.serial % CITIES.length],
      billing_state: group.home,
      billing_zip: `000${pad(group.serial % 100, 2)}`,
      billing_phone: `(555) 555-01${pad(group.serial % 100, 2)}`,
      billing_email: `billing.group${serial}@example.test`,
      credentialing_email: `credentialing.group${serial}@example.test`,
    });
  }
  for (const facility of facilities) {
    const serial = pad(facility.serial, 3);
    tables.facilities.push({
      id: facility.id,
      org_id: LUNA_ORG_ID,
      group_id: groups[facility.groupIndex].id,
      name: `Luna Demo Clinic ${serial} (synthetic)`,
      street: `${200 + facility.serial} ${STREETS[facility.serial % STREETS.length]}`,
      city: CITIES[facility.serial % CITIES.length],
      state: facility.state,
      zip: `000${pad(facility.serial % 100, 2)}`,
      phone: `(555) 555-01${pad(facility.serial % 100, 2)}`,
      email: `clinic${serial}@example.test`,
      is_active: true,
      effective_date: isoDay(facility.effectiveDay),
    });
  }

  const payersByState = new Map(
    states.map((state) => [
      state.code,
      payers.filter((payer) => payer.states.includes(state.code)),
    ]),
  );
  for (const group of groups) {
    for (const state of group.states) {
      for (const payer of payersByState.get(state)) {
        tables.payer_network_targets.push({
          id: lunaUuid("payer-target", `${group.serial}:${state}:${payer.key}`),
          org_id: LUNA_ORG_ID,
          group_id: group.id,
          payer_id: payer.id,
          state,
          status: "active",
        });
      }
    }
  }

  // Providers.
  const scenarioPlan = allocateScenarios(params.providers);
  const scenarioSlots = stream("scenarios").shuffle(
    scenarioPlan.flatMap(([key, count]) => Array.from({ length: count }, () => key)),
  );
  const nameRng = stream("names");
  const providerRng = stream("providers");
  const usedNames = new Set();
  const providers = [];
  for (let p = 0; p < params.providers; p += 1) {
    const serial = p + 1;
    const scenario = scenarioSlots[p];
    let first;
    let last;
    for (let attempt = 0; ; attempt += 1) {
      first = nameRng.pick(FIRST_NAMES);
      last = `${nameRng.pick(SURNAME_HEADS)}${nameRng.pick(SURNAME_TAILS)}`;
      if (attempt >= 40) last = `${last}-${pad(serial, 5)}`;
      if (!usedNames.has(`${first} ${last}`)) break;
    }
    usedNames.add(`${first} ${last}`);
    const discipline = providerRng.weighted(DISCIPLINES.map((d) => [d, d.weight]));
    const primary = facilities[p % facilities.length];
    const group = groups[primary.groupIndex];
    const others = group.facilities.filter((facility) => facility.id !== primary.id);
    const second = others.length > 0 && providerRng.chance(0.2) ? providerRng.pick(others) : null;
    providers.push({
      id: lunaUuid("provider", serial),
      serial,
      scenario,
      first,
      last,
      discipline,
      group,
      primary,
      second,
      workStates: [...new Set([primary.state, second?.state].filter(Boolean))],
    });
    providerScenario.set(lunaUuid("provider", serial), scenario);
  }

  const licenseRng = stream("licenses");
  for (const provider of providers) {
    const { serial, scenario, discipline } = provider;
    const id = provider.id;
    const isCredentialing = scenario === "credentialing" || scenario === "terminated";
    const preCredentialing = !isCredentialing;
    const startDay = preCredentialing
      ? anchor + providerRng.int(-30, 45)
      : anchor - providerRng.int(60, 1500);
    provider.startDay = startDay;
    const caqhAttested =
      scenario === "caqh_stale"
        ? anchor - providerRng.int(121, 400)
        : anchor - providerRng.int(1, 110);
    tables.providers.push({
      id,
      org_id: LUNA_ORG_ID,
      group_id: provider.group.id,
      first_name: provider.first,
      last_name: provider.last,
      credentials: discipline.credentials,
      npi:
        scenario === "missing_npi" ? null : syntheticNpi(SYNTHETIC_NPI_PREFIX_INDIVIDUAL, serial),
      specialty: discipline.specialty,
      taxonomy_code: discipline.taxonomy,
      status: scenario === "terminated" ? "terminated" : preCredentialing ? "onboarding" : "active",
      terminated_date: scenario === "terminated" ? isoDay(anchor - providerRng.int(10, 200)) : null,
      verification_state: scenario === "pending_verification" ? "pending_verification" : "verified",
      reference_only: false,
      is_test_provider: false,
      start_date: isoDay(startDay),
      caqh_id: scenario === "missing_caqh" ? null : `99${pad(serial, 6)}`,
      caqh_last_attested_date: scenario === "missing_caqh" ? null : isoDay(caqhAttested),
      // Obviously fake on purpose: the epoch date and an SSN serial (0000) the
      // SSA never issues. The funnel needs presence, not a value.
      date_of_birth: scenario === "missing_dob" ? null : "1970-01-01",
      ssn_last4: scenario === "missing_ssn_last4" ? null : "0000",
      email: `${provider.first}.${provider.last}.${pad(serial, 5)}@example.test`.toLowerCase(),
      phone: `(555) 555-01${pad(serial % 100, 2)}`,
      home_street: `${10 + (serial % 900)} ${STREETS[serial % STREETS.length]}`,
      home_city: CITIES[serial % CITIES.length],
      home_state: provider.primary.state,
      home_zip: `000${pad(serial % 100, 2)}`,
    });

    tables.provider_group_assignments.push({
      id: lunaUuid("provider-group", serial),
      org_id: LUNA_ORG_ID,
      provider_id: id,
      group_id: provider.group.id,
      is_primary: true,
      start_date: isoDay(Math.min(startDay, anchor - 1)),
    });
    for (const [slot, facility] of [
      ["primary", provider.primary],
      ["second", provider.second],
    ]) {
      if (!facility) continue;
      tables.provider_facility_assignments.push({
        id: lunaUuid("provider-facility", `${serial}:${slot}`),
        org_id: LUNA_ORG_ID,
        provider_id: id,
        facility_id: facility.id,
        is_primary: slot === "primary",
        start_date: isoDay(Math.min(startDay, anchor - 1)),
      });
    }

    let licenseStates = provider.workStates;
    if (scenario === "no_license") licenseStates = [];
    if (scenario === "missing_work_state_license") {
      licenseStates = [
        states.find((state) => !provider.workStates.includes(state.code))?.code ?? "WY",
      ];
    }
    const expiredRecently = isCredentialing && licenseRng.chance(0.015);
    const expiringSoon = isCredentialing && !expiredRecently && licenseRng.chance(0.05);
    licenseStates.forEach((state, index) => {
      const isPrimary = index === 0;
      let expirationDay = anchor + licenseRng.int(91, 900);
      if (isPrimary && (scenario === "license_expired" || expiredRecently)) {
        expirationDay = anchor - licenseRng.int(1, 85);
      } else if (isPrimary && expiringSoon) {
        expirationDay = anchor + licenseRng.int(5, 90);
      }
      const verified = scenario !== "license_unverified";
      tables.state_licenses.push({
        id: lunaUuid("license", `${serial}:${state}`),
        org_id: LUNA_ORG_ID,
        provider_id: id,
        state,
        license_number: `LUNA-SYN-${state}-${pad(serial, 5)}`,
        license_type: "full",
        issue_date: isoDay(anchor - licenseRng.int(400, 4000)),
        expiration_date: isoDay(expirationDay),
        // The funnel reads status null/active, so an expired date keeps
        // "active" here: that is the row the funnel must catch.
        status: "active",
        verified_status: verified ? "verified" : "unverified",
        verified_at: verified ? at(anchor - licenseRng.int(1, 300), 12) : null,
        verification_source_url: verified ? "https://example.test/license-verification" : null,
      });
    });
  }

  // Cases, their history, locations, tasks, touches and enrollment facts.
  const caseRng = stream("cases");
  const touchRng = stream("touches");
  let caseSerial = 0;
  for (const provider of providers) {
    if (provider.scenario !== "credentialing" && provider.scenario !== "terminated") continue;
    const terminatedDate = tables.providers[provider.serial - 1].terminated_date;
    const plans = [];
    provider.workStates.forEach((state, index) => {
      const eligible = caseRng.shuffle(payersByState.get(state));
      const want =
        index === 0
          ? caseRng.weighted([
              [1, 0.25],
              [2, 0.35],
              [3, 0.25],
              [4, 0.15],
            ])
          : caseRng.weighted([
              [1, 0.6],
              [2, 0.4],
            ]);
      const facility = state === provider.primary.state ? provider.primary : provider.second;
      for (const payer of eligible.slice(0, Math.min(want, eligible.length))) {
        plans.push({ state, payer, facility });
      }
    });
    for (const plan of plans) {
      caseSerial += 1;
      const status =
        provider.scenario === "terminated"
          ? caseRng.weighted([
              ["approved", 0.7],
              ["denied", 0.3],
            ])
          : caseRng.weighted(CASE_STATUS_MIX);
      emitCase(provider, plan, status, caseSerial, terminatedDate);
    }
  }

  function emitCase(provider, plan, status, serial, terminatedDate) {
    const caseId = lunaUuid("case", serial);
    // Work backwards from the latest event so no date lands after the anchor.
    const t = {};
    switch (status) {
      case "not_started":
        t.created = anchor - caseRng.int(0, 60);
        break;
      case "in_progress":
        t.started = anchor - caseRng.int(1, 40);
        break;
      case "submitted":
        t.submitted = anchor - caseRng.int(1, 60);
        break;
      case "in_review":
        t.inReview = anchor - caseRng.int(1, 45);
        break;
      case "action_required":
        t.actionRequired = anchor - caseRng.int(1, 30);
        break;
      case "approved":
        // Change-feed spread: 6% inside 7 days, 14% inside 30, 25% inside 90.
        t.closed =
          anchor -
          caseRng.weighted([
            [caseRng.int(0, 6), 0.06],
            [caseRng.int(7, 29), 0.14],
            [caseRng.int(30, 89), 0.25],
            [caseRng.int(90, 700), 0.55],
          ]);
        break;
      case "denied":
        t.closed = anchor - caseRng.int(1, 300);
        break;
      default:
        throw new Error(`Unknown case status ${status}`);
    }
    // A terminated provider's cases closed before the termination.
    if (terminatedDate && t.closed !== undefined) {
      t.closed = Math.min(t.closed, toDay(terminatedDate) - caseRng.int(30, 400));
    }
    if (t.closed !== undefined) t.inReview = t.closed - caseRng.int(10, 60);
    if (t.actionRequired !== undefined) t.submitted = t.actionRequired - caseRng.int(5, 30);
    if (t.inReview !== undefined) t.submitted = t.inReview - caseRng.int(5, 20);
    if (t.submitted !== undefined) t.started = t.submitted - caseRng.int(3, 25);
    if (t.started !== undefined) t.created = t.started - caseRng.int(1, 6);

    const chain = [[null, "not_started", t.created, "system"]];
    if (t.started !== undefined) chain.push(["not_started", "in_progress", t.started, "system"]);
    if (t.submitted !== undefined) chain.push(["in_progress", "submitted", t.submitted, "user"]);
    if (status === "action_required")
      chain.push(["submitted", "action_required", t.actionRequired, "user"]);
    if (t.inReview !== undefined) chain.push(["submitted", "in_review", t.inReview, "user"]);
    if (status === "approved" || status === "denied")
      chain.push(["in_review", status, t.closed, "user"]);

    let confirmedEffective = null;
    let expectedEffective = null;
    let termination = null;
    if (status === "approved") {
      if (caseRng.chance(0.8)) confirmedEffective = Math.min(anchor, t.closed + caseRng.int(0, 14));
      else expectedEffective = t.closed + caseRng.int(15, 45);
      if (terminatedDate) {
        termination = toDay(terminatedDate);
      } else if (confirmedEffective !== null && caseRng.chance(0.015)) {
        const day = anchor - caseRng.int(0, 85);
        if (day > confirmedEffective) termination = day;
      }
    }
    const reachedSubmission = t.submitted !== undefined;
    tables.credential_cases.push({
      id: caseId,
      org_id: LUNA_ORG_ID,
      provider_id: provider.id,
      group_id: provider.group.id,
      facility_id: plan.facility.id,
      payer_id: plan.payer.id,
      state: plan.state,
      specialty: provider.discipline.specialty,
      case_status: status,
      payer_pipeline_state: PIPELINE_MIRROR[status],
      credentialing_status_id: statusConfigIdByLabel.get(LEGACY_LABEL_MIRROR[status]) ?? null,
      submitted_date: reachedSubmission ? isoDay(t.submitted) : null,
      approved_date: status === "approved" ? isoDay(t.closed) : null,
      confirmed_effective_date: confirmedEffective === null ? null : isoDay(confirmedEffective),
      expected_effective_date: expectedEffective === null ? null : isoDay(expectedEffective),
      termination_date: termination === null ? null : isoDay(termination),
      payer_reference_id: reachedSubmission ? `SYN-REF-${pad(serial, 6)}` : null,
      payer_individual_provider_id: status === "approved" ? `SYN-PID-${pad(serial, 6)}` : null,
      created_at: at(t.created, 14),
      updated_at: at(chain[chain.length - 1][2], 15, 30),
    });

    chain.forEach(([from, to, day, actor], index) => {
      tables.case_status_history.push({
        id: lunaUuid("case-history", `${serial}:${index}`),
        org_id: LUNA_ORG_ID,
        case_id: caseId,
        from_status: from,
        to_status: to,
        actor_kind: actor,
        is_correction: false,
        changed_at: at(day, 15, index),
      });
    });

    tables.case_facilities.push({
      id: lunaUuid("case-facility", `${serial}:primary`),
      org_id: LUNA_ORG_ID,
      case_id: caseId,
      facility_id: plan.facility.id,
      is_primary: true,
      // FK to auth.users: no synthetic actor can satisfy it, so it stays null.
      created_by: null,
      created_at: at(t.created, 14, 1),
    });
    const sameStateSecond =
      provider.second &&
      provider.second.state === plan.state &&
      provider.second.id !== plan.facility.id
        ? provider.second
        : provider.primary.state === plan.state && provider.primary.id !== plan.facility.id
          ? provider.primary
          : null;
    if (sameStateSecond && caseRng.chance(0.6)) {
      const linked = Math.max(t.created, anchor - caseRng.int(0, 80));
      tables.case_facilities.push({
        id: lunaUuid("case-facility", `${serial}:second`),
        org_id: LUNA_ORG_ID,
        case_id: caseId,
        facility_id: sameStateSecond.id,
        is_primary: false,
        created_by: null,
        created_at: at(linked, 13),
      });
    }

    const closed = status === "approved" || status === "denied";
    tables.tasks.push({
      id: lunaUuid("task", serial),
      org_id: LUNA_ORG_ID,
      case_id: caseId,
      provider_id: provider.id,
      title:
        status === "not_started"
          ? "Submit enrollment application"
          : status === "action_required"
            ? "Resolve payer request"
            : closed
              ? "Confirm enrollment outcome"
              : "Follow up with payer",
      description: "Synthetic Luna-scale task",
      sop_content: [],
      status: status === "not_started" ? "not_started" : closed ? "completed" : "in_progress",
      sort_order: 0,
      due_date: closed ? null : isoDay(anchor + caseRng.int(-10, 20)),
      completed_date: closed ? isoDay(t.closed) : null,
      is_auto_generated: true,
      created_at: at(t.created, 14, 2),
    });

    // Touches. A touchpoint on a not_started case would fire the auto
    // in_progress trigger (trg_case_status_on_touch) and write an unowned
    // history row, so not_started cases only ever get notes.
    if (status === "not_started") {
      if (touchRng.chance(0.3)) {
        const day = Math.min(anchor, t.created + touchRng.int(0, 5));
        pushTouch(caseId, serial, 0, day, {
          entry_type: "note",
          touch_type: null,
          outcome: null,
          notes: `Synthetic intake note ${pad(serial, 6)}`,
        });
      }
      return;
    }
    const count = 1 + touchRng.int(0, 2);
    let followUp = null;
    let lastDay = t.closed;
    if (OPEN_STATUSES.has(status)) {
      // The latest touch carries the case's follow-up: overdue, due today or
      // upcoming. A follow-up never predates the touch that set it.
      const bucket = touchRng.weighted([
        ["overdue", 0.35],
        ["today", 0.1],
        ["upcoming", 0.55],
      ]);
      if (bucket === "overdue" && anchor - t.started >= 2) {
        lastDay = Math.max(t.started, anchor - touchRng.int(2, 30));
        followUp = touchRng.int(lastDay + 1, anchor - 1);
      } else if (bucket === "upcoming") {
        lastDay = Math.max(t.started, anchor - touchRng.int(0, 14));
        followUp = anchor + touchRng.int(1, 28);
      } else {
        lastDay = Math.max(t.started, anchor - touchRng.int(1, 14));
        followUp = anchor;
      }
    }
    const days = [];
    for (let index = 0; index < count - 1; index += 1) {
      days.push(t.started + Math.floor(((lastDay - t.started) * (index + 1)) / count));
    }
    days.push(lastDay);
    days.forEach((day, index) => {
      const isLast = index === days.length - 1;
      const channel = touchRng.pick(TOUCH_CHANNELS);
      let outcome = touchRng.pick(channel.outcomes);
      let touchType = channel.type;
      if (isLast && closed) {
        touchType = "email";
        outcome = status;
      }
      pushTouch(caseId, serial, index, day, {
        entry_type: "touchpoint",
        touch_type: touchType,
        outcome,
        notes: `Synthetic ${touchType} touch ${pad(serial, 6)}-${index + 1}`,
        next_follow_up_date: isLast
          ? followUp === null
            ? null
            : isoDay(followUp)
          : isoDay(days[index + 1]),
        clears_follow_up: isLast && closed,
      });
    });

    if (status === "approved" && confirmedEffective !== null && termination === null) {
      tables.enrollment_facts.push({
        id: lunaUuid("enrollment", serial),
        org_id: LUNA_ORG_ID,
        provider_id: provider.id,
        group_id: provider.group.id,
        payer_id: plan.payer.id,
        state: plan.state,
        effective_date: isoDay(confirmedEffective),
        source: "migration",
      });
    }
  }

  function pushTouch(caseId, serial, index, day, fields) {
    tables.touches.push({
      id: lunaUuid("touch", `${serial}:${index}`),
      org_id: LUNA_ORG_ID,
      case_id: caseId,
      touch_date: isoDay(day),
      source: "manual",
      next_follow_up_date: null,
      clears_follow_up: false,
      created_at: at(day, 16, index),
      ...fields,
    });
  }

  return Object.freeze({
    version: LUNA_FIXTURE_VERSION,
    params,
    paramsSha256: paramsDigest(params),
    anchorDate,
    orgId: LUNA_ORG_ID,
    tables,
    providerScenario,
  });
}

const TOUCH_CHANNELS = Object.freeze([
  {
    type: "call",
    outcomes: ["spoke_with_rep", "left_voicemail", "callback_scheduled", "got_reference_number"],
  },
  { type: "email", outcomes: ["sent", "reply_received", "info_requested"] },
  { type: "portal", outcomes: ["draft_saved", "under_review"] },
  { type: "fax", outcomes: ["confirmed_received", "no_confirmation"] },
]);

export function planCounts(dataset) {
  return Object.fromEntries(LUNA_TABLES.map((table) => [table, dataset.tables[table].length]));
}

function daysBefore(anchorDate, value) {
  return Math.round(toDay(anchorDate) - toDay(String(value).slice(0, 10)));
}

/** The human-readable mix: funnel stages, case statuses, feed windows and
 * follow-up buckets, all counted off the generated rows. */
export function summarizeDataset(dataset) {
  const { tables, anchorDate } = dataset;
  const scenarios = {};
  for (const scenario of dataset.providerScenario.values()) {
    scenarios[scenario] = (scenarios[scenario] ?? 0) + 1;
  }
  const stage = (key) =>
    PROVIDER_SCENARIOS.filter((entry) => entry.stage === key).reduce(
      (sum, entry) => sum + (scenarios[entry.key] ?? 0),
      0,
    );
  const funnel = {
    profile_incomplete: stage("profile_incomplete"),
    awaiting_verification: stage("awaiting_verification"),
    ready_to_credential: stage("ready_to_credential"),
    credentialing: scenarios.credentialing ?? 0,
    terminated_excluded: scenarios.terminated ?? 0,
  };
  const caseStatus = {};
  for (const row of tables.credential_cases) {
    caseStatus[row.case_status] = (caseStatus[row.case_status] ?? 0) + 1;
  }
  const approved = tables.credential_cases.filter((row) => row.case_status === "approved");
  const windows = { "7d": 7, "30d": 30, "90d": 90 };
  const within = (value, days) => {
    const ago = daysBefore(anchorDate, value);
    return ago >= 0 && ago <= days - 1;
  };
  const feed = {};
  for (const [label, days] of Object.entries(windows)) {
    feed[label] = {
      approvals: tables.case_status_history.filter(
        (row) =>
          row.to_status === "approved" && row.from_status !== null && within(row.changed_at, days),
      ).length,
      terminations: tables.credential_cases.filter(
        (row) => row.termination_date && within(row.termination_date, days),
      ).length,
      licenseExpirations: tables.state_licenses.filter((row) => {
        const ago = daysBefore(anchorDate, row.expiration_date) - 1;
        return ago >= 0 && ago <= days - 1;
      }).length,
    };
  }
  const latestByCase = new Map();
  for (const touch of tables.touches) {
    if (touch.entry_type !== "touchpoint") continue;
    const current = latestByCase.get(touch.case_id);
    if (!current || touch.created_at > current.created_at) latestByCase.set(touch.case_id, touch);
  }
  const followUps = { overdue: 0, dueToday: 0, upcoming: 0 };
  for (const touch of latestByCase.values()) {
    if (!touch.next_follow_up_date || touch.clears_follow_up) continue;
    if (touch.next_follow_up_date < anchorDate) followUps.overdue += 1;
    else if (touch.next_follow_up_date === anchorDate) followUps.dueToday += 1;
    else followUps.upcoming += 1;
  }
  return {
    scenarios,
    funnel,
    caseStatus,
    approvedEffective: approved.filter((row) => row.confirmed_effective_date).length,
    approvedAwaitingEffective: approved.filter((row) => !row.confirmed_effective_date).length,
    feed,
    followUps,
    states: new Set(tables.facilities.map((row) => row.state)).size,
  };
}
