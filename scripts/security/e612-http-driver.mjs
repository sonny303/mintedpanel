// Runs inside the owned internal E6.12 Node container. Every request below is
// real HTTP to GoTrue, PostgREST, Storage API, or the Nitro app; no mocks.
const id = {
  orgA: "10000000-0000-4000-8000-000000000001",
  orgB: "10000000-0000-4000-8000-000000000002",
  admin: "30000000-0000-4000-8000-000000000001",
  groupA1: "20000000-0000-4000-8000-000000000001",
  groupA2: "20000000-0000-4000-8000-000000000002",
  groupB1: "20000000-0000-4000-8000-000000000003",
  provider: "70000000-0000-4000-8000-000000000001",
  facilityA: "70000000-0000-4000-8000-000000000002",
  orgPortal: "80000000-0000-4000-8000-000000000001",
  clientActive: "30000000-0000-4000-8000-000000000007",
  clientPending: "30000000-0000-4000-8000-000000000006",
  clientNoGrant: "30000000-0000-4000-8000-000000000008",
  clientRevoked: "30000000-0000-4000-8000-000000000009",
  dual: "30000000-0000-4000-8000-000000000010",
  wrongOrgClient: "30000000-0000-4000-8000-000000000011",
  operator: "30000000-0000-4000-8000-000000000012",
  emailChange: "30000000-0000-4000-8000-000000000013",
  orgBAdmin: "30000000-0000-4000-8000-000000000015",
  statusUnconfirmed: "30000000-0000-4000-8000-000000000014",
  accessActive: "40000000-0000-4000-8000-000000000001",
  accessNoGrant: "40000000-0000-4000-8000-000000000002",
  inviteEmailChange: "50000000-0000-4000-8000-000000000004",
  trainer: "30000000-0000-4000-8000-000000000005",
};
const password = "E612-Local-Password-!234";
const adminToken = process.env.E612_ADMIN_TOKEN;
const anonKey = process.env.E612_ANON_KEY;
if (!adminToken || !anonKey) throw new Error("E612_HTTP_DRIVER_CREDENTIALS_MISSING");
const auth = "http://auth:9999";
const rest = "http://rest:3000";
const storage = "http://storage:5000";
const app = "http://app:3000";
const gateway = "http://gateway:8787";
const bucketId = process.env.E612_BUCKET_ID || "payer-forms";
const globalPayerId = "60000000-0000-4000-8000-000000000001";
const catalogChangeId = "90000000-0000-4000-8000-000000000001";
const authUsers = [
  ["30000000-0000-4000-8000-000000000001", "admin@e612.test"],
  ["30000000-0000-4000-8000-000000000002", "specialist@e612.test"],
  ["30000000-0000-4000-8000-000000000003", "billing@e612.test"],
  ["30000000-0000-4000-8000-000000000004", "member@e612.test"],
  ["30000000-0000-4000-8000-000000000005", "trainer@e612.test"],
  ["30000000-0000-4000-8000-000000000006", "pending@e612.test"],
  ["30000000-0000-4000-8000-000000000007", "active@e612.test"],
  ["30000000-0000-4000-8000-000000000008", "nogrant@e612.test"],
  ["30000000-0000-4000-8000-000000000009", "revoked@e612.test"],
  ["30000000-0000-4000-8000-000000000010", "dual@e612.test"],
  ["30000000-0000-4000-8000-000000000011", "wrong-org@e612.test"],
  ["30000000-0000-4000-8000-000000000012", "operator@e612.test"],
  ["30000000-0000-4000-8000-000000000013", "email-change@e612.test"],
  ["30000000-0000-4000-8000-000000000014", "unconfirmed@e612.test", false],
  ["30000000-0000-4000-8000-000000000015", "orgb-admin@e612.test"],
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function waitForStdinSignal() {
  return new Promise((resolve) => {
    process.stdin.once("data", (value) => {
      process.stdin.pause();
      process.stdin.destroy();
      resolve(value);
    });
    process.stdin.resume();
  });
}
async function request(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(10_000),
    headers: { ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text */
  }
  return { response, body, text };
}
function headers(token, extra = {}) {
  return { authorization: `Bearer ${token}`, apikey: anonKey, ...extra };
}
function assert(name, value, detail = "") {
  if (!value) throw new Error(`E612_HTTP_ASSERT_${name}${detail ? `_${detail}` : ""}`);
  process.stdout.write(`E612|HTTP|PASS|${name}\n`);
}
async function wait(base, path) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const result = await request(base, path);
      if (result.response.status === 200) return;
    } catch {
      /* startup */
    }
    await pause(250);
  }
  throw new Error(`E612_HTTP_DRIVER_NOT_READY_${base}${path}`);
}
function expectStatus(name, result, statuses, detail = "") {
  assert(
    name,
    statuses.includes(result.response.status),
    `status_${result.response.status}${detail ? `_${detail}` : ""}`,
  );
}
function expectServiceError(name, result, message) {
  assert(
    name,
    result.response.status === 400 &&
      result.body?.code === "P0001" &&
      typeof result.body?.message === "string" &&
      result.body.message.includes(message),
    `status_${result.response.status}_code_${result.body?.code ?? "none"}`,
  );
}
function expectEnvelopeError(name, result, statuses, message) {
  assert(
    name,
    statuses.includes(result.response.status) &&
      result.body?.data === null &&
      typeof result.body?.error === "string" &&
      (!message || result.body.error.includes(message)),
    `status_${result.response.status}`,
  );
}
function absoluteUrl(raw) {
  const parsed = new URL(raw, gateway);
  const path = parsed.pathname.startsWith("/storage/v1/")
    ? parsed.pathname
    : parsed.pathname.startsWith("/object/")
      ? `/storage/v1${parsed.pathname}`
      : parsed.pathname;
  return `${gateway}${path}${parsed.search}`;
}
async function requestAbsolute(raw, init = {}) {
  const response = await fetch(absoluteUrl(raw), {
    ...init,
    signal: init.signal || AbortSignal.timeout(10_000),
    headers: { ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text */
  }
  return { response, body, text };
}
async function storageDenied(
  label,
  token,
  bucket = bucketId,
  key = "e612-fixture.pdf",
  prefix = "",
) {
  const listName = key.slice(key.lastIndexOf("/") + 1);
  const list = await request(storage, `/object/list/${bucket}`, {
    method: "POST",
    headers: headers(token, { "content-type": "application/json" }),
    body: JSON.stringify({
      prefix,
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  const listEmpty =
    list.response.status === 200 &&
    Array.isArray(list.body) &&
    !list.body.some((row) => row.name === listName);
  assert(
    `storage.${label}_list_denied`,
    listEmpty ||
      [401, 403].includes(list.response.status) ||
      (list.response.status === 400 && /authorization|jwt|bearer/i.test(list.text)),
    `status_${list.response.status}`,
  );
  const get = await request(storage, `/object/${bucket}/${key}`, { headers: headers(token) });
  assert(
    `storage.${label}_get_denied`,
    [401, 403].includes(get.response.status) ||
      (get.response.status === 400 &&
        /authorization|jwt|bearer|not found|does not exist|no such key/i.test(get.text)) ||
      (get.response.status === 404 && /NoSuchKey|not found/i.test(get.text)),
    `status_${get.response.status}`,
  );
  const sign = await request(storage, `/object/sign/${bucket}`, {
    method: "POST",
    headers: headers(token, { "content-type": "application/json" }),
    body: JSON.stringify({ expiresIn: 60, paths: [key] }),
  });
  const items = Array.isArray(sign.body) ? sign.body : [sign.body];
  const noUrl =
    items.length > 0 &&
    items.every((item) => typeof item?.signedURL !== "string" || item.signedURL.length === 0);
  const denied = items.every(
    (item) =>
      typeof item?.error === "string" &&
      /does not exist|do not have access|not found|no such key|authorization|jwt|bearer/i.test(
        item.error,
      ),
  );
  assert(
    `storage.${label}_sign_denied`,
    (sign.response.status === 200 && noUrl && denied) ||
      [401, 403].includes(sign.response.status) ||
      (sign.response.status === 400 &&
        /authorization|jwt|bearer|not found|does not exist|no such key/i.test(sign.text)),
    `status_${sign.response.status}`,
  );
}
async function signIn(email) {
  const result = await request(auth, "/token?grant_type=password", {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!result.response.ok || typeof result.body?.access_token !== "string")
    throw new Error(`E612_HTTP_AUTH_SIGNIN_${email}`);
  return result.body.access_token;
}
async function signInDenied(label, email) {
  const result = await request(auth, "/token?grant_type=password", {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const errorCode = `${result.body?.error ?? ""} ${result.body?.error_code ?? ""}`;
  const errorText = `${result.body?.error_description ?? ""} ${result.body?.message ?? ""} ${result.body?.msg ?? ""}`;
  const statusDenied =
    result.response.status === 400 && typeof result.body?.access_token !== "string";
  const expectedStatus = /invalid_grant|email_not_confirmed|user_banned|user_is_banned/i.test(
    errorCode,
  );
  const expectedText =
    /invalid[ _]login[ _]credentials|email[ _]not[ _]confirmed|user[ _]is[ _]banned|user[ _]banned/i.test(
      errorText,
    );
  const deletedStatus =
    /deleted/i.test(label) &&
    /user_not_found|invalid_grant|email_not_found|invalid_credentials/i.test(errorCode) &&
    /invalid[ _]login[ _]credentials/i.test(errorText);
  const accepted = statusDenied && ((expectedStatus && expectedText) || deletedStatus);
  if (!accepted) {
    const safe =
      `${result.body?.error ?? result.body?.error_code ?? "none"}_${result.body?.error_description ?? result.body?.message ?? result.body?.msg ?? "none"}`
        .replaceAll(/[^A-Za-z0-9]+/g, "_")
        .slice(0, 100)
        .toUpperCase();
    const safeLabel = label.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
    throw new Error(`E612_AUTH_DENIED_${safeLabel}_STATUS_${result.response.status}_${safe}`);
  }
  assert(label, true);
}
async function bootstrapAuthUsers() {
  for (const [userId, email, emailConfirm = true] of authUsers) {
    const result = await request(auth, "/admin/users", {
      method: "POST",
      headers: headers(adminToken, { "content-type": "application/json" }),
      body: JSON.stringify({ id: userId, email, password, email_confirm: emailConfirm }),
    });
    assert(
      `auth.admin_create_${userId.slice(-1)}`,
      result.response.ok && result.body?.id === userId && result.body?.email === email,
      `status_${result.response.status}`,
    );
  }
  process.stdout.write("E612|HTTP|PASS|auth.admin_create_all\n");
}
async function raceRead() {
  await wait(app, "/api/health");
  const trainerToken = await signIn("trainer@e612.test");
  const before = await request(app, "/api/shared-portals", {
    headers: headers(trainerToken),
  });
  assert(
    "app.authority_read_race_positive",
    before.response.status === 200 &&
      Array.isArray(before.body?.data) &&
      before.body.data.some((row) => row.portalKey === "e612-training"),
    `status_${before.response.status}`,
  );
  process.stdout.write("E612|RACE|POSITIVE_COMPLETE\n");
  await waitForStdinSignal();
  process.stdout.write("E612|RACE|GET_STARTED\n");
  const blocked = await request(app, "/api/shared-portals", {
    headers: headers(trainerToken),
  });
  const blockedText = JSON.stringify(blocked.body ?? "");
  assert(
    "app.authority_read_race_changed_denied",
    blocked.response.status === 409 &&
      blocked.body?.data === null &&
      !blockedText.includes("e612-training") &&
      !blockedText.includes("E612 Training Portal"),
    `status_${blocked.response.status}`,
  );
  const fresh = await request(app, "/api/shared-portals", {
    headers: headers(trainerToken),
  });
  assert(
    "app.authority_read_race_fresh_denied",
    fresh.response.status === 403 && fresh.body?.data === null,
    `status_${fresh.response.status}`,
  );
  process.stdout.write("E612|RACE|READ_COMPLETE\n");
}
async function raceMutate() {
  await wait(app, "/api/health");
  const admin = await signIn("admin@e612.test");
  const invite = await request(app, "/api/internal/client-invites", {
    method: "POST",
    headers: headers(admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: JSON.stringify({
      orgId: id.orgA,
      recipientEmail: "trainer@e612.test",
      groupIds: [id.groupA1],
    }),
  });
  assert(
    "app.authority_read_race_mutation_positive",
    invite.response.status === 201 && typeof invite.body?.data?.token === "string",
    `status_${invite.response.status}`,
  );
  process.stdout.write("E612|RACE|AUTHORITY_CHANGED\n");
}
async function main() {
  await wait(auth, "/health");
  if (process.argv.includes("--bootstrap")) {
    await bootstrapAuthUsers();
    return;
  }
  if (process.argv.includes("--race-read")) {
    await raceRead();
    return;
  }
  if (process.argv.includes("--race-mutate")) {
    await raceMutate();
    return;
  }
  await wait(rest, "/");
  await wait(storage, "/status");
  await wait(app, "/api/health");
  const tokens = {
    admin: await signIn("admin@e612.test"),
    specialist: await signIn("specialist@e612.test"),
    billing: await signIn("billing@e612.test"),
    memberOnly: await signIn("member@e612.test"),
    trainer: await signIn("trainer@e612.test"),
    pending: await signIn("pending@e612.test"),
    clientActive: await signIn("active@e612.test"),
    clientNoGrant: await signIn("nogrant@e612.test"),
    clientRevoked: await signIn("revoked@e612.test"),
    dual: await signIn("dual@e612.test"),
    wrongOrg: await signIn("wrong-org@e612.test"),
    emailChange: await signIn("email-change@e612.test"),
    orgBAdmin: await signIn("orgb-admin@e612.test"),
  };
  const user = await request(auth, "/user", { headers: headers(tokens.clientActive) });
  assert("auth.user_positive", user.response.ok && user.body?.id === id.clientActive);
  await signInDenied("auth.unconfirmed_login_denied", "unconfirmed@e612.test");
  const banned = await request(auth, `/admin/users/${id.operator}`, {
    method: "PUT",
    headers: headers(adminToken, { "content-type": "application/json" }),
    body: JSON.stringify({ email_confirm: true, ban_duration: "1h" }),
  });
  assert("auth.banned_patch", banned.response.ok);
  await signInDenied("auth.banned_login_denied", "operator@e612.test");
  const unbanned = await request(auth, `/admin/users/${id.operator}`, {
    method: "PUT",
    headers: headers(adminToken, { "content-type": "application/json" }),
    body: JSON.stringify({ email_confirm: true, ban_duration: "none" }),
  });
  assert("auth.unbanned_patch", unbanned.response.ok);
  const deleted = await request(auth, `/admin/users/${id.operator}`, {
    method: "DELETE",
    headers: headers(adminToken),
  });
  assert("auth.deleted_user", deleted.response.ok);
  await signInDenied("auth.deleted_login_denied", "operator@e612.test");
  const missingBearer = await request(app, "/api/me/access-context");
  expectEnvelopeError("auth.missing_bearer_denied", missingBearer, [401], null);
  const invalidBearer = await request(app, "/api/me/access-context", {
    headers: { authorization: "Bearer not-a-jwt", apikey: anonKey },
  });
  expectEnvelopeError("auth.invalid_bearer_denied", invalidBearer, [401], "Invalid");
  const expiredBearer = await request(app, "/api/me/access-context", {
    headers: headers(process.env.E612_EXPIRED_TOKEN),
  });
  expectEnvelopeError("auth.expired_bearer_denied", expiredBearer, [401], "Invalid");

  const metadataPatch = await request(auth, `/admin/users/${id.clientActive}`, {
    method: "PUT",
    headers: headers(adminToken, { "content-type": "application/json" }),
    body: JSON.stringify({ user_metadata: { actorUserId: id.trainer } }),
  });
  assert(
    "auth.metadata_patch",
    metadataPatch.response.ok,
    `status_${metadataPatch.response.status}`,
  );
  tokens.clientActive = await signIn("active@e612.test");
  const metadataContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.clientActive),
  });
  assert(
    "auth.metadata_actor_bound",
    metadataContext.response.ok && metadataContext.body?.data?.actorUserId === id.clientActive,
  );

  const billingOrgs = await request(rest, `/organizations?select=id&id=eq.${id.orgA}`, {
    headers: headers(tokens.billing),
  });
  assert(
    "rest.billing_org_positive",
    billingOrgs.response.ok &&
      Array.isArray(billingOrgs.body) &&
      billingOrgs.body.some((row) => row.id === id.orgA),
    `status_${billingOrgs.response.status}_body_${String(billingOrgs.text)
      .slice(0, 180)
      .replaceAll(/[^A-Za-z0-9._-]+/g, "-")}`,
  );
  const rpc = (name, body, token) =>
    request(rest, `/rpc/${name}`, {
      method: "POST",
      headers: headers(token, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
  const serviceContext = await rpc(
    "resolve_enrollment_context",
    { p_actor_user_id: id.clientActive, p_audience: "client", p_org_id: id.orgA },
    adminToken,
  );
  assert(
    "rest.service_resolve_context_positive",
    serviceContext.response.ok && serviceContext.body?.actorUserId === id.clientActive,
  );
  const serviceInvite = await rpc(
    "create_client_invite",
    {
      p_actor_user_id: "30000000-0000-4000-8000-000000000001",
      p_org_id: id.orgA,
      p_recipient_email: "specialist@e612.test",
      p_group_ids: [id.groupA1],
    },
    adminToken,
  );
  assert(
    "rest.service_create_invite_positive",
    serviceInvite.response.ok && typeof serviceInvite.body?.token === "string",
  );
  const serviceClaim = await rpc(
    "claim_client_invite",
    { p_actor_user_id: id.clientActive, p_token: "e612-http-invalid-invite-token" },
    adminToken,
  );
  expectServiceError(
    "rest.service_claim_domain_error",
    serviceClaim,
    "Invite is invalid or already claimed",
  );
  const serviceGroups = await rpc(
    "set_client_group_grants",
    {
      p_actor_user_id: "30000000-0000-4000-8000-000000000001",
      p_access_id: "40000000-0000-4000-8000-000000000099",
      p_group_ids: [id.groupA1],
    },
    adminToken,
  );
  expectServiceError("rest.service_groups_domain_error", serviceGroups, "Client access not found");
  const serviceRevoke = await rpc(
    "revoke_client_access",
    {
      p_actor_user_id: "30000000-0000-4000-8000-000000000001",
      p_access_id: "40000000-0000-4000-8000-000000000099",
    },
    adminToken,
  );
  expectServiceError("rest.service_revoke_domain_error", serviceRevoke, "Client access not found");
  const gatewayCalls = [
    [
      "resolve_enrollment_context",
      { p_actor_user_id: id.clientActive, p_audience: "client", p_org_id: id.orgA },
    ],
    [
      "create_client_invite",
      {
        p_actor_user_id: id.admin,
        p_org_id: id.orgA,
        p_recipient_email: "specialist@e612.test",
        p_group_ids: [id.groupA1],
      },
    ],
    [
      "claim_client_invite",
      { p_actor_user_id: id.clientActive, p_token: "e612-http-invalid-invite-token" },
    ],
    [
      "set_client_group_grants",
      {
        p_actor_user_id: id.admin,
        p_access_id: "40000000-0000-4000-8000-000000000099",
        p_group_ids: [id.groupA1],
      },
    ],
    [
      "revoke_client_access",
      { p_actor_user_id: id.admin, p_access_id: "40000000-0000-4000-8000-000000000099" },
    ],
  ];
  for (const [name, body] of gatewayCalls) {
    for (const [label, token] of [
      ["auth", tokens.clientActive],
      ["anon", anonKey],
    ]) {
      const result = await rpc(name, body, token);
      const gatewayDenied =
        [401, 403].includes(result.response.status) && result.body?.code === "42501";
      assert(
        `rest.${label}_${name}_denied`,
        gatewayDenied,
        `status_${result.response.status}_code_${result.body?.code ?? "none"}`,
      );
    }
  }
  const privateSchema = await request(rest, "/internal_staff?select=*", {
    headers: headers(tokens.clientActive, { "accept-profile": "private" }),
  });
  assert(
    "rest.private_schema_denied",
    privateSchema.response.status === 406 && privateSchema.body?.code === "PGRST106",
    `status_${privateSchema.response.status}_code_${privateSchema.body?.code ?? "none"}`,
  );
  const privateSchemaAnon = await request(rest, "/internal_staff?select=*", {
    headers: { apikey: anonKey, "accept-profile": "private" },
  });
  assert(
    "rest.private_schema_anon_denied",
    privateSchemaAnon.response.status === 406 && privateSchemaAnon.body?.code === "PGRST106",
    `status_${privateSchemaAnon.response.status}_code_${privateSchemaAnon.body?.code ?? "none"}`,
  );
  const restrictedGroups = await request(rest, `/provider_groups?select=id&id=eq.${id.groupA1}`, {
    headers: headers(tokens.clientActive),
  });
  assert(
    "rest.restricted_group_negative",
    restrictedGroups.response.ok &&
      Array.isArray(restrictedGroups.body) &&
      restrictedGroups.body.length === 0,
  );
  const restrictedPayers = await request(rest, "/rpc/list_global_payers", {
    method: "POST",
    headers: headers(tokens.clientActive, { "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "rest.restricted_global_payers_denied",
    restrictedPayers.response.ok &&
      Array.isArray(restrictedPayers.body) &&
      restrictedPayers.body.length === 0,
  );
  const restrictedCatalog = await request(rest, "/payer_catalog_changes?select=id", {
    headers: headers(tokens.clientActive),
  });
  assert(
    "rest.restricted_catalog_denied",
    [401, 403, 406].includes(restrictedCatalog.response.status),
  );
  const serviceCatalog = await request(rest, "/payer_catalog_changes?select=id", {
    headers: headers(adminToken),
  });
  assert(
    "rest.service_catalog_positive",
    serviceCatalog.response.ok &&
      Array.isArray(serviceCatalog.body) &&
      serviceCatalog.body.some((row) => row.id === catalogChangeId),
    `status_${serviceCatalog.response.status}`,
  );
  const portalSeed = await request(rest, "/rpc/upsert_global_portal", {
    method: "POST",
    headers: headers(adminToken, { "content-type": "application/json" }),
    body: JSON.stringify({
      p_id: null,
      p_name: "E612 Training Portal",
      p_portal_key: "e612-training",
      p_payer_id: globalPayerId,
      p_form_url: "https://training.e612.test/form",
    }),
  });
  assert(
    "rest.service_training_portal_seed",
    portalSeed.response.ok && portalSeed.body?.portal_key === "e612-training",
    `status_${portalSeed.response.status}_body_${String(portalSeed.text)
      .slice(0, 180)
      .replaceAll(/[^A-Za-z0-9._-]+/g, "-")}`,
  );
  const portalId = portalSeed.body?.id;
  assert("rest.service_training_portal_id", typeof portalId === "string");
  const portalShape = await request(
    rest,
    `/portals?select=id,org_id,portal_key,name,payer_id,form_url,is_verified,last_verified_at,proven_at,url_changed_at,created_at,updated_at,payers(name,status,archived_at,merged_into_id)&or=(org_id.is.null,org_id.eq.${id.orgA})&order=name.asc,id.asc`,
    { headers: headers(adminToken) },
  );
  const trainingRpc = async (name, body, token) => rpc(name, body, token);
  const trainingDenials = [
    [
      "upsert_global_portal",
      {
        p_id: portalId,
        p_name: "E612 Restricted",
        p_portal_key: "e612-training",
        p_payer_id: globalPayerId,
        p_form_url: "https://training.e612.test/form",
      },
    ],
    ["set_global_portal_flags", { p_id: portalId, p_verified: true, p_proven: true }],
    [
      "author_global_sop",
      {
        p_id: null,
        p_name: "E612 Restricted SOP",
        p_payer_id: globalPayerId,
        p_states: ["CO"],
        p_group_id: null,
        p_task_definitions: [],
        p_archived: false,
        p_required_profile_attributes: [],
      },
    ],
    [
      "publish_sop_template_version",
      {
        p_template_id: "00000000-0000-4000-8000-00000000e612",
        p_expected_version: 1,
        p_name: "E612 Restricted SOP",
        p_task_definitions: [],
        p_change_note: "e612",
        p_required_profile_attributes: [],
      },
    ],
    [
      "propose_shared_field_map",
      {
        p_portal_key: "e612-training",
        p_selector: "#restricted",
        p_field_label: "Restricted",
        p_form_section: null,
        p_page_step: null,
        p_field_type: "text",
        p_sort_order: 1,
        p_notes: null,
        p_control_options: null,
        p_map_type: "web",
      },
    ],
    [
      "train_global_field_map",
      {
        p_id: "00000000-0000-4000-8000-00000000e612",
        p_status: "approved",
        p_source: "token",
        p_token: "provider.npi",
        p_field_label: "NPI",
        p_hardcoded_value: null,
        p_transform: null,
      },
    ],
    [
      "update_shared_field_registry",
      { p_entries: [{ id: "00000000-0000-4000-8000-00000000e612", display_label: "NPI" }] },
    ],
  ];
  for (const [name, body] of trainingDenials) {
    for (const [label, token] of [
      ["active", tokens.clientActive],
      ["pending", tokens.pending],
      ["no_grant", tokens.clientNoGrant],
      ["revoked", tokens.clientRevoked],
      ["anon", anonKey],
    ]) {
      const result = await trainingRpc(name, body, token);
      const trainingDenied =
        label === "anon"
          ? result.response.status === 401 && result.body?.code === "42501"
          : result.response.status === 400 &&
            result.body?.code === "P0001" &&
            /Restricted client|not authorized|Not authenticated/i.test(result.body?.message ?? "");
      assert(
        `rest.${label}_${name}_denied`,
        trainingDenied,
        `status_${result.response.status}_code_${result.body?.code ?? "none"}`,
      );
    }
  }
  const authorSeed = await trainingRpc(
    "author_global_sop",
    {
      p_id: null,
      p_name: "E612 HTTP SOP",
      p_payer_id: globalPayerId,
      p_states: ["CO"],
      p_group_id: null,
      p_task_definitions: [],
      p_archived: false,
      p_required_profile_attributes: [],
    },
    adminToken,
  );
  assert(
    "rest.service_author_global_sop_positive",
    authorSeed.response.ok && typeof authorSeed.body?.id === "string",
  );
  const templateId = authorSeed.body.id;
  const publishSeed = await trainingRpc(
    "publish_sop_template_version",
    {
      p_template_id: templateId,
      p_expected_version: 1,
      p_name: "E612 HTTP SOP v2",
      p_task_definitions: [],
      p_change_note: "E612 HTTP",
      p_required_profile_attributes: [],
    },
    adminToken,
  );
  assert(
    "rest.service_publish_sop_positive",
    publishSeed.response.ok && publishSeed.body?.version === 2,
  );
  const proposed = await trainingRpc(
    "propose_shared_field_map",
    {
      p_portal_key: "e612-training",
      p_selector: "#npi",
      p_field_label: "NPI",
      p_form_section: null,
      p_page_step: null,
      p_field_type: "text",
      p_sort_order: 1,
      p_notes: null,
      p_control_options: null,
      p_map_type: "web",
    },
    adminToken,
  );
  assert(
    "rest.service_propose_field_map_positive",
    proposed.response.ok && typeof proposed.body?.id === "string",
  );
  const fieldMapId = proposed.body.id;
  const trained = await trainingRpc(
    "train_global_field_map",
    {
      p_id: fieldMapId,
      p_status: "approved",
      p_source: "token",
      p_token: "provider.npi",
      p_field_label: "NPI",
      p_hardcoded_value: null,
      p_transform: null,
    },
    adminToken,
  );
  assert(
    "rest.service_train_field_map_positive",
    trained.response.ok && trained.body?.id === fieldMapId,
  );
  const registry = await trainingRpc(
    "update_shared_field_registry",
    { p_entries: [{ id: fieldMapId, display_label: "NPI" }] },
    adminToken,
  );
  assert(
    "rest.service_update_field_registry_positive",
    registry.response.ok &&
      Array.isArray(registry.body) &&
      registry.body.some((row) => row.id === fieldMapId),
  );
  const trainerPortalUpdate = await trainingRpc(
    "upsert_global_portal",
    {
      p_id: portalId,
      p_name: "E612 Training Portal",
      p_portal_key: "e612-training",
      p_payer_id: globalPayerId,
      p_form_url: "https://training.e612.test/form",
    },
    tokens.trainer,
  );
  assert(
    "rest.trainer_upsert_global_portal_positive",
    trainerPortalUpdate.response.ok && trainerPortalUpdate.body?.id === portalId,
  );
  const trainerPortalFlags = await trainingRpc(
    "set_global_portal_flags",
    { p_id: portalId, p_verified: true, p_proven: true },
    tokens.trainer,
  );
  assert(
    "rest.trainer_set_global_portal_flags_positive",
    trainerPortalFlags.response.ok && trainerPortalFlags.body?.id === portalId,
  );
  const trainerAuthor = await trainingRpc(
    "author_global_sop",
    {
      p_id: null,
      p_name: "E612 Trainer SOP",
      p_payer_id: globalPayerId,
      p_states: ["UT"],
      p_group_id: null,
      p_task_definitions: [],
      p_archived: false,
      p_required_profile_attributes: [],
    },
    tokens.trainer,
  );
  assert(
    "rest.trainer_author_global_sop_positive",
    trainerAuthor.response.ok && typeof trainerAuthor.body?.id === "string",
  );
  const trainerTemplateId = trainerAuthor.body?.id;
  const trainerPublish = await trainingRpc(
    "publish_sop_template_version",
    {
      p_template_id: trainerTemplateId,
      p_expected_version: 1,
      p_name: "E612 Trainer SOP v2",
      p_task_definitions: [],
      p_change_note: "E612 trainer",
      p_required_profile_attributes: [],
    },
    tokens.trainer,
  );
  assert(
    "rest.trainer_publish_sop_positive",
    trainerPublish.response.ok && trainerPublish.body?.version === 2,
  );
  const trainerProposed = await trainingRpc(
    "propose_shared_field_map",
    {
      p_portal_key: "e612-training",
      p_selector: "#trainer-npi",
      p_field_label: "Trainer NPI",
      p_form_section: null,
      p_page_step: null,
      p_field_type: "text",
      p_sort_order: 2,
      p_notes: null,
      p_control_options: null,
      p_map_type: "web",
    },
    tokens.trainer,
  );
  assert(
    "rest.trainer_propose_field_map_positive",
    trainerProposed.response.ok && typeof trainerProposed.body?.id === "string",
  );
  const trainerFieldMapId = trainerProposed.body?.id;
  const trainerTrained = await trainingRpc(
    "train_global_field_map",
    {
      p_id: trainerFieldMapId,
      p_status: "approved",
      p_source: "token",
      p_token: "provider.npi",
      p_field_label: "Trainer NPI",
      p_hardcoded_value: null,
      p_transform: null,
    },
    tokens.trainer,
  );
  assert(
    "rest.trainer_train_field_map_positive",
    trainerTrained.response.ok && trainerTrained.body?.id === trainerFieldMapId,
  );
  const trainerRegistry = await trainingRpc(
    "update_shared_field_registry",
    { p_entries: [{ id: trainerFieldMapId, display_label: "Trainer NPI" }] },
    tokens.trainer,
  );
  assert(
    "rest.trainer_update_field_registry_positive",
    trainerRegistry.response.ok &&
      Array.isArray(trainerRegistry.body) &&
      trainerRegistry.body.some((row) => row.id === trainerFieldMapId),
  );
  const globalReferenceRows = [
    ["portals", `/portals?id=eq.${portalId}&select=id,portal_key`, portalId],
    [
      "portal_field_maps",
      `/portal_field_maps?id=eq.${fieldMapId}&select=id,portal_key`,
      fieldMapId,
    ],
    ["sop_templates", `/sop_templates?id=eq.${templateId}&select=id,name`, templateId],
    [
      "sop_template_versions",
      `/sop_template_versions?template_id=eq.${templateId}&select=template_id,version`,
      templateId,
    ],
    [
      "inbound_leads",
      "/inbound_leads?id=eq.61000000-0000-4000-8000-000000000001&select=id,contact_email",
      "61000000-0000-4000-8000-000000000001",
    ],
  ];
  for (const [name, path, expectedId] of globalReferenceRows) {
    const result = await request(rest, path, { headers: headers(tokens.billing) });
    assert(
      `rest.billing_${name}_positive`,
      result.response.ok &&
        Array.isArray(result.body) &&
        result.body.some((row) => row.id === expectedId || row.template_id === expectedId),
      `status_${result.response.status}`,
    );
  }
  for (const [label, token] of [
    ["active", tokens.clientActive],
    ["pending", tokens.pending],
    ["no_grant", tokens.clientNoGrant],
    ["revoked", tokens.clientRevoked],
  ]) {
    for (const [name, path] of globalReferenceRows) {
      const result = await request(rest, path, { headers: headers(token) });
      assert(
        `rest.${label}_${name}_denied`,
        result.response.ok && Array.isArray(result.body) && result.body.length === 0,
        `status_${result.response.status}`,
      );
    }
  }
  const trainerPayers = await request(rest, "/rpc/list_global_payers", {
    method: "POST",
    headers: headers(tokens.trainer, { "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "rest.zero_membership_global_payers_positive",
    trainerPayers.response.ok &&
      Array.isArray(trainerPayers.body) &&
      trainerPayers.body.some((row) => row.id === globalPayerId) &&
      !trainerPayers.body.some((row) => row.id === "60000000-0000-4000-8000-000000000002"),
  );
  const billingPayers = await request(rest, "/rpc/list_global_payers", {
    method: "POST",
    headers: headers(tokens.billing, { "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "rest.billing_global_payers_positive",
    billingPayers.response.ok &&
      Array.isArray(billingPayers.body) &&
      billingPayers.body.some((row) => row.id === globalPayerId),
  );
  const anonPayers = await request(rest, "/rpc/list_global_payers", {
    method: "POST",
    headers: headers(anonKey, { "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "rest.anon_global_payers_denied",
    [401, 403, 406].includes(anonPayers.response.status) ||
      (anonPayers.response.status === 200 &&
        Array.isArray(anonPayers.body) &&
        anonPayers.body.length === 0),
    `status_${anonPayers.response.status}`,
  );
  for (const [label, token] of [
    ["pending", tokens.pending],
    ["no_grant", tokens.clientNoGrant],
    ["revoked", tokens.clientRevoked],
  ]) {
    const result = await request(rest, "/rpc/list_global_payers", {
      method: "POST",
      headers: headers(token, { "content-type": "application/json" }),
      body: "{}",
    });
    assert(
      `rest.${label}_global_payers_denied`,
      result.response.ok && Array.isArray(result.body) && result.body.length === 0,
      `status_${result.response.status}`,
    );
  }

  const bucket = await request(storage, "/bucket", {
    method: "POST",
    headers: headers(adminToken, { "content-type": "application/json" }),
    body: JSON.stringify({ id: bucketId, name: bucketId, public: false }),
  });
  assert(
    "storage.bucket_create",
    bucket.response.ok ||
      bucket.response.status === 409 ||
      bucket.body?.statusCode === 409 ||
      bucket.body?.code === "BucketAlreadyExists",
    `status_${bucket.response.status}_body_${String(bucket.text)
      .slice(0, 180)
      .replaceAll(/[^A-Za-z0-9._-]+/g, "-")}`,
  );
  const pdf = "%PDF-1.4\nE612 synthetic storage fixture\n%%EOF\n";
  const licensePdf = "%PDF-1.4\nE612 synthetic state license fixture\n%%EOF\n";
  const upload = await request(storage, `/object/${bucketId}/e612-fixture.pdf`, {
    method: "POST",
    headers: headers(adminToken, { "content-type": "application/pdf", "x-upsert": "true" }),
    body: pdf,
  });
  assert(
    "storage.service_upload",
    upload.response.ok,
    `status_${upload.response.status}_body_${String(upload.text)
      .slice(0, 180)
      .replaceAll(/[^A-Za-z0-9._-]+/g, "-")}`,
  );
  const trainerGet = await request(storage, `/object/${bucketId}/e612-fixture.pdf`, {
    headers: headers(tokens.trainer),
  });
  assert(
    "storage.trainer_get_positive",
    trainerGet.response.ok && trainerGet.text.includes("E612 synthetic storage fixture"),
    `status_${trainerGet.response.status}_body_${String(trainerGet.text)
      .slice(0, 180)
      .replaceAll(/[^A-Za-z0-9._-]+/g, "-")}`,
  );
  const trainerSign = await request(storage, `/object/sign/${bucketId}`, {
    method: "POST",
    headers: headers(tokens.trainer, { "content-type": "application/json" }),
    body: JSON.stringify({ expiresIn: 60, paths: ["e612-fixture.pdf"] }),
  });
  const signedUrl = Array.isArray(trainerSign.body)
    ? trainerSign.body[0]?.signedURL
    : trainerSign.body?.signedURL;
  assert(
    "storage.trainer_sign_positive",
    trainerSign.response.ok && typeof signedUrl === "string" && signedUrl.length > 0,
  );
  const signedDownload = await requestAbsolute(
    signedUrl.startsWith("/") ? signedUrl : `/storage/v1/object/sign/${bucketId}/${signedUrl}`,
    { headers: headers(tokens.trainer) },
  );
  assert(
    "storage.signed_download_positive",
    signedDownload.response.ok && signedDownload.text.includes("E612 synthetic storage fixture"),
  );
  const trainerList = await request(storage, `/object/list/${bucketId}`, {
    method: "POST",
    headers: headers(tokens.trainer, { "content-type": "application/json" }),
    body: JSON.stringify({
      prefix: "",
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  assert(
    "storage.trainer_list_positive",
    trainerList.response.ok &&
      Array.isArray(trainerList.body) &&
      trainerList.body.some((row) => row.name === "e612-fixture.pdf"),
  );
  for (const [label, token] of [
    ["anon", anonKey],
    ["pending", tokens.pending],
    ["active", tokens.clientActive],
    ["no_grant", tokens.clientNoGrant],
    ["revoked", tokens.clientRevoked],
    ["wrong_org", tokens.wrongOrg],
  ])
    await storageDenied(label, token);

  const providerBucket = await request(storage, "/bucket", {
    method: "POST",
    headers: headers(adminToken, { "content-type": "application/json" }),
    body: JSON.stringify({ id: "provider-documents", name: "provider-documents", public: false }),
  });
  assert(
    "storage.provider_bucket_ready",
    providerBucket.response.ok ||
      providerBucket.response.status === 409 ||
      providerBucket.body?.statusCode === 409 ||
      providerBucket.body?.code === "BucketAlreadyExists",
    `status_${providerBucket.response.status}`,
  );
  const providerKey = `org/${id.orgA}/provider/${id.provider}/e612-provider-family/1/e612-provider.pdf`;
  const providerUpload = await request(storage, `/object/provider-documents/${providerKey}`, {
    method: "POST",
    headers: headers(adminToken, { "content-type": "application/pdf", "x-upsert": "true" }),
    body: pdf,
  });
  assert(
    "storage.provider_service_upload",
    providerUpload.response.ok,
    `status_${providerUpload.response.status}`,
  );
  const providerBillingGet = await request(storage, `/object/provider-documents/${providerKey}`, {
    headers: headers(tokens.billing),
  });
  assert(
    "storage.provider_billing_get_positive",
    providerBillingGet.response.ok && providerBillingGet.text === pdf,
    `status_${providerBillingGet.response.status}`,
  );
  const providerList = await request(storage, "/object/list/provider-documents", {
    method: "POST",
    headers: headers(tokens.billing, { "content-type": "application/json" }),
    body: JSON.stringify({
      prefix: `org/${id.orgA}/provider/${id.provider}/e612-provider-family/1`,
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  assert(
    "storage.provider_billing_list_positive",
    providerList.response.ok &&
      Array.isArray(providerList.body) &&
      providerList.body.some((row) => row.name === "e612-provider.pdf"),
  );
  for (const [label, token] of [
    ["anon", anonKey],
    ["pending", tokens.pending],
    ["active", tokens.clientActive],
    ["no_grant", tokens.clientNoGrant],
    ["revoked", tokens.clientRevoked],
    ["wrong_org", tokens.wrongOrg],
  ])
    await storageDenied(
      `provider_${label}`,
      token,
      "provider-documents",
      providerKey,
      `org/${id.orgA}/provider/${id.provider}/e612-provider-family/1`,
    );

  const payerIntent = await request(app, "/api/payer-forms/upload-intent", {
    method: "POST",
    headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: JSON.stringify({
      templateId,
      label: "E612 Payer Form",
      fileName: "e612-payer.pdf",
      fileSize: Buffer.byteLength(pdf),
      mimeType: "application/pdf",
    }),
  });
  assert(
    "app.payer_form_upload_intent_positive",
    payerIntent.response.status === 200 && typeof payerIntent.body?.data?.uploadUrl === "string",
    `status_${payerIntent.response.status}`,
  );
  const payerUpload = await requestAbsolute(payerIntent.body.data.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "x-upsert": "true" },
    body: pdf,
  });
  assert(
    "app.payer_form_signed_upload_positive",
    payerUpload.response.ok,
    `status_${payerUpload.response.status}`,
  );
  const payerFinalize = await request(app, "/api/payer-forms/finalize", {
    method: "POST",
    headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: JSON.stringify({
      templateId,
      familyId: payerIntent.body.data.familyId,
      version: payerIntent.body.data.version,
      label: "E612 Payer Form",
      fileName: "e612-payer.pdf",
      mimeType: "application/pdf",
      fileSize: Buffer.byteLength(pdf),
    }),
  });
  assert(
    "app.payer_form_finalize_positive",
    [200, 201].includes(payerFinalize.response.status) &&
      typeof payerFinalize.body?.data?.id === "string",
    `status_${payerFinalize.response.status}`,
  );
  const payerFormId = payerFinalize.body.data.id;
  const payerDownload = await request(app, `/api/payer-forms/${payerFormId}/download`, {
    headers: headers(tokens.billing, { "x-org-id": id.orgA }),
  });
  assert(
    "app.payer_form_download_positive",
    payerDownload.response.status === 200 && typeof payerDownload.body?.data?.url === "string",
    `status_${payerDownload.response.status}`,
  );
  const payerBytes = await requestAbsolute(payerDownload.body.data.url, {
    headers: headers(tokens.billing),
  });
  assert(
    "app.payer_form_download_bytes",
    payerBytes.response.ok && payerBytes.text === pdf,
    `status_${payerBytes.response.status}`,
  );
  const appSigningDenied = async (label, path, token, orgId = id.orgA) => {
    const result = await request(app, path, {
      headers: orgId ? headers(token, { "x-org-id": orgId }) : headers(token),
    });
    assert(
      `app.${label}_signing_denied`,
      [401, 403].includes(result.response.status) && result.body?.data === null,
      `status_${result.response.status}`,
    );
  };
  for (const [label, token, orgId] of [
    ["payer_anon", anonKey, null],
    ["payer_pending", tokens.pending, id.orgA],
    ["payer_active", tokens.clientActive, id.orgA],
    ["payer_no_grant", tokens.clientNoGrant, id.orgA],
    ["payer_revoked", tokens.clientRevoked, id.orgA],
    ["payer_wrong_org", tokens.wrongOrg, id.orgB],
  ]) {
    await appSigningDenied(label, `/api/payer-forms/${payerFormId}/download`, token, orgId);
  }
  const payerRows = await request(rest, `/payer_forms?id=eq.${payerFormId}&select=id`, {
    headers: headers(tokens.billing),
  });
  assert(
    "rest.billing_payer_forms_positive",
    payerRows.response.ok &&
      Array.isArray(payerRows.body) &&
      payerRows.body.some((row) => row.id === payerFormId),
  );
  for (const [label, token] of [
    ["active", tokens.clientActive],
    ["pending", tokens.pending],
    ["no_grant", tokens.clientNoGrant],
    ["revoked", tokens.clientRevoked],
  ]) {
    const result = await request(rest, `/payer_forms?id=eq.${payerFormId}&select=id`, {
      headers: headers(token),
    });
    assert(
      `rest.${label}_payer_forms_denied`,
      result.response.ok && Array.isArray(result.body) && result.body.length === 0,
      `status_${result.response.status}`,
    );
  }

  const documentIntent = await request(app, "/api/documents/upload-intent", {
    method: "POST",
    headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: JSON.stringify({
      ownerType: "provider",
      ownerId: id.provider,
      kind: "state_license",
      fileName: "e612-provider-state-license.pdf",
      fileSize: Buffer.byteLength(licensePdf),
      mimeType: "application/pdf",
    }),
  });
  assert(
    "app.provider_document_upload_intent_positive",
    documentIntent.response.status === 200 &&
      typeof documentIntent.body?.data?.uploadUrl === "string",
    `status_${documentIntent.response.status}`,
  );
  const documentUpload = await requestAbsolute(documentIntent.body.data.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "x-upsert": "true" },
    body: licensePdf,
  });
  assert("app.provider_document_signed_upload_positive", documentUpload.response.ok);
  const documentFinalize = await request(app, "/api/documents/finalize", {
    method: "POST",
    headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: JSON.stringify({
      ownerType: "provider",
      ownerId: id.provider,
      kind: "state_license",
      familyId: documentIntent.body.data.familyId,
      versionNumber: documentIntent.body.data.versionNumber,
      fileName: "e612-provider-state-license.pdf",
      mimeType: "application/pdf",
      effectiveDate: "2026-01-01",
      expirationDate: "2030-01-01",
    }),
  });
  assert(
    "app.provider_document_finalize_positive",
    [200, 201].includes(documentFinalize.response.status) &&
      typeof documentFinalize.body?.data?.id === "string",
    `status_${documentFinalize.response.status}`,
  );
  const documentId = documentFinalize.body.data.id;
  const { PROFILE_HTTP } = await import("/tmp/e612-profile-http-fixtures.mjs");
  const { runE612ProfileHttpProbes } = await import("/tmp/e612-profile-http-probes.mjs");
  await runE612ProfileHttpProbes({
    id,
    tokens,
    request,
    headers,
    assert,
    app,
    rest,
    anonKey,
    fixtures: PROFILE_HTTP,
  });
  const { runE613HttpProbes } = await import("/tmp/e613-http-probes.mjs");
  await runE613HttpProbes({
    id,
    tokens,
    request,
    headers,
    assert,
    app,
    rest,
    anonKey,
    documentId,
    licensePdf,
    globalPayerId,
  });
  const documentDownload = await request(app, `/api/documents/${documentId}/download`, {
    headers: headers(tokens.billing, { "x-org-id": id.orgA }),
  });
  assert(
    "app.provider_document_download_positive",
    documentDownload.response.status === 200 &&
      typeof documentDownload.body?.data?.url === "string",
  );
  const documentBytes = await requestAbsolute(documentDownload.body.data.url, {
    headers: headers(tokens.billing),
  });
  assert(
    "app.provider_document_download_bytes",
    documentBytes.response.ok && documentBytes.text === licensePdf,
  );
  for (const [label, token, orgId] of [
    ["document_anon", anonKey, null],
    ["document_pending", tokens.pending, id.orgA],
    ["document_active", tokens.clientActive, id.orgA],
    ["document_no_grant", tokens.clientNoGrant, id.orgA],
    ["document_revoked", tokens.clientRevoked, id.orgA],
    ["document_wrong_org", tokens.wrongOrg, id.orgB],
  ]) {
    await appSigningDenied(label, `/api/documents/${documentId}/download`, token, orgId);
  }

  const health = await request(app, "/api/health");
  assert("app.health", health.response.status === 200 && health.body?.data === "ok");
  const context = await request(app, "/api/me/access-context", {
    headers: headers(tokens.clientActive),
  });
  assert(
    "app.restricted_context",
    context.response.status === 200 &&
      context.body?.data?.restrictedExternal === true &&
      context.body?.data?.globalTraining === false &&
      context.response.headers.has("x-minted-context-revision"),
  );
  const activeRevision = context.response.headers.get("x-minted-context-revision");
  const selected = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.clientActive, { "content-type": "application/json" }),
    body: JSON.stringify({ audience: "client", orgId: id.orgA, contextRevision: activeRevision }),
  });
  assert(
    "app.context_select_positive",
    selected.response.status === 200 &&
      selected.body?.data?.selectedOrgId === id.orgA &&
      selected.response.headers.get("x-minted-context-revision") === activeRevision,
  );
  const portalApi = await request(app, "/api/portals", {
    headers: headers(tokens.billing, { "x-org-id": id.orgA }),
  });
  assert(
    "app.org_portals_positive",
    portalApi.response.status === 200 &&
      Array.isArray(portalApi.body?.data) &&
      portalApi.body.data.some((row) => row.id === id.orgPortal && row.orgId === id.orgA),
    `status_${portalApi.response.status}_error_${String(portalApi.body?.error ?? "none")
      .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
      .slice(0, 120)}`,
  );
  const training = await request(app, "/api/shared-portals", { headers: headers(tokens.trainer) });
  const trainingContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.trainer),
  });
  assert(
    "app.zero_membership_context",
    trainingContext.response.status === 200 && trainingContext.body?.data?.globalTraining === true,
    `status_${trainingContext.response.status}`,
  );
  assert(
    "app.zero_membership_training_positive",
    training.response.status === 200 &&
      Array.isArray(training.body?.data) &&
      training.body.data.some((row) => row.portalKey === "e612-training"),
    `status_${training.response.status}`,
  );
  const trainerFieldMaps = await request(app, "/api/shared-field-maps", {
    headers: headers(tokens.trainer),
  });
  assert(
    "app.trainer_shared_field_maps_positive",
    trainerFieldMaps.response.status === 200 &&
      Array.isArray(trainerFieldMaps.body?.data) &&
      trainerFieldMaps.body.data.some((row) => row.id === fieldMapId),
  );
  const restrictedTraining = await request(app, "/api/shared-portals", {
    headers: headers(tokens.clientActive),
  });
  assert(
    "app.restricted_training_denied",
    restrictedTraining.response.status === 403 && restrictedTraining.body?.data === null,
  );
  const forged = await request(app, `/api/me/access-context?actorUserId=${id.trainer}`, {
    headers: headers(tokens.clientActive),
  });
  assert(
    "app.forged_query_actor_denied",
    forged.response.status === 400 && forged.body?.data === null,
  );
  const forgedHeader = await request(app, "/api/me/access-context", {
    headers: headers(tokens.clientActive, { "x-actor-user-id": id.trainer }),
  });
  assert(
    "app.forged_metadata_actor_denied",
    forgedHeader.response.status === 400 && forgedHeader.body?.data === null,
  );
  const forgedBody = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.clientActive, { "content-type": "application/json" }),
    body: JSON.stringify({
      actorUserId: id.trainer,
      audience: "client",
      orgId: id.orgA,
      contextRevision: activeRevision,
    }),
  });
  assert(
    "app.forged_body_actor_denied",
    forgedBody.response.status === 400 && forgedBody.body?.data === null,
  );
  const missingRevision = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.clientActive, { "content-type": "application/json" }),
    body: JSON.stringify({ audience: "client", orgId: id.orgA }),
  });
  assert(
    "app.context_revision_required",
    missingRevision.response.status === 422 && missingRevision.body?.data === null,
  );
  const staleRevision = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.clientActive, { "content-type": "application/json" }),
    body: JSON.stringify({
      audience: "client",
      orgId: id.orgA,
      contextRevision: "00000000000000000000000000000000",
    }),
  });
  assert(
    "app.context_revision_mismatch",
    staleRevision.response.status === 409 && staleRevision.body?.data === null,
  );

  const noGrantContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.clientNoGrant),
  });
  assert(
    "app.no_grant_context",
    noGrantContext.response.status === 200 &&
      noGrantContext.body?.data?.restrictedExternal === true &&
      noGrantContext.body?.data?.clientOrgs?.some(
        (org) => org.orgId === id.orgA && org.groups.length === 0,
      ),
  );
  const revokedContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.clientRevoked),
  });
  assert(
    "app.revoked_context",
    revokedContext.response.status === 200 &&
      revokedContext.body?.data?.restrictedExternal === true &&
      revokedContext.body?.data?.clientOrgs?.length === 0,
  );
  const wrongOrgContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.wrongOrg),
  });
  assert(
    "app.wrong_org_context",
    wrongOrgContext.response.status === 200 &&
      wrongOrgContext.body?.data?.selectedOrgId === id.orgB &&
      wrongOrgContext.body?.data?.clientOrgs?.some((org) => org.orgId === id.orgB),
  );
  const wrongOrgSelect = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.wrongOrg, { "content-type": "application/json" }),
    body: JSON.stringify({
      audience: "client",
      orgId: id.orgA,
      contextRevision: wrongOrgContext.response.headers.get("x-minted-context-revision"),
    }),
  });
  assert(
    "app.wrong_org_select_denied",
    wrongOrgSelect.response.status === 403 && wrongOrgSelect.body?.data === null,
  );
  const dualStaff = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.dual, { "content-type": "application/json" }),
    body: JSON.stringify({
      audience: "staff",
      orgId: id.orgA,
      contextRevision: (
        await request(app, "/api/me/access-context", { headers: headers(tokens.dual) })
      ).response.headers.get("x-minted-context-revision"),
    }),
  });
  assert(
    "app.dual_staff_context",
    dualStaff.response.status === 200 && dualStaff.body?.data?.audience === "staff",
  );
  const dualContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.dual),
  });
  const dualClient = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.dual, { "content-type": "application/json" }),
    body: JSON.stringify({
      audience: "client",
      orgId: id.orgA,
      contextRevision: dualContext.response.headers.get("x-minted-context-revision"),
    }),
  });
  assert(
    "app.dual_client_context",
    dualClient.response.status === 200 &&
      dualClient.body?.data?.audience === "client" &&
      dualClient.body?.data?.restrictedExternal === false &&
      dualClient.body?.data?.clientOrgs?.some(
        (org) =>
          org.orgId === id.orgA &&
          Array.isArray(org.groups) &&
          org.groups
            .map((group) => group.groupId)
            .sort()
            .join(",") === id.groupA1,
      ),
  );

  const pendingContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.pending),
  });
  assert(
    "app.pending_context_restricted",
    pendingContext.response.status === 200 &&
      pendingContext.body?.data?.restrictedExternal === true,
  );
  const pendingClaim = await request(app, "/api/me/client-invites/claim", {
    method: "POST",
    headers: headers(tokens.pending, { "content-type": "application/json" }),
    body: JSON.stringify({ token: "e612-pending-token-aaaaaaaa" }),
  });
  assert(
    "app.pending_claim_positive",
    pendingClaim.response.status === 200 &&
      pendingClaim.body?.data?.accessId &&
      pendingClaim.body?.data?.organizationId === id.orgA &&
      JSON.stringify([...pendingClaim.body.data.groupIds].sort()) ===
        JSON.stringify([id.groupA1, id.groupA2].sort()),
  );
  const pendingRefreshedContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.pending),
  });
  const pendingGroupScope = (pendingRefreshedContext.body?.data?.clientOrgs ?? []).find(
    (org) => org.orgId === id.orgA,
  );
  assert(
    "app.pending_claim_refreshed_context_groups",
    pendingRefreshedContext.response.status === 200 &&
      Array.isArray(pendingGroupScope?.groups) &&
      pendingGroupScope.groups
        .map((group) => group.groupId)
        .sort()
        .join(",") === [id.groupA1, id.groupA2].sort().join(",") &&
      typeof pendingRefreshedContext.response.headers.get("x-minted-context-revision") === "string",
    `status_${pendingRefreshedContext.response.status}`,
  );
  const pendingSelectedContext = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: headers(tokens.pending, { "content-type": "application/json" }),
    body: JSON.stringify({
      audience: "client",
      orgId: id.orgA,
      contextRevision: pendingRefreshedContext.response.headers.get("x-minted-context-revision"),
    }),
  });
  assert(
    "app.pending_claim_refreshed_context",
    pendingSelectedContext.response.status === 200 &&
      pendingSelectedContext.body?.data?.restrictedExternal === true &&
      pendingSelectedContext.body?.data?.globalTraining === false &&
      pendingSelectedContext.body?.data?.selectedOrgId === id.orgA &&
      Array.isArray(pendingSelectedContext.body?.data?.clientOrgs) &&
      pendingSelectedContext.body.data.clientOrgs.some(
        (org) =>
          org.orgId === id.orgA &&
          Array.isArray(org.groups) &&
          org.groups
            .map((group) => group.groupId)
            .sort()
            .join(",") === [id.groupA1, id.groupA2].sort().join(","),
      ) &&
      typeof pendingSelectedContext.response.headers.get("x-minted-context-revision") === "string",
    `status_${pendingSelectedContext.response.status}`,
  );
  const pendingReplay = await request(app, "/api/me/client-invites/claim", {
    method: "POST",
    headers: headers(tokens.pending, { "content-type": "application/json" }),
    body: JSON.stringify({ token: "e612-pending-token-aaaaaaaa" }),
  });
  assert(
    "app.pending_claim_replay_denied",
    pendingReplay.response.status === 409 && pendingReplay.body?.data === null,
  );
  const preEmailPayers = await request(rest, "/rpc/list_global_payers", {
    method: "POST",
    headers: headers(tokens.emailChange, { "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "rest.preclaim_email_change_global_denied",
    preEmailPayers.response.ok &&
      Array.isArray(preEmailPayers.body) &&
      preEmailPayers.body.length === 0,
  );
  await storageDenied("preclaim_email_change", tokens.emailChange);
  const preEmailBootstrap = await rpc(
    "create_organization",
    { p_name: "E612 pre-email-change denied" },
    tokens.emailChange,
  );
  expectServiceError(
    "rest.preclaim_email_change_bootstrap_denied",
    preEmailBootstrap,
    "Restricted client cannot create an organization",
  );
  const mismatchInvite = await rpc(
    "create_client_invite",
    {
      p_actor_user_id: id.admin,
      p_org_id: id.orgA,
      p_recipient_email: "email-change@e612.test",
      p_group_ids: [id.groupA1],
    },
    adminToken,
  );
  assert(
    "rest.email_change_mismatch_invite_positive",
    mismatchInvite.response.ok && typeof mismatchInvite.body?.token === "string",
  );
  const emailChange = await request(auth, `/admin/users/${id.emailChange}`, {
    method: "PUT",
    headers: headers(adminToken, { "content-type": "application/json" }),
    body: JSON.stringify({ email: "changed-email@e612.test", email_confirm: true }),
  });
  assert(
    "auth.email_change_positive",
    emailChange.response.ok,
    `status_${emailChange.response.status}`,
  );
  const oldEmailPayers = await request(rest, "/rpc/list_global_payers", {
    method: "POST",
    headers: headers(tokens.emailChange, { "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "rest.email_change_old_token_global_denied",
    oldEmailPayers.response.ok &&
      Array.isArray(oldEmailPayers.body) &&
      oldEmailPayers.body.length === 0,
  );
  await storageDenied("email_change_old_token", tokens.emailChange);
  const oldEmailBootstrap = await rpc(
    "create_organization",
    { p_name: "E612 old email token denied" },
    tokens.emailChange,
  );
  expectServiceError(
    "rest.email_change_old_token_bootstrap_denied",
    oldEmailBootstrap,
    "Restricted client cannot create an organization",
  );
  const changedEmailToken = await signIn("changed-email@e612.test");
  const postEmailPayers = await request(rest, "/rpc/list_global_payers", {
    method: "POST",
    headers: headers(changedEmailToken, { "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "rest.postclaim_email_change_global_denied",
    postEmailPayers.response.ok &&
      Array.isArray(postEmailPayers.body) &&
      postEmailPayers.body.length === 0,
  );
  await storageDenied("postclaim_email_change", changedEmailToken);
  const postEmailBootstrap = await rpc(
    "create_organization",
    { p_name: "E612 post-email-change denied" },
    changedEmailToken,
  );
  expectServiceError(
    "rest.postclaim_email_change_bootstrap_denied",
    postEmailBootstrap,
    "Restricted client cannot create an organization",
  );
  const oldPendingContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.emailChange),
  });
  assert(
    "app.email_change_old_token_restricted",
    oldPendingContext.response.status === 200 &&
      oldPendingContext.body?.data?.restrictedExternal === true,
  );
  const changedPendingContext = await request(app, "/api/me/access-context", {
    headers: headers(changedEmailToken),
  });
  assert(
    "app.email_change_new_token_restricted",
    changedPendingContext.response.status === 200 &&
      changedPendingContext.body?.data?.restrictedExternal === true,
  );
  const emailMismatchClaim = await request(app, "/api/me/client-invites/claim", {
    method: "POST",
    headers: headers(changedEmailToken, { "content-type": "application/json" }),
    body: JSON.stringify({ token: mismatchInvite.body.token }),
  });
  assert(
    "app.email_change_claim_mismatch_denied",
    emailMismatchClaim.response.status === 401 &&
      emailMismatchClaim.body?.data === null &&
      emailMismatchClaim.body?.error === "Verified session required",
  );
  const expiredClaim = await request(app, "/api/me/client-invites/claim", {
    method: "POST",
    headers: headers(tokens.clientNoGrant, { "content-type": "application/json" }),
    body: JSON.stringify({ token: "e612-expired-token-bbbbbbbb" }),
  });
  assert(
    "app.expired_claim_denied",
    expiredClaim.response.status === 409 && expiredClaim.body?.data === null,
  );

  for (const [label, token] of [
    ["billing", tokens.billing],
    ["specialist", tokens.specialist],
    ["member", tokens.memberOnly],
    ["restricted", tokens.clientActive],
  ]) {
    const inviteDenied = await request(app, "/api/internal/client-invites", {
      method: "POST",
      headers: headers(token, { "x-org-id": id.orgA, "content-type": "application/json" }),
      body: JSON.stringify({
        orgId: id.orgA,
        recipientEmail: "changed-email@e612.test",
        groupIds: [id.groupA1],
      }),
    });
    assert(
      `app.${label}_invite_denied`,
      inviteDenied.response.status === 403 && inviteDenied.body?.data === null,
    );
  }
  const adminInvite = await request(app, "/api/internal/client-invites", {
    method: "POST",
    headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: JSON.stringify({
      orgId: id.orgA,
      recipientEmail: "changed-email@e612.test",
      groupIds: [id.groupA1],
    }),
  });
  assert(
    "app.admin_invite_positive",
    adminInvite.response.status === 201 && typeof adminInvite.body?.data?.token === "string",
  );
  const wrongGroupGrant = await request(
    app,
    `/api/internal/client-access/${id.accessActive}/groups`,
    {
      method: "PUT",
      headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
      body: JSON.stringify({ groupIds: [id.groupB1] }),
    },
  );
  assert(
    "app.same_org_group_denied",
    wrongGroupGrant.response.status === 422 && wrongGroupGrant.body?.data === null,
  );
  const validGroupGrant = await request(
    app,
    `/api/internal/client-access/${id.accessActive}/groups`,
    {
      method: "PUT",
      headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
      body: JSON.stringify({ groupIds: [id.groupA1] }),
    },
  );
  assert(
    "app.admin_group_grant_positive",
    validGroupGrant.response.status === 200 &&
      validGroupGrant.body?.data?.accessId === id.accessActive &&
      JSON.stringify(validGroupGrant.body?.data?.groupIds) === JSON.stringify([id.groupA1]),
  );
  const replacementContext = await request(app, "/api/me/access-context", {
    headers: headers(tokens.clientActive),
  });
  assert(
    "app.group_replacement_context",
    replacementContext.response.status === 200 &&
      replacementContext.body?.data?.clientOrgs?.some(
        (org) =>
          org.orgId === id.orgA &&
          Array.isArray(org.groups) &&
          org.groups.length === 1 &&
          org.groups[0].groupId === id.groupA1,
      ),
  );
  const assertActiveGroupState = async (label) => {
    const current = await request(app, "/api/me/access-context", {
      headers: headers(tokens.clientActive),
    });
    assert(
      `app.${label}_groups_unchanged`,
      current.response.status === 200 &&
        current.body?.data?.clientOrgs?.some(
          (org) =>
            org.orgId === id.orgA &&
            Array.isArray(org.groups) &&
            org.groups.length === 1 &&
            org.groups[0].groupId === id.groupA1,
        ),
      `status_${current.response.status}`,
    );
  };
  for (const [label, token, orgId] of [
    ["billing", tokens.billing, id.orgA],
    ["specialist", tokens.specialist, id.orgA],
    ["member", tokens.memberOnly, id.orgA],
    ["restricted", tokens.clientActive, id.orgA],
    ["wrong_org_admin", tokens.orgBAdmin, id.orgB],
  ]) {
    const setDenied = await request(app, `/api/internal/client-access/${id.accessActive}/groups`, {
      method: "PUT",
      headers: headers(token, { "x-org-id": orgId, "content-type": "application/json" }),
      body: JSON.stringify({ groupIds: [id.groupA2] }),
    });
    assert(
      `app.${label}_group_management_denied`,
      setDenied.response.status === 403 && setDenied.body?.data === null,
      `status_${setDenied.response.status}`,
    );
    await assertActiveGroupState(`${label}_set_denied`);
    const revokeDenied = await request(
      app,
      `/api/internal/client-access/${id.accessActive}/revoke`,
      {
        method: "POST",
        headers: headers(token, { "x-org-id": orgId, "content-type": "application/json" }),
        body: "{}",
      },
    );
    assert(
      `app.${label}_revoke_management_denied`,
      revokeDenied.response.status === 403 && revokeDenied.body?.data === null,
      `status_${revokeDenied.response.status}`,
    );
    await assertActiveGroupState(`${label}_revoke_denied`);
  }
  const restrictedGroupMutation = await request(
    app,
    `/api/internal/client-access/${id.accessActive}/groups`,
    {
      method: "PUT",
      headers: headers(tokens.clientActive, { "content-type": "application/json" }),
      body: JSON.stringify({ groupIds: [id.groupA1] }),
    },
  );
  assert(
    "app.restricted_group_mutation_denied",
    restrictedGroupMutation.response.status === 403 && restrictedGroupMutation.body?.data === null,
  );
  const restrictedFieldMaps = await request(app, "/api/shared-field-maps", {
    headers: headers(tokens.clientActive),
  });
  assert(
    "app.restricted_shared_field_maps_denied",
    restrictedFieldMaps.response.status === 403 && restrictedFieldMaps.body?.data === null,
  );
  for (const [path, method, body] of [
    [
      "/api/shared-field-maps",
      "POST",
      { portalKey: "e612-training", selector: "#x", fieldLabel: "X" },
    ],
    ["/api/shared-portals/prove", "POST", { portalKey: "e612-training" }],
    ["/api/shared-test-fills", "POST", { portalKey: "e612-training", orgId: id.orgA }],
  ]) {
    const result = await request(app, path, {
      method,
      headers: headers(tokens.clientActive, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    assert(
      `app.restricted_${path.slice(5).replaceAll("/", "_")}_denied`,
      result.response.status === 403 && result.body?.data === null,
    );
  }
  const raceRevision = noGrantContext.response.headers.get("x-minted-context-revision");
  let releaseRaceBody;
  const raceBody = new ReadableStream({
    start(controller) {
      releaseRaceBody = () => {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({ audience: "client", orgId: id.orgA, contextRevision: raceRevision }),
          ),
        );
        controller.close();
      };
    },
  });
  const heldSelection = fetch(`${app}/api/me/access-context/select`, {
    method: "POST",
    headers: headers(tokens.clientNoGrant, { "content-type": "application/json" }),
    body: raceBody,
    duplex: "half",
    signal: AbortSignal.timeout(10_000),
  });
  await pause(250);
  const raceRevoke = await request(app, `/api/internal/client-access/${id.accessNoGrant}/revoke`, {
    method: "POST",
    headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "app.authority_read_race_revoke_positive",
    raceRevoke.response.status === 200 && raceRevoke.body?.data?.accessId === id.accessNoGrant,
  );
  releaseRaceBody();
  const heldResult = await heldSelection;
  const heldBody = JSON.parse(await heldResult.text());
  assert(
    "app.authority_read_race_stale_selection_denied",
    heldResult.status === 409 && heldBody?.data === null,
    `status_${heldResult.status}`,
  );
  const revoke = await request(app, `/api/internal/client-access/${id.accessActive}/revoke`, {
    method: "POST",
    headers: headers(tokens.admin, { "x-org-id": id.orgA, "content-type": "application/json" }),
    body: "{}",
  });
  assert(
    "app.admin_revoke_positive",
    revoke.response.status === 200 && revoke.body?.data?.accessId === id.accessActive,
  );
  const afterRevoke = await request(app, "/api/me/access-context", {
    headers: headers(tokens.clientActive),
  });
  assert(
    "app.revocation_context_refresh",
    afterRevoke.response.status === 200 &&
      afterRevoke.body?.data?.restrictedExternal === true &&
      afterRevoke.body?.data?.clientOrgs?.length === 0 &&
      afterRevoke.response.headers.get("x-minted-context-revision") !== activeRevision,
  );
  process.stdout.write("E612|HTTP|PASS\n");
}
main().catch((error) => {
  process.stdout.write(`${error instanceof Error ? error.message : "E612_HTTP_DRIVER_FAILED"}\n`);
  process.exitCode = 1;
});
