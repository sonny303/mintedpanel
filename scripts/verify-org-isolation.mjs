#!/usr/bin/env node
// End-to-end org-isolation check for the provider API, run against a real
// deploy from a host with open network egress (a GitHub runner, or your
// laptop). The Claude sandbox cannot run this — its egress policy denies both
// *.supabase.co and the *.vercel.app deploy host.
//
// It never uses the service-role key. It signs in as real users with the anon
// key + passwords (the service-role key stays server-side on Vercel), then
// calls the deploy with each user's Bearer JWT. Read-only.
//
// Required env (the GitHub workflow wires these from secrets + constants):
//   SUPABASE_URL           e.g. https://fkvuhfsqcmujywzgczmc.supabase.co
//   SUPABASE_ANON_KEY      publishable/anon key
//   API_BASE               PRODUCTION deploy base (preview SSO blocks Bearer auth)
//   KANSAS_EMAIL/PASSWORD  a Kansas-ONLY user (testkansas@minted.com, admin)
//   SPVIEW_EMAIL/PASSWORD  a South-Park-ONLY user (testsouthpark@minted.com, billing)
//   SOUTHPARK_ORG, SOUTHPARK_PROVIDER_ID, KANSAS_PROVIDER_ID
//   SOUTHPARK_FIELDMAP_ID  the one South Park-scoped portal_field_maps row
//                          (seeded fixture; id lives in the workflow env block)
//   SOUTHPARK_CASE_ID      a South Park credential_cases id (must-reject POST in
//                          assertion 9; must-404 GET context in assertion 14b)
//   SOUTHPARK_FACILITY_ID  a South Park facilities id (the must-404 profile
//                          ?facilityId in assertion 11)
// Optional:
//   VERCEL_BYPASS_SECRET   Vercel "Protection Bypass for Automation" secret. If the
//                          deploy has Deployment Protection on, set this so requests
//                          carry x-vercel-protection-bypass and reach the app.
//   EXPECTED_KANSAS_PROVIDERS / EXPECTED_SOUTHPARK_PROVIDERS
//                          Per-org provider counts for assertions 1/2. Defaults
//                          (6/4) match the mock fixtures; the workflow env pins
//                          the LIVE demo counts, which move when demo/UAT
//                          providers are added. A count mismatch is fixture
//                          drift, not a leak — the leak checks are 1b/2b/2c/3.
//   KANSAS_CASE_ID + SOUTHPARK_TASK_ID
//                          Fixtures for assertion 13 (submission-touch
//                          task-ownership isolation): a Kansas case (valid POST
//                          target) + a South Park task id (the cross-org task_id
//                          that must 404). Both must be set or assertion 13 is
//                          skipped; the in-sandbox mock run always sets them.
//   KANSAS_ORG             the Kansas org id, for the propose-only field-map
//                          write pair (20/20a): the created row must be scoped
//                          to it. Skipped when unset; the mock run always sets
//                          it. This is the ONE gate assertion that writes for
//                          real — a proposed row is inert (no token, fills
//                          nothing) and idempotent on (portal_key, selector),
//                          so repeat runs converge rather than accumulate.
//   KANSAS_DOCUMENT_ID + SOUTHPARK_DOCUMENT_ID
//                          Fixtures for the E4.5 signed-download pair (17/17b):
//                          an own-org document (positive) + a cross-org document
//                          id that must 404 before anything is signed. Skipped
//                          when unset (the real gate waits for the operator to
//                          seed + pin fixture documents); the in-sandbox mock
//                          run always sets both.
//   (no new env needed for 25/25b/26 — the document upload-intent + finalize
//   write-path pair, ASD BITE-ASD-04, closing the TD-53 gap; they reuse
//   KANSAS_PROVIDER_ID/SOUTHPARK_PROVIDER_ID as the owner ids.)
//
// Both users are single-org, so views 1-3 send no x-org-id (the guard resolves
// each caller's sole org). Only the assertion-4 spoof sends an x-org-id.
//
// Near-read-only: the write attempts (POST assertions 7/9, PATCH assertion 12)
// all target another org's case/provider, which the server must REJECT (404)
// before writing anything. Provider POST-create is intentionally NOT exercised
// here — a real create would drift the demo-org counts assertions 1/2 pin.
// Nothing here writes production data.
//
// Exit code: 0 = all pass, 1 = any assertion failed, 2 = missing env,
// 3 = setup/network error. A cross-org row anywhere is a STOP-SHIP failure.

const env = process.env;
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "API_BASE",
  "KANSAS_EMAIL",
  "KANSAS_PASSWORD",
  "SPVIEW_EMAIL",
  "SPVIEW_PASSWORD",
  "SOUTHPARK_ORG",
  "SOUTHPARK_PROVIDER_ID",
  "KANSAS_PROVIDER_ID",
  "SOUTHPARK_FIELDMAP_ID",
  "SOUTHPARK_CASE_ID",
  "SOUTHPARK_FACILITY_ID",
];
const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(2);
}

const API_BASE = env.API_BASE.replace(/\/+$/, "");
const BYPASS = env.VERCEL_BYPASS_SECRET || "";

