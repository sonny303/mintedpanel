// MINT-110 — NPI Registry (NPPES) search and verification for staff, over the
// mock harness. /api/npi-registry/* is mocked at the browser: no request
// reaches our server's registry route, and nothing reaches NPPES.
//   1. Add Provider (/providers/new): a typed dashed NPI is stripped and
//      verified; a name search (plus state) lists matches; the keyboard picks
//      one, which fills the NPI only; the save carries the picked NPI.
//   2. Roster form (/onboarding/wizard → Add provider): a name that differs
//      and a registry outage are both warnings — the provider still saves;
//      the note describes the NPI input and is announced only when the
//      result changes, not on a name keystroke;
//      a failed name search can be retried; junk that is not a dash or space
//      still fails.
import { test, expect, type BrowserContext, type Route } from "./fixtures/legacy-access-context";
import type { NpiRegistryRecord } from "../src/lib/npiRegistry";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

const SESSION = {
  access_token: "fake-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: "fake-refresh-token",
  user: {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "sowmya.seed@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Sowmya Seed" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

const party = (over: Record<string, unknown>) => ({
  party_type: "person",
  first_name: null,
  last_name: null,
  title: null,
  phone_office: null,
  phone_extension: null,
  phone_mobile: null,
  fax: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
  created_by: USER_ID,
  created_at: "2026-07-09T00:00:00Z",
  ...over,
});

function makeFixtures(): Record<string, Record<string, unknown>[]> {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Tree Hill Sports Therapy",
        lifecycle_state: "prospect",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Tree Hill Sports Therapy",
          lifecycle_state: "prospect",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Sowmya Seed",
        email: "sowmya.seed@example.test",
        created_at: "2026-07-09T00:00:00Z",
      },
    ],
    party_role_assignments: [
      {
        org_id: ORG_ID,
        role_key: "owner",
        parties: party({ id: "p-owner", name: "Owner", email: "owner@example.test" }),
      },
      {
        org_id: ORG_ID,
        role_key: "customer_escalation_contact",
        parties: party({
          id: "p-contact",
          name: "Contact",
          email: "contact@example.test",
          phone_office: "704-555-0142",
          address_line1: "100 Main St",
          city: "Charlotte",
          state: "NC",
          postal_code: "28280",
          country: "US",
        }),
      },
    ],
    provider_groups: [
      {
        id: "g-th",
        org_id: ORG_ID,
        name: "Tree Hill Sports Therapy LLC",
        tin: "123456789",
        npi_type2: null,
        states: ["NC"],
        is_active: true,
        created_at: "2026-07-10T00:00:00Z",
        billing_street: "1 Main St",
        billing_city: "Charlotte",
        billing_state: "NC",
        billing_zip: "28280",
        billing_phone: "704-555-0100",
      },
    ],
    facilities: [],
    providers: [],
    state_licenses: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    credential_cases: [],
    status_configs: [],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
  };
}

interface RecordedRequest {
  method: string;
  table: string;
  body: unknown;
}

// Stateful PostgREST mock: eq/in/is filters, write-through POST and PATCH.
function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const requests: RecordedRequest[] = [];
  let seq = 100;
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const matches = (row: Record<string, unknown>) => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.") && String(row[key]) !== raw.slice(3)) return false;
        if (raw === "is.null" && row[key] !== null) return false;
        if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        }
      }
      return true;
    };

    if (req.method() === "HEAD") {
      const n = (fixtures[table] ?? []).filter(matches).length;
      return route.fulfill({ status: 200, headers: { "content-range": `*/${n}` }, body: "" });
    }
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    requests.push({ method: req.method(), table, body });

    if (req.method() === "POST") {
      const rows = (Array.isArray(body) ? body : [body ?? {}]) as Record<string, unknown>[];
      const created = rows.map((row) => ({
        id: `${table}-${(seq += 1)}`,
        created_at: "2026-07-12T00:00:00Z",
        ...row,
      }));
      if (fixtures[table]) fixtures[table].push(...created);
      return json(wantsObject ? created[0] : created, 201);
    }
    if (req.method() === "PATCH") {
      const targets = (fixtures[table] ?? []).filter(matches);
      for (const target of targets) Object.assign(target, (body ?? {}) as Record<string, unknown>);
      if (wantsObject && targets.length !== 1)
        return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(wantsObject ? targets[0] : targets);
    }
    if (req.method() === "DELETE") return json([]);

    const rows = (fixtures[table] ?? []).filter(matches);
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, requests };
}

