// MINT-96 — the internal Add Provider wizard (/providers/new):
//   * skipping the Licenses step shows "No licenses added" on Review (never
//     the default blank row) and writes no state_licenses row;
//   * Start date opens blank and stays null on the provider when left blank;
//     with a facility selected, a hint and the Review Facilities row name the
//     browser-local today that the facility assignments will be saved with;
//   * an entered Start date clears the hint and saves on both.
import { test, expect, type Page, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "88888888-8888-4888-8888-888888888888";
const ORG_NAME = "Outer Banks Rehab Group";
const GROUP_NAME = "Outer Banks Rehab Group LLC";
const FACILITY_NAME = "Kill Devil Hills Clinic";

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

function fixtures(): Record<string, Record<string, unknown>[]> {
  const created_at = "2026-06-01T00:00:00Z";
  return {
    organizations: [{ id: ORG_ID, name: ORG_NAME, lifecycle_state: "active", created_at }],
    memberships: [
      {
        id: "m-1",
        org_id: ORG_ID,
        user_id: USER_ID,
        role: "admin",
        created_at,
        organizations: { name: ORG_NAME, lifecycle_state: "active", created_at },
        profiles: { full_name: "Sowmya Seed", email: "sowmya.seed@example.test" },
      },
    ],
    profiles: [
      { id: USER_ID, full_name: "Sowmya Seed", email: "sowmya.seed@example.test", created_at },
    ],
    provider_groups: [
      {
        id: "g-ob",
        org_id: ORG_ID,
        name: GROUP_NAME,
        tin: "123456789",
        states: ["NC"],
        is_active: true,
        created_at,
      },
    ],
    facilities: [
      {
        id: "f-1",
        org_id: ORG_ID,
        group_id: "g-ob",
        name: FACILITY_NAME,
        state: "NC",
        is_active: true,
        reference_only: false,
        hours: {},
        created_at,
      },
    ],
    providers: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    state_licenses: [],
  };
}

interface Write {
  method: string;
  table: string;
  body: unknown;
}

function mockSupabase(rows: Record<string, Record<string, unknown>[]>) {
  const writes: Write[] = [];
  let seq = 0;
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const matches = (row: Record<string, unknown>) =>
      [...url.searchParams.entries()].every(
        ([key, raw]) =>
          !raw.startsWith("eq.") || !(key in row) || String(row[key]) === raw.slice(3),
      );
    if (req.method() === "HEAD") {
      const n = (rows[table] ?? []).filter(matches).length;
      return route.fulfill({ status: 200, headers: { "content-range": `*/${n}` }, body: "" });
    }
    if (req.method() !== "GET") {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      writes.push({ method: req.method(), table, body });
      if (req.method() === "POST") {
        const list = Array.isArray(body) ? body : [body ?? {}];
        const inserted = list.map((b) => ({
          id: `new-${(seq += 1)}`,
          created_at: "2026-07-19T00:00:00Z",
          ...(b as Record<string, unknown>),
        }));
        rows[table]?.push(...inserted);
        return json(wantsObject ? inserted[0] : inserted, 201);
      }
      return json([]);
    }
    const found = (rows[table] ?? []).filter(matches);
    if (wantsObject) {
      return found.length > 0
        ? json(found[0])
        : json({ code: "PGRST116", message: "no rows" }, 406);
    }
    return json(found);
  };
  return { handler, writes };
}

async function openWizard(page: Page) {
  const mock = mockSupabase(fixtures());
  await page.context().route(/\/(rest|auth)\/v1\//, mock.handler);
  await page.context().addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
  await page.goto("/providers/new");
  await expect(page.getByRole("heading", { name: "Add provider" })).toBeVisible({
    timeout: 30000,
  });
  // The browser's own calendar date, in both spellings the wizard uses.
  const today = await page.evaluate(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    };
  });
  return { ...mock, today };
}

/** Names → Next past Credentials and Licenses (untouched) → Employment, group picked. */
async function reachEmployment(page: Page) {
  await page.getByLabel("First name", { exact: true }).fill("Taylor");
  await page.getByLabel("Last name", { exact: true }).fill("Provider");
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByText("Select group").click();
  await page.getByRole("option", { name: GROUP_NAME }).click();
}

function reviewValue(page: Page, label: string) {
  return page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=../dd");
}

function postBody(writes: Write[], table: string) {
  return writes.find((w) => w.method === "POST" && w.table === table)?.body;
}

test("MINT-96: skipped Licenses read 'No licenses added'; a blank start date stays null and the assignments' today is shown before save", async ({
  page,
}) => {
  const { writes, today } = await openWizard(page);
  await reachEmployment(page);
  const startDate = page.getByLabel("Start date", { exact: true });
  const hint = page.getByText(`If left blank, facility assignments start today (${today.label}).`, {
    exact: true,
  });
  await expect(startDate).toHaveValue("");
  await expect(hint).toHaveCount(0);
  await page.getByRole("checkbox", { name: FACILITY_NAME }).click();
  await expect(hint).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("No licenses added", { exact: true })).toBeVisible();
  await expect(page.getByText(/— · — · —/)).toHaveCount(0);
  await expect(reviewValue(page, "Start date")).toHaveText("—");
  await expect(reviewValue(page, "Facilities")).toHaveText(
    `${FACILITY_NAME} (primary) · assignments start ${today.label}`,
  );

  await page.getByRole("button", { name: "Create provider" }).click();
  await expect.poll(() => postBody(writes, "provider_facility_assignments")).toBeTruthy();
  expect(postBody(writes, "providers")).toHaveProperty("start_date", null);
  expect(postBody(writes, "provider_facility_assignments")).toEqual([
    expect.objectContaining({ facility_id: "f-1", is_primary: true, start_date: today.iso }),
  ]);
  expect(writes.filter((w) => w.table === "state_licenses")).toEqual([]);
});

test("MINT-96: an entered start date clears the hint and saves on the provider and the assignments", async ({
  page,
}) => {
  const { writes } = await openWizard(page);
  await reachEmployment(page);
  await page.getByRole("checkbox", { name: FACILITY_NAME }).click();
  await expect(page.getByText(/^If left blank, facility assignments start today/)).toBeVisible();
  await page.getByLabel("Start date", { exact: true }).fill("2026-11-02");
  await expect(page.getByText(/^If left blank, facility assignments start today/)).toHaveCount(0);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(reviewValue(page, "Start date")).toHaveText("Nov 2, 2026");
  await expect(reviewValue(page, "Facilities")).toHaveText(
    `${FACILITY_NAME} (primary) · assignments start Nov 2, 2026`,
  );

  await page.getByRole("button", { name: "Create provider" }).click();
  await expect.poll(() => postBody(writes, "provider_facility_assignments")).toBeTruthy();
  expect(postBody(writes, "providers")).toHaveProperty("start_date", "2026-11-02");
  expect(postBody(writes, "provider_facility_assignments")).toEqual([
    expect.objectContaining({ facility_id: "f-1", start_date: "2026-11-02" }),
  ]);
});