async function signIn(email, password) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`sign-in failed for ${email}: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

// One GET against the deploy. Adds the Bearer + x-org-id when given, and the
// Vercel protection-bypass header when a secret is configured. Returns the
// parsed JSON body when possible plus the raw text (so a non-JSON SSO gate is
// visible in the logs).
async function apiGet(path, { token, orgId } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (orgId) headers["x-org-id"] = orgId;
  if (BYPASS) {
    headers["x-vercel-protection-bypass"] = BYPASS;
    headers["x-vercel-set-bypass-cookie"] = "true";
  }
  const res = await fetch(`${API_BASE}${path}`, { headers });
  const raw = await res.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON (e.g. an SSO HTML gate) → body stays null; raw holds the page */
  }
  return { status: res.status, body, raw };
}

// One POST against the deploy. Same header handling as apiGet.
async function apiPost(path, payload, { token, orgId } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (orgId) headers["x-org-id"] = orgId;
  if (BYPASS) {
    headers["x-vercel-protection-bypass"] = BYPASS;
    headers["x-vercel-set-bypass-cookie"] = "true";
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON → body stays null; raw holds the page */
  }
  return { status: res.status, body, raw };
}

// One PATCH against the deploy. Same header handling as apiPost.
async function apiPatch(path, payload, { token, orgId } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (orgId) headers["x-org-id"] = orgId;
  if (BYPASS) {
    headers["x-vercel-protection-bypass"] = BYPASS;
    headers["x-vercel-set-bypass-cookie"] = "true";
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON → body stays null; raw holds the page */
  }
  return { status: res.status, body, raw };
}

const rows = [];
let stopShip = false;
function check(name, pass, detail, { leak = false } = {}) {
  rows.push({ name, pass, detail });
  if (leak && !pass) stopShip = true;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  —  ${detail}`);
}

function idsOf(body) {
  return new Set((body?.data ?? []).map((r) => r.id));
}

function looksLikeVercelGate(r) {
  // Vercel Authentication returns an HTML interstitial, not our JSON envelope.
  const s = (r.raw || "").toLowerCase();
  return (
    r.body === null && (s.includes("authenticat") || s.includes("vercel") || s.includes("<html"))
  );
}