function seedAuth(context: BrowserContext) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

const registryRecord = (over: Partial<NpiRegistryRecord>): NpiRegistryRecord => ({
  npi: "1234567893",
  enumerationType: "NPI-1",
  firstName: "JANE",
  middleName: null,
  lastName: "DOE",
  organizationName: null,
  credential: "PT",
  primaryTaxonomy: { code: "225100000X", description: "Physical Therapist" },
  practiceCity: "DENVER",
  practiceState: "CO",
  status: "active",
  enumerationDate: "2015-03-02",
  otherNames: [],
  ...over,
});

const DENVER_JANE = registryRecord({});
const BOULDER_JANE = registryRecord({
  npi: "1902833742",
  middleName: "M",
  credential: "DPT",
  practiceCity: "BOULDER",
});

interface RegistryCall {
  path: string;
  body: unknown;
  authorization: string | undefined;
}

// The browser half of /api/npi-registry/*: records every call and answers
// from the two fixture records. `down` makes every lookup a 502.
async function mockRegistry(context: BrowserContext) {
  const calls: RegistryCall[] = [];
  const state = { down: new Set<string>(), searchDown: false };
  await context.route(/\/api\/npi-registry\//, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.split("/").pop() ?? "";
    const body = req.postDataJSON() as Record<string, unknown>;
    calls.push({ path, body, authorization: req.headers()["authorization"] });
    const reply = (status: number, data: unknown, error: string | null = null) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data, error, meta: null }),
      });
    if (path === "search") {
      if (state.searchDown) return reply(502, null, "NPI Registry is unavailable");
      return reply(200, { results: [DENVER_JANE, BOULDER_JANE], truncated: false });
    }
    const npi = String(body.npi);
    if (state.down.has(npi)) return reply(502, null, "NPI Registry is unavailable");
    return reply(200, {
      record: [DENVER_JANE, BOULDER_JANE].find((record) => record.npi === npi) ?? null,
    });
  });
  return { calls, state };
}

test("MINT-110: Add Provider strips and verifies a typed NPI, then picks a registry match by keyboard", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const fixtures = makeFixtures();
  const { handler, requests } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  const registry = await mockRegistry(context);
  await seedAuth(context);

  await page.goto("/providers/new");
  await expect(page.getByRole("heading", { name: "Add provider" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel("First name", { exact: true }).fill("Jane");
  await page.getByLabel("Last name", { exact: true }).fill("Doe");
  await page.getByRole("button", { name: "Next" }).click();

  // A pasted dashed NPI keeps all ten digits and is verified once.
  const npi = page.getByLabel("NPI", { exact: true });
  await npi.fill("123-456-7893");
  await expect(npi).toHaveValue("1234567893");
  await expect(page.getByText("Found in the NPI Registry", { exact: true })).toBeVisible();
  // The input is described by the note, and the result is announced once.
  await expect(npi).toHaveAccessibleDescription(
    /Found in the NPI Registry.*JANE DOE, PT · Physical Therapist · DENVER, CO/,
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Found in the NPI Registry. JANE DOE, PT" }),
  ).toHaveCount(1);
  expect(registry.calls).toEqual([
    { path: "lookup", body: { npi: "1234567893" }, authorization: "Bearer fake-access-token" },
  ]);

  // A field staff typed must survive a pick.
  const attested = page.getByLabel("CAQH last attested date");
  await attested.fill("2026-07-01");

  // Search by the form's name plus a state; only what staff typed is sent.
  await page.getByLabel("NPI Registry search state").click();
  await page.getByRole("option", { name: "CO", exact: true }).click();
  await page.getByRole("button", { name: "Search NPI Registry" }).click();
  await expect(
    page.getByText("2 matches in the NPI Registry. Pick one to fill the NPI."),
  ).toBeVisible();
  expect(registry.calls.at(-1)).toMatchObject({
    path: "search",
    body: { firstName: "Jane", lastName: "Doe", state: "CO" },
  });

  // Keyboard: focus the list, arrow to the second match, Enter picks it.
  const matches = page.getByRole("list", { name: "NPI Registry matches" });
  await matches.getByRole("button").first().focus();
  await page.keyboard.press("ArrowDown");
  // The button's name starts with its visible text (WCAG 2.5.3).
  const boulder = matches.getByRole("button", { name: /^JANE M DOE, DPT NPI 1902833742/ });
  await expect(boulder).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(npi).toHaveValue("1902833742");
  await expect(attested).toHaveValue("2026-07-01");
  await expect(matches).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search NPI Registry" })).toBeFocused();
  await expect(npi).toHaveAccessibleDescription(
    /Found in the NPI Registry.*JANE M DOE, DPT · Physical Therapist · BOULDER, CO/,
  );
  // The picked record seeds the check: no second lookup call.
  expect(registry.calls.filter((call) => call.path === "lookup")).toHaveLength(1);

  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByRole("button", { name: "Create provider" }).click();
  await expect(page.getByRole("heading", { name: "Provider Info" })).toBeVisible({
    timeout: 30000,
  });
  const creates = requests.filter((r) => r.method === "POST" && r.table === "providers");
  expect(creates).toHaveLength(1);
  expect(creates[0].body).toMatchObject({
    first_name: "Jane",
    last_name: "Doe",
    npi: "1902833742",
    caqh_last_attested_date: "2026-07-01",
  });
});

test("MINT-110: roster form saves through a name mismatch and a registry outage; other junk still fails", async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  const fixtures = makeFixtures();
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  const registry = await mockRegistry(context);
  registry.state.down.add("1902833742");
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-providers");
  await card.getByRole("button", { name: "Add provider" }).click({ timeout: 30000 });
  const dialog = page.getByRole("dialog", { name: "Add provider" });
  await dialog.getByLabel("Assign Tree Hill Sports Therapy LLC").click();
  await dialog.locator("#prov-first").fill("Jane");
  await dialog.locator("#prov-last").fill("Roe");

  // Junk other than dashes and spaces still fails, and is never looked up.
  await dialog.locator("#prov-npi").fill("12a4567893");
  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(dialog).toContainText("NPI must be 10 digits");
  expect(fixtures.providers).toHaveLength(0);

  // A spaced NPI is checked; the registry's name differs — a warning only.
  const npi = dialog.locator("#prov-npi");
  await npi.fill("123 456 7893");
  await expect(
    dialog.getByText("Found in the NPI Registry, but the name differs", { exact: true }),
  ).toBeVisible();
  await expect(npi).toHaveAccessibleDescription(
    /but the name differs.*The registry lists JANE DOE/,
  );
  const announced = dialog.getByRole("status").filter({ hasText: "but the name differs" });
  await expect(announced).toHaveCount(1);

  // Fixing the name updates the note but is not announced again.
  await dialog.locator("#prov-last").fill("Doe");
  await expect(dialog.getByText("Found in the NPI Registry", { exact: true })).toBeVisible();
  await expect(announced).toHaveCount(1);
  await expect(
    dialog.getByRole("status").filter({ hasText: "Found in the NPI Registry." }),
  ).toHaveCount(0);

  // The registry is down for the next number — still a warning only.
  await npi.fill("190-283-3742");
  await expect(dialog.getByText("NPI Registry is unavailable", { exact: true })).toBeVisible();
  await expect(npi).toHaveAccessibleDescription(
    /NPI Registry is unavailable.*You can still save this provider\./,
  );
  expect(registry.calls.map((call) => call.body)).toEqual([
    { npi: "1234567893" },
    { npi: "1902833742" },
  ]);

  // A failed name search says so; pressing Search again retries it.
  registry.state.searchDown = true;
  const search = dialog.getByRole("button", { name: "Search NPI Registry" });
  await search.click();
  await expect(
    dialog.getByText("NPI Registry is unavailable. You can still type the NPI."),
  ).toBeVisible();
  registry.state.searchDown = false;
  await search.click();
  await expect(dialog.getByRole("list", { name: "NPI Registry matches" })).toBeVisible();
  expect(registry.calls.filter((call) => call.path === "search")).toHaveLength(2);

  await dialog.getByRole("button", { name: "Save provider" }).click();
  await expect(card).toContainText("Jane Doe", { timeout: 15000 });
  expect(fixtures.providers).toHaveLength(1);
  expect(fixtures.providers[0]).toMatchObject({
    first_name: "Jane",
    last_name: "Doe",
    npi: "1902833742",
  });
});