(async () => {
  console.log(`API_BASE host reachable check — bypass secret ${BYPASS ? "SET" : "not set"}`);

  // Preflight: prove the deploy is reachable and that OUR guard (JSON envelope),
  // not a Vercel SSO gate (HTML), is answering. /api/health is public in-app.
  const health = await apiGet("/api/health");
  console.log(
    `preflight GET /api/health          -> status=${health.status} body=${(health.raw || "").slice(0, 120)}`,
  );
  const noAuth = await apiGet("/api/providers");
  console.log(
    `preflight GET /api/providers noauth -> status=${noAuth.status} body=${(noAuth.raw || "").slice(0, 160)}`,
  );
  if (looksLikeVercelGate(health) || looksLikeVercelGate(noAuth)) {
    console.error(
      "\nDIAGNOSIS: the deploy is behind Vercel Deployment Protection (SSO) — an HTML\n" +
        "gate is answering instead of the app's JSON. Bearer auth can't get past it.\n" +
        "Fix: point API_BASE at a public production deploy, or set VERCEL_BYPASS_SECRET\n" +
        "(a Vercel 'Protection Bypass for Automation' secret) so requests carry the\n" +
        "x-vercel-protection-bypass header.\n",
    );
  }

  const kansasTok = await signIn(env.KANSAS_EMAIL, env.KANSAS_PASSWORD);
  const spTok = await signIn(env.SPVIEW_EMAIL, env.SPVIEW_PASSWORD);

  // Expected per-org provider counts (see the env note in the header).
  const KANSAS_COUNT = Number(env.EXPECTED_KANSAS_PROVIDERS ?? 6);
  const SOUTHPARK_COUNT = Number(env.EXPECTED_SOUTHPARK_PROVIDERS ?? 4);

  // 1. Kansas view (single-org user, no x-org-id) = the exact expected count,
  //    zero South Park.
  const k = await apiGet("/api/providers?pageSize=100", { token: kansasTok });
  const kIds = idsOf(k.body);
  check(
    `1. Kansas view returns exactly ${KANSAS_COUNT}`,
    k.status === 200 && kIds.size === KANSAS_COUNT && k.body?.meta?.total === KANSAS_COUNT,
    `status=${k.status} count=${kIds.size} meta.total=${k.body?.meta?.total}` +
      (k.status !== 200 ? ` body=${(k.raw || "").slice(0, 100)}` : ""),
  );
  check(
    "1b. Kansas view contains no South Park provider id",
    !kIds.has(env.SOUTHPARK_PROVIDER_ID),
    `southParkIdPresent=${kIds.has(env.SOUTHPARK_PROVIDER_ID)}`,
    { leak: true },
  );

  // 2. South Park view (single-org user, no x-org-id) = the exact expected
  //    count, zero Kansas.
  const s = await apiGet("/api/providers?pageSize=100", { token: spTok });
  const sIds = idsOf(s.body);
  check(
    `2. South Park view returns exactly ${SOUTHPARK_COUNT}`,
    s.status === 200 && sIds.size === SOUTHPARK_COUNT && s.body?.meta?.total === SOUTHPARK_COUNT,
    `status=${s.status} count=${sIds.size} meta.total=${s.body?.meta?.total}` +
      (s.status !== 200 ? ` body=${(s.raw || "").slice(0, 100)}` : ""),
  );
  check(
    "2b. South Park view contains no known Kansas provider id",
    !sIds.has(env.KANSAS_PROVIDER_ID),
    `kansasIdPresent=${sIds.has(env.KANSAS_PROVIDER_ID)}`,
    { leak: true },
  );
  const overlap = [...kIds].filter((id) => sIds.has(id));
  check(
    "2c. Kansas and South Park id sets are disjoint",
    overlap.length === 0,
    `overlap=${overlap.length}${overlap.length ? " " + overlap.slice(0, 3).join(",") : ""}`,
    { leak: true },
  );

  // 3. Kansas view: GET a South Park provider by id -> 404, no row leaked.
  const x = await apiGet(`/api/providers/${env.SOUTHPARK_PROVIDER_ID}`, { token: kansasTok });
  const leakedRow = x.status === 200 && x.body?.data?.id === env.SOUTHPARK_PROVIDER_ID;
  check(
    "3. Kansas view GET-by-id on a South Park provider -> 404",
    x.status === 404 && !leakedRow,
    `status=${x.status} leakedRow=${leakedRow}`,
    { leak: true },
  );

  // 4. HEADER-SPOOF (the real one): a Kansas-only user sends x-org-id for South
  //    Park, an org they are NOT a member of. Must be DENIED and must never
  //    return South Park's data.
  const spoof = await apiGet("/api/providers?pageSize=100", {
    token: kansasTok,
    orgId: env.SOUTHPARK_ORG,
  });
  const spoofIds = idsOf(spoof.body);
  const spoofLeakedSP =
    spoofIds.has(env.SOUTHPARK_PROVIDER_ID) ||
    (spoof.status === 200 && spoof.body?.meta?.total === 4);
  check(
    "4. Header-spoof (Kansas-only user, x-org-id=SouthPark) is denied",
    spoof.status === 403 && !spoofLeakedSP,
    `status=${spoof.status} (expect 403) returnedRows=${spoofIds.size} spLeaked=${spoofLeakedSP}`,
    { leak: true },
  );

  // 5. Portal field maps (shared catalog): Kansas sees the global (org NULL)
  //    rows and never another org's org-scoped rows. 5a first proves the
  //    seeded South Park fixture row still exists (its OWN org can see it) —
  //    without that, 5b/5c would pass vacuously against a stale/deleted
  //    fixture. A 5a failure is a fixture error, not a leak: reseed the row
  //    and update SOUTHPARK_FIELDMAP_ID in the workflow env.
  const fm = await apiGet("/api/portal-field-maps", { token: kansasTok });
  const fmRows = fm.body?.data ?? [];
  const fmGlobal = fmRows.filter((r) => r.orgId === null);
  check(
    "5. Kansas field maps return the global catalog",
    fm.status === 200 && fmGlobal.length >= 1,
    `status=${fm.status} rows=${fmRows.length} globalRows=${fmGlobal.length}` +
      (fm.status !== 200 ? ` body=${(fm.raw || "").slice(0, 100)}` : ""),
  );
  const spFm = await apiGet("/api/portal-field-maps", { token: spTok });
  const spFmRows = spFm.body?.data ?? [];
  const fixturePresent = spFmRows.some(
    (r) => r.id === env.SOUTHPARK_FIELDMAP_ID && r.orgId === env.SOUTHPARK_ORG,
  );
  check(
    "5a. South Park sees its own seeded fixture row (5b/5c not vacuous)",
    spFm.status === 200 && fixturePresent,
    `status=${spFm.status} fixturePresent=${fixturePresent}` +
      (fixturePresent ? "" : " (fixture error — reseed + update SOUTHPARK_FIELDMAP_ID)"),
  );
  check(
    "5b. Kansas field maps exclude the seeded South Park row",
    !fmRows.some((r) => r.id === env.SOUTHPARK_FIELDMAP_ID),
    `seededRowPresent=${fmRows.some((r) => r.id === env.SOUTHPARK_FIELDMAP_ID)}`,
    { leak: true },
  );
  check(
    "5c. Kansas field maps contain no South Park org-scoped row",
    !fmRows.some((r) => r.orgId === env.SOUTHPARK_ORG),
    `southParkOrgRows=${fmRows.filter((r) => r.orgId === env.SOUTHPARK_ORG).length}`,
    { leak: true },
  );

  // 6. Provider profile (the PHI-dense endpoint): Kansas asking for a South
  //    Park provider's profile must 404 with no data.
  const prof = await apiGet(`/api/providers/${env.SOUTHPARK_PROVIDER_ID}/profile`, {
    token: kansasTok,
  });
  const profLeaked = prof.body?.data != null;
  check(
    "6. Kansas GET profile of a South Park provider -> 404, no data",
    prof.status === 404 && !profLeaked,
    `status=${prof.status} dataPresent=${profLeaked}`,
    { leak: true },
  );

  // 7. Fill events (the one POST — a payload the server must REJECT): Kansas
  //    posting a South Park provider/case must 404 before anything is written.
  //    The repeat POST with the same idempotency id is the observable
  //    follow-up: had the first call inserted before rejecting, an
  //    idempotency-first implementation would return the stored row (200) on
  //    the replay. The deterministic reject-before-insert proof lives in the
  //    unit tests (no insert call on a rejected event); fill_sessions row
  //    count can additionally be checked out-of-band after a run.
  const fillPayload = {
    id: crypto.randomUUID(),
    caseId: env.SOUTHPARK_CASE_ID,
    providerId: env.SOUTHPARK_PROVIDER_ID,
    portalKey: "gate_must_reject",
    fillMode: "web",
    fieldsFilled: 0,
  };
  const fill = await apiPost("/api/fill-events", fillPayload, { token: kansasTok });
  const fillLeaked = fill.status < 400 || fill.body?.data != null;
  check(
    "7. Kansas POST fill-event for South Park case/provider is rejected",
    fill.status === 404 && !fillLeaked,
    `status=${fill.status} (expect 404) dataPresent=${fill.body?.data != null}`,
    { leak: true },
  );
  const fillReplay = await apiPost("/api/fill-events", fillPayload, { token: kansasTok });
  check(
    "7b. Replaying the rejected fill-event still rejects (nothing was stored)",
    fillReplay.status === 404 && fillReplay.body?.data == null,
    `status=${fillReplay.status} dataPresent=${fillReplay.body?.data != null}`,
    { leak: true },
  );

  // 8. Cases dropdown endpoint: Kansas listing its own provider's open cases
  //    works (proves 8b isn't vacuous against a dead route)...
  const ownCases = await apiGet(`/api/cases?providerId=${env.KANSAS_PROVIDER_ID}`, {
    token: kansasTok,
  });
  check(
    "8. Kansas lists own provider's open cases",
    ownCases.status === 200 && Array.isArray(ownCases.body?.data),
    `status=${ownCases.status} rows=${(ownCases.body?.data ?? []).length}` +
      (ownCases.status !== 200 ? ` body=${(ownCases.raw || "").slice(0, 100)}` : ""),
  );
  //    ...and asking for a South Park provider's cases must 404 with no rows.
  const xCases = await apiGet(`/api/cases?providerId=${env.SOUTHPARK_PROVIDER_ID}`, {
    token: kansasTok,
  });
  const casesLeaked = xCases.body?.data != null;
  check(
    "8b. Kansas GET cases of a South Park provider -> 404, no rows",
    xCases.status === 404 && !casesLeaked,
    `status=${xCases.status} dataPresent=${casesLeaked}`,
    { leak: true },
  );
  // 8c. portalTasks (Phase 4 SOP↔portal link) rides the dropdown row: the
  //     extension matches the page portal_key to these to close a task. Every
  //     own-cases row must carry a portalTasks array and none may reference a
  //     cross-org task id. Shape/positive check — non-vacuous against the mock
  //     (Kansas fixture carries one), vacuously true against a not-yet-populated
  //     prod; the leak half is 8d.
  const ownCaseRows = ownCases.body?.data ?? [];
  const ownTaskIds = ownCaseRows.flatMap((c) => (c?.portalTasks ?? []).map((t) => t?.taskId));
  check(
    "8c. Kansas own cases expose portalTasks referencing only own-org tasks",
    ownCases.status === 200 &&
      ownCaseRows.every((c) => Array.isArray(c?.portalTasks)) &&
      !ownTaskIds.includes(env.SOUTHPARK_TASK_ID),
    `rows=${ownCaseRows.length} ownTaskIds=${JSON.stringify(ownTaskIds)}`,
  );
  // 8d. The cross-org request must never leak a South Park task id via
  //     portalTasks. Rides the same 404 as 8b (no rows -> no portalTasks); a
  //     leaked case list carries the cross-org task ids, which this catches.
  const xTaskIds = (xCases.body?.data ?? []).flatMap((c) =>
    (c?.portalTasks ?? []).map((t) => t?.taskId),
  );
  check(
    "8d. Kansas GET cross-org cases never leaks a South Park task id via portalTasks",
    !xTaskIds.includes(env.SOUTHPARK_TASK_ID),
    `xTaskIds=${JSON.stringify(xTaskIds)}`,
    { leak: true },
  );

  // 9. Submission touches (the second must-reject POST): Kansas posting a
  //    touch on a South Park case must 404 before anything is written. Like
  //    assertion 7, the replay with the same idempotency id is the observable
  //    nothing-was-written follow-up: had the first call inserted before
  //    rejecting, the replay would return the stored row (200) instead.
  const touchPayload = {
    kind: "portal_submission",
    portal_key: "gate_must_reject",
    idempotency_id: crypto.randomUUID(),
  };
  const touch = await apiPost(`/api/cases/${env.SOUTHPARK_CASE_ID}/touches`, touchPayload, {
    token: kansasTok,
  });
  const touchLeaked = touch.status < 400 || touch.body?.data != null;
  check(
    "9. Kansas POST touch on a South Park case is rejected",
    touch.status === 404 && !touchLeaked,
    `status=${touch.status} (expect 404) dataPresent=${touch.body?.data != null}`,
    { leak: true },
  );
  const touchReplay = await apiPost(`/api/cases/${env.SOUTHPARK_CASE_ID}/touches`, touchPayload, {
    token: kansasTok,
  });
  check(
    "9b. Replaying the rejected touch still rejects (nothing was written)",
    touchReplay.status === 404 && touchReplay.body?.data == null,
    `status=${touchReplay.status} dataPresent=${touchReplay.body?.data != null}`,
    { leak: true },
  );

  // 10. Org discovery (GET /api/me/orgs): the caller's OWN memberships only,
  //     derived from the JWT user id — no org header involved. testkansas is
  //     a Kansas-only fixture user, so exactly one row with the endpoint's
  //     three columns; a different count is fixture drift, while 10b is the
  //     leak half: the South Park org must never appear in Kansas's response.
  const kOrgs = await apiGet("/api/me/orgs", { token: kansasTok });
  const kOrgRows = kOrgs.body?.data ?? [];
  const kOrgShapeOk =
    kOrgRows.length === 1 &&
    typeof kOrgRows[0]?.orgId === "string" &&
    typeof kOrgRows[0]?.orgName === "string" &&
    typeof kOrgRows[0]?.role === "string";
  check(
    "10. Kansas /api/me/orgs returns exactly the caller's own membership",
    kOrgs.status === 200 && kOrgShapeOk,
    `status=${kOrgs.status} rows=${kOrgRows.length}` +
      (kOrgs.status !== 200 ? ` body=${(kOrgs.raw || "").slice(0, 100)}` : ""),
  );
  const spOrgLeaked = kOrgRows.some((r) => r?.orgId === env.SOUTHPARK_ORG);
  check(
    "10b. Kansas /api/me/orgs never contains the South Park org",
    !spOrgLeaked,
    `southParkOrgPresent=${spOrgLeaked}`,
    { leak: true },
  );

  // 11. Facility awareness on the profile endpoint: a Kansas provider's
  //     profile requested with a South Park facilityId must 404 with no data
  //     — facility.* tokens must never resolve from another org's facility.
  const xFac = await apiGet(
    `/api/providers/${env.KANSAS_PROVIDER_ID}/profile?facilityId=${env.SOUTHPARK_FACILITY_ID}`,
    { token: kansasTok },
  );
  const facLeaked = xFac.status < 400 || xFac.body?.data != null;
  check(
    "11. Kansas GET own profile with a South Park facilityId -> 404, no data",
    xFac.status === 404 && !facLeaked,
    `status=${xFac.status} (expect 404) dataPresent=${xFac.body?.data != null}`,
    { leak: true },
  );

  // 12. Provider WRITE isolation (the PATCH must-reject): a Kansas writer
  //     PATCHing a South Park provider by id must 404 like the GET-by-id
  //     (assertion 3) — never 200, never a cross-org write. This is safe to
  //     run against production because a cross-org id is rejected BEFORE any
  //     write (getProvider -> null -> 404), so nothing is mutated.
  //
  //     POST /api/providers is deliberately NOT asserted here: a real create
  //     would insert a live Kansas provider and drift the
  //     EXPECTED_KANSAS_PROVIDERS count that assertions 1/2 pin. POST
  //     org-scoping (body org_id stripped, row lands in the caller's org and is
  //     invisible cross-org) is covered by the mock (scripts/mock-api-server.mjs)
  //     and the handler unit tests instead.
  const patchX = await apiPatch(
    `/api/providers/${env.SOUTHPARK_PROVIDER_ID}`,
    { firstName: "GateShouldReject" },
    { token: kansasTok },
  );
  const patchLeaked = patchX.status < 400 || patchX.body?.data != null;
  check(
    "12. Kansas PATCH a South Park provider -> 404, no cross-org write",
    patchX.status === 404 && !patchLeaked,
    `status=${patchX.status} (expect 404) dataPresent=${patchX.body?.data != null}`,
    { leak: true },
  );

  // 13. Submission-touch task-ownership isolation (PR C, Story 7): a Kansas
  //     writer posting a touch on their OWN case but naming a South Park
  //     task_id must 404 "Task not found" BEFORE any write — the task close is
  //     the extension's only cross-org write surface added by the touchlog
  //     bridge. Safe against production: the task check runs before the anchor
  //     insert, so nothing lands on the real Kansas case. Optional — skipped
  //     unless both fixtures are configured (KANSAS_CASE_ID + SOUTHPARK_TASK_ID);
  //     the in-sandbox mock run always sets them.
  if (env.KANSAS_CASE_ID && env.SOUTHPARK_TASK_ID) {
    const taskSpoof = {
      kind: "portal_submission",
      portal_key: "gate_must_reject",
      idempotency_id: crypto.randomUUID(),
      task_id: env.SOUTHPARK_TASK_ID,
    };
    const t13 = await apiPost(`/api/cases/${env.KANSAS_CASE_ID}/touches`, taskSpoof, {
      token: kansasTok,
    });
    const t13Leaked = t13.status < 400 || t13.body?.data != null;
    check(
      "13. Kansas POST touch with a South Park task_id is rejected before any write",
      t13.status === 404 && !t13Leaked,
      `status=${t13.status} (expect 404) dataPresent=${t13.body?.data != null}`,
      { leak: true },
    );
  } else {
    console.log("SKIP  13. task-ownership isolation — KANSAS_CASE_ID / SOUTHPARK_TASK_ID not set");
  }

  // 14. Case context endpoint (P8): the Workbench reads a case's reference
  //     number(s) + latest note/touch after selection. Kansas reading its OWN
  //     case context works (proves 14b isn't vacuous against a dead route —
  //     conditional on KANSAS_CASE_ID, which the in-sandbox mock run always
  //     sets)...
  if (env.KANSAS_CASE_ID) {
    const ownCtx = await apiGet(`/api/cases/${env.KANSAS_CASE_ID}/context`, { token: kansasTok });
    check(
      "14. Kansas reads its own case context",
      ownCtx.status === 200 &&
        ownCtx.body?.data != null &&
        Array.isArray(ownCtx.body.data.referenceNumbers),
      `status=${ownCtx.status}` +
        (ownCtx.status !== 200 ? ` body=${(ownCtx.raw || "").slice(0, 100)}` : ""),
    );
  } else {
    console.log("SKIP  14. own case context — KANSAS_CASE_ID not set");
  }
  //     ...and reading a South Park case's context must 404 with no data.
  const xCtx = await apiGet(`/api/cases/${env.SOUTHPARK_CASE_ID}/context`, { token: kansasTok });
  const ctxLeaked = xCtx.status < 400 || xCtx.body?.data != null;
  check(
    "14b. Kansas GET context of a South Park case -> 404, no data",
    xCtx.status === 404 && !ctxLeaked,
    `status=${xCtx.status} (expect 404) dataPresent=${xCtx.body?.data != null}`,
    { leak: true },
  );

  // 15. Case search (E4.3 TE-11): the extension's standalone case half. Kansas
  //     searching its own cases works (proves 15b isn't vacuous against a dead
  //     route)...
  const search = await apiGet(`/api/cases?q=${encodeURIComponent(env.SEARCH_QUERY ?? "a")}`, {
    token: kansasTok,
  });
  check(
    "15. Kansas case search returns 200 with a rows array",
    search.status === 200 && Array.isArray(search.body?.data),
    `status=${search.status} rows=${(search.body?.data ?? []).length}` +
      (search.status !== 200 ? ` body=${(search.raw || "").slice(0, 100)}` : ""),
  );
  // 15b. ...and a search that would surface a South Park case under a leak must
  //      never return that case's id or its provider's id. Org-scoped in
  //      production (Kansas only ever sees Kansas cases, so the ids never
  //      appear for any query); the leak mode makes it red.
  const searchLeak = await apiGet(
    `/api/cases?q=${encodeURIComponent(env.SEARCH_LEAK_QUERY ?? "South Park")}`,
    { token: kansasTok },
  );
  const searchRows = searchLeak.body?.data ?? [];
  const searchLeakedCase = searchRows.some(
    (r) => r?.id === env.SOUTHPARK_CASE_ID || r?.providerId === env.SOUTHPARK_PROVIDER_ID,
  );
  check(
    "15b. Kansas case search never returns a South Park case or provider id",
    searchLeak.status === 200 && !searchLeakedCase,
    `status=${searchLeak.status} rows=${searchRows.length} leaked=${searchLeakedCase}`,
    { leak: true },
  );

  // 16. Fill-only SSN release (E4.4 F4.4.2): a Kansas writer requesting the
  //     full SSN for a South Park provider — even naming a South Park caseId —
  //     must 404 with no data. The value is the system's most sensitive PHI;
  //     the release must never cross the org boundary. Safe against production:
  //     the case-ownership check (org_id = the caller's Kansas org) misses BEFORE
  //     the decrypt RPC is ever called, so nothing is decrypted and no vaulted
  //     value is required for this assertion to hold. The leak mode makes it red.
  const xSsn = await apiGet(
    `/api/providers/${env.SOUTHPARK_PROVIDER_ID}/ssn-release?caseId=${env.SOUTHPARK_CASE_ID}`,
    { token: kansasTok },
  );
  const ssnLeaked = xSsn.status < 400 || xSsn.body?.data != null;
  check(
    "16. Kansas GET SSN release for a South Park provider -> 404, no data",
    xSsn.status === 404 && !ssnLeaked,
    `status=${xSsn.status} (expect 404) dataPresent=${xSsn.body?.data != null}`,
    { leak: true },
  );

  // 17. Signed document download (E4.5 TE-3/TE-11): documents are the most
  //     sensitive files in the system. Kansas downloading its OWN document
  //     works (proves 17b isn't vacuous against a dead route — conditional on
  //     KANSAS_DOCUMENT_ID; the in-sandbox mock run always sets it, the real
  //     gate skips until the operator seeds + pins a fixture document)...
  if (env.KANSAS_DOCUMENT_ID) {
    const ownDoc = await apiGet(`/api/documents/${env.KANSAS_DOCUMENT_ID}/download`, {
      token: kansasTok,
    });
    check(
      "17. Kansas downloads its own document (signed URL issued)",
      ownDoc.status === 200 && typeof ownDoc.body?.data?.url === "string",
      `status=${ownDoc.status}` +
        (ownDoc.status !== 200 ? ` body=${(ownDoc.raw || "").slice(0, 100)}` : ""),
    );
  } else {
    console.log("SKIP  17. own document download — KANSAS_DOCUMENT_ID not set");
  }
  //     ...and a South Park document id must 404 with no signed URL — the
  //     org-scoped metadata lookup misses BEFORE anything is signed, so no
  //     storage access ever happens for a cross-org id. Conditional on
  //     SOUTHPARK_DOCUMENT_ID (mock run always sets it); leak mode
  //     "documentdownload" makes it red.
  if (env.SOUTHPARK_DOCUMENT_ID) {
    const xDoc = await apiGet(`/api/documents/${env.SOUTHPARK_DOCUMENT_ID}/download`, {
      token: kansasTok,
    });
    const docLeaked = xDoc.status < 400 || xDoc.body?.data != null;
    check(
      "17b. Kansas GET download of a South Park document -> 404, no signed URL",
      xDoc.status === 404 && !docLeaked,
      `status=${xDoc.status} (expect 404) dataPresent=${xDoc.body?.data != null}`,
      { leak: true },
    );
  } else {
    console.log("SKIP  17b. cross-org document download — SOUTHPARK_DOCUMENT_ID not set");
  }

  // 18. Portals registry (shared catalog, same model as field maps): Kansas
  //     sees global (org NULL) rows plus its OWN org rows, and never another
  //     org's org-scoped portal. 18a first proves South Park actually holds an
  //     org-scoped portal, so 18b can't pass vacuously against an empty table —
  //     an 18a failure is a fixture gap, not a leak (register a South Park
  //     portal), and it downgrades to a SKIP rather than a false red.
  const portals = await apiGet("/api/portals", { token: kansasTok });
  const portalRows = portals.body?.data ?? [];
  check(
    "18. Kansas portals registry reads",
    portals.status === 200 && Array.isArray(portalRows),
    `status=${portals.status} rows=${portalRows.length}` +
      (portals.status !== 200 ? ` body=${(portals.raw || "").slice(0, 100)}` : ""),
  );
  const spPortals = await apiGet("/api/portals", { token: spTok });
  const spOwnPortals = (spPortals.body?.data ?? []).filter((r) => r.orgId === env.SOUTHPARK_ORG);
  if (spPortals.status === 200 && spOwnPortals.length >= 1) {
    check(
      "18b. Kansas portals exclude every South Park org-scoped portal",
      !portalRows.some((r) => r.orgId === env.SOUTHPARK_ORG),
      `southParkOrgRows=${portalRows.filter((r) => r.orgId === env.SOUTHPARK_ORG).length}` +
        ` (South Park holds ${spOwnPortals.length})`,
      { leak: true },
    );
  } else {
    console.log(
      "SKIP  18b. cross-org portal isolation — South Park holds no org-scoped portal fixture",
    );
  }

  // 19. CAQH attestation WRITE isolation: a Kansas writer recording an
  //     attestation on a South Park provider must 404 like the PATCH
  //     (assertion 12) — never 200, never a cross-org write. Safe against
  //     production for the same reason: the cross-org id is rejected BEFORE
  //     any write (getProvider -> null -> 404), so no date is stamped.
  //
  //     The own-org write is deliberately NOT asserted: it would mutate a live
  //     provider's caqh_last_attested_date and move that provider's E1.8
  //     readiness. The happy path is covered by the handler unit tests and the
  //     mock server instead — the same reasoning that keeps POST /api/providers
  //     out of the gate.
  const caqhX = await apiPost(
    `/api/providers/${env.SOUTHPARK_PROVIDER_ID}/caqh-attestation`,
    {},
    { token: kansasTok },
  );
  const caqhLeaked = caqhX.status < 400 || caqhX.body?.data != null;
  check(
    "19. Kansas CAQH attestation on a South Park provider -> 404, no cross-org write",
    caqhX.status === 404 && !caqhLeaked,
    `status=${caqhX.status} (expect 404) dataPresent=${caqhX.body?.data != null}`,
    { leak: true },
  );

  // 20. Propose-only field-map WRITE isolation: whatever a Kansas caller
  //     proposes must land under KANSAS. This is the one write the gate can
  //     safely exercise for real — a proposed row is inert (source 'manual',
  //     no token, fills nothing) and idempotent on (portal_key, selector), so
  //     re-running the gate converges on the same row instead of accumulating.
  //     20a is the isolation half: the created row is org-scoped to the caller
  //     and never global, so an x-org-id-less caller cannot mint a shared
  //     catalog entry or write into another tenant.
  if (env.KANSAS_ORG) {
    const proposed = await apiPost(
      "/api/portal-field-maps",
      {
        portal_key: "gate_probe_portal",
        selector: "#gate-isolation-probe",
        field_label: "Gate isolation probe",
      },
      { token: kansasTok },
    );
    // S5.3 widened the response to { map, suggestion } — the row is data.map.
    const proposedRow = proposed.body?.data?.map ?? null;
    check(
      "20. Kansas can propose a field mapping",
      (proposed.status === 201 || proposed.status === 200) && proposedRow != null,
      `status=${proposed.status} (expect 200/201) dataPresent=${proposedRow != null}`,
    );
    check(
      "20a. The proposed row is scoped to Kansas, never global, never approved",
      proposedRow != null &&
        proposedRow.orgId === env.KANSAS_ORG &&
        proposedRow.status === "proposed" &&
        proposedRow.token == null,
      `orgId=${proposedRow?.orgId ?? "-"} (expect ${env.KANSAS_ORG}) ` +
        `status=${proposedRow?.status ?? "-"} token=${proposedRow?.token ?? "null"}`,
      { leak: true },
    );
  } else {
    console.log("SKIP  20/20a. propose-only field-map write — KANSAS_ORG not set");
  }

  // 21. Task-step WRITE isolation (S4.3): a Kansas writer ticking a step on a
  //     South Park task must 404 BEFORE any write, like every other cross-org
  //     write path. Safe against production for the same reason as 12/19 —
  //     the org check precedes the update, so no task state is mutated. Uses
  //     a nonsense stepId so even a hypothetical org-check bypass would fail
  //     to find a step to tick.
  if (env.SOUTHPARK_TASK_ID) {
    const stepX = await apiPatch(
      `/api/tasks/${env.SOUTHPARK_TASK_ID}/steps`,
      { stepId: "gate-probe-step-does-not-exist" },
      { token: kansasTok },
    );
    const stepLeaked = stepX.status < 400 || stepX.body?.data != null;
    check(
      "21. Kansas ticking a step on a South Park task -> 404, no cross-org write",
      stepX.status === 404 && !stepLeaked,
      `status=${stepX.status} (expect 404) dataPresent=${stepX.body?.data != null}`,
      { leak: true },
    );
  } else {
    console.log("SKIP  21. cross-org task-step write — SOUTHPARK_TASK_ID not set");
  }

  // 22/23. E6.9 shared (org-free) training tier. These two routes deliberately
  //        carry NO org — training writes the shared form library every org
  //        inherits — so the property to hold is GLOBAL ONLY, not "the right
  //        org". 22: the shared registry read must never hand back a private
  //        org row (there is no org in scope to widen it to). 23: the shared
  //        propose must land org_id null; a row written under the caller's org
  //        would make a trained form silently private to one tenant while
  //        appearing shared. Safe on production: 23 writes a proposal with a
  //        gate-marked selector and no token, which fills nothing.
  const sharedPortals = await apiGet("/api/shared-portals", { token: kansasTok });
  const sharedRows = sharedPortals.body?.data ?? [];
  const privateLeak = sharedRows.filter((r) => r.orgId != null);
  check(
    "22. Shared portal registry returns GLOBAL rows only (no org's private rows)",
    sharedPortals.status === 200 && sharedRows.length > 0 && privateLeak.length === 0,
    `status=${sharedPortals.status} rows=${sharedRows.length} withOrg=${privateLeak.length}`,
    { leak: true },
  );

  const sharedMaps = await apiGet("/api/shared-field-maps", { token: kansasTok });
  const sharedMapRows = sharedMaps.body?.data ?? [];
  const mapOrgLeak = sharedMapRows.filter((r) => r.orgId != null);
  check(
    "22b. Shared field-map read returns GLOBAL rows only",
    sharedMaps.status === 200 && mapOrgLeak.length === 0,
    `status=${sharedMaps.status} rows=${sharedMapRows.length} withOrg=${mapOrgLeak.length}`,
    { leak: true },
  );

  const sharedProposal = await apiPost(
    "/api/shared-field-maps",
    {
      portal_key: "gate_probe_shared",
      selector: `#gate-probe-shared-${Date.now()}`,
      field_label: "Gate probe (shared tier)",
      page_step: "Page 1",
      field_type: "select",
      sort_order: 1,
      control_options: [
        { value: "KS", label: "Kansas" },
        { value: "MO", label: "Missouri" },
      ],
    },
    { token: kansasTok },
  );
  const sharedRow = sharedProposal.body?.data?.map ?? null;
  check(
    "23. Shared field-map propose lands org_id null, never under the caller's org",
    sharedProposal.status < 400 && sharedRow != null && sharedRow.orgId == null,
    `status=${sharedProposal.status} orgId=${sharedRow?.orgId ?? "null"} ` +
      `token=${sharedRow?.token ?? "null"} fieldType=${sharedRow?.fieldType ?? "null"}`,
    { leak: true },
  );

  // 24. Manual prove is GLOBAL only — naming a cross-org private portal id
  //     must 404 (never stamp proven_at on another tenant's row).
  const spPortalId = process.env.SOUTHPARK_PORTAL_ID || "portal-sp-1";
  const proveProbe = await apiPost(
    "/api/shared-portals/prove",
    { id: spPortalId },
    { token: kansasTok },
  );
  check(
    "24. Shared portal prove cannot stamp an org-scoped / foreign portal",
    proveProbe.status === 404,
    `status=${proveProbe.status}`,
    { leak: true },
  );

  // 24b. Shared test fill is is_test with null case/provider (telemetry only).
  const testFillId = crypto.randomUUID();
  const testFill = await apiPost(
    "/api/shared-test-fills",
    {
      id: testFillId,
      portalKey: "gate_probe_shared",
      fieldsFilled: 0,
      fieldsSkipped: [],
    },
    { token: kansasTok },
  );
  const testSession = testFill.body?.data?.session ?? null;
  check(
    "24b. Shared test fill records is_test with null case/provider",
    testFill.status < 400 &&
      testSession != null &&
      testSession.isTest === true &&
      testSession.caseId == null &&
      testSession.providerId == null,
    `status=${testFill.status} isTest=${testSession?.isTest} caseId=${testSession?.caseId}`,
    { leak: false },
  );

  // 25/25b/26 — document upload-intent + finalize (E4.5 TE-3, ASD
  // BITE-ASD-02/04 closing the TD-53 gap: these two write endpoints had NO
  // gate coverage — only the signed-download READ (17/17b) did). 25 proves
  // the route works for Kansas's own provider (so 25b isn't vacuous against a
  // dead route); 25b/26 are the leak checks — a South Park owner id must 404
  // BEFORE any signing or metadata insert. Safe on production: the org-scoped
  // owner lookup misses before a signed target is ever minted or a row ever
  // written, so no real Storage object or provider_documents row is touched
  // by 25b/26 regardless of leak mode. Leak "documentupload" makes both red.
  const ownIntent = await apiPost(
    "/api/documents/upload-intent",
    {
      ownerType: "provider",
      ownerId: env.KANSAS_PROVIDER_ID,
      kind: "state_license",
      fileName: "gate-probe.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    },
    { token: kansasTok },
  );
  check(
    "25. Kansas mints an upload-intent for its own provider (signed target issued)",
    ownIntent.status === 200 && typeof ownIntent.body?.data?.uploadUrl === "string",
    `status=${ownIntent.status}` +
      (ownIntent.status !== 200 ? ` body=${(ownIntent.raw || "").slice(0, 100)}` : ""),
  );

  const xIntent = await apiPost(
    "/api/documents/upload-intent",
    {
      ownerType: "provider",
      ownerId: env.SOUTHPARK_PROVIDER_ID,
      kind: "state_license",
      fileName: "gate-probe.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    },
    { token: kansasTok },
  );
  const intentLeaked = xIntent.status < 400 || xIntent.body?.data != null;
  check(
    "25b. Kansas POST upload-intent naming a South Park provider -> 404, no signed target",
    xIntent.status === 404 && !intentLeaked,
    `status=${xIntent.status} (expect 404) dataPresent=${xIntent.body?.data != null}`,
    { leak: true },
  );

  const xFinalize = await apiPost(
    "/api/documents/finalize",
    {
      ownerType: "provider",
      ownerId: env.SOUTHPARK_PROVIDER_ID,
      kind: "state_license",
      familyId: crypto.randomUUID(),
      versionNumber: 1,
      fileName: "gate-probe.pdf",
      mimeType: "application/pdf",
      expirationDate: "2030-01-01",
    },
    { token: kansasTok },
  );
  const finalizeLeaked = xFinalize.status < 400 || xFinalize.body?.data != null;
  check(
    "26. Kansas POST finalize naming a South Park provider -> 404, before any insert",
    xFinalize.status === 404 && !finalizeLeaked,
    `status=${xFinalize.status} (expect 404) dataPresent=${xFinalize.body?.data != null}`,
    { leak: true },
  );

  // 27. Provider list `groups` (2026-08-19): each row names the provider's
  //     groups so a search can tell two same-named providers apart. That is a
  //     SECOND org-scoped read joined onto the first, so it gets its own
  //     check — the rows can be correctly scoped while the join is not.
  //     Reuses the two org views already fetched above; non-vacuous as soon as
  //     either org has a group (27a states which).
  const groupsOf = (body) =>
    (Array.isArray(body?.data) ? body.data : []).flatMap((row) =>
      Array.isArray(row?.groups) ? row.groups : [],
    );
  const kGroups = groupsOf(k.body);
  const sGroups = groupsOf(s.body);
  const kGroupIds = new Set(kGroups.map((g) => g?.id).filter(Boolean));
  const sGroupIds = new Set(sGroups.map((g) => g?.id).filter(Boolean));
  check(
    "27a. At least one org's provider rows carry group names (27 is non-vacuous)",
    kGroupIds.size > 0 || sGroupIds.size > 0,
    `kansasGroups=${kGroupIds.size} southParkGroups=${sGroupIds.size}` +
      (kGroupIds.size + sGroupIds.size === 0
        ? " (no groups on either roster — 27 proves nothing)"
        : ""),
  );
  const groupOverlap = [...kGroupIds].filter((id) => sGroupIds.has(id));
  check(
    "27. Kansas and South Park provider-row group id sets are disjoint",
    groupOverlap.length === 0,
    `overlap=${groupOverlap.length}${groupOverlap.length ? " " + groupOverlap.slice(0, 3).join(",") : ""}`,
    { leak: true },
  );

  // ---- Pass/fail table ----
  const w = Math.max(...rows.map((r) => r.name.length));
  const line = "+" + "-".repeat(w + 2) + "+--------+";
  const out = [];
  out.push(line);
  out.push(`| ${"Assertion".padEnd(w)} | Result |`);
  out.push(line);
  for (const r of rows) out.push(`| ${r.name.padEnd(w)} | ${r.pass ? " PASS " : " FAIL "} |`);
  out.push(line);
  const table = out.join("\n");
  console.log("\n" + table);

  const anyFail = rows.some((r) => !r.pass);
  const verdict = anyFail
    ? stopShip
      ? "RESULT: FAIL — STOP-SHIP (cross-org isolation breach)"
      : "RESULT: FAIL"
    : "RESULT: PASS — org isolation holds";
  console.log("\n" + verdict);

  // GitHub job summary (markdown), when running in Actions.
  if (env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    const md = [
      "## Provider API — org isolation",
      "",
      "| Assertion | Result |",
      "| --- | --- |",
      ...rows.map((r) => `| ${r.name} | ${r.pass ? "✅ PASS" : "❌ FAIL"} |`),
      "",
      `**${verdict}**`,
      "",
    ].join("\n");
    appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n");
  }

  process.exit(anyFail ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(3);
});
