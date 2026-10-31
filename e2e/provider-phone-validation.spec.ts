// MINT-91 — provider phone validation (staging, Oct 24: "abc-def-ghij" saved
// with no check):
//   PH-01  the record's inline edit rejects a phone with letters and sends no
//          write; a corrected US number saves as one diff-only PATCH.
//   PH-02  an untouched legacy phone never blocks an unrelated edit.
//   PH-03  Add Provider stops on the Personal step for a phone with letters.
import { test, expect, type BrowserContext, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "88888888-8888-4888-8888-888888888888";
const PHONE_ERROR = "Enter a 10-digit US phone number";

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

const provider = (phone: string) => ({
  id: "pr-brooke",
  org_id: ORG_ID,
  first_name: "Brooke",
  last_name: "Ostrander",
  credentials: "PT",
  gender: null,
  npi: "1093817462",
  status: "active",
  verification_state: "verified",
  reference_only: false,
  home_state: "NC",
  specialty: "Physical Therapy",
  taxonomy_code: "225100000X",
  email: "provider@example.test",
  phone,
  group_id: "g-ob",
  start_date: "2026-06-01",
  caqh_id: "16224897",
  caqh_last_attested_date: "2026-07-01",
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  is_new_grad: false,
  terminated_date: null,
  is_test_provider: false,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

function fixtures(phone: string): Record<string, Record<string, unknown>[]> {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Outer Banks Rehab Group",
        lifecycle_state: "active",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        id: "m-1",
        org_id: ORG_ID,
        user_id: USER_ID,
        role: "admin",
        created_at: "2026-06-01T00:00:00Z",
        organizations: {
          name: "Outer Banks Rehab Group",
          lifecycle_state: "active",
          created_at: "2026-06-01T00:00:00Z",
        },
        profiles: { full_name: "Sowmya Seed", email: "sowmya.seed@example.test" },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Sowmya Seed",
        email: "sowmya.seed@example.test",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    provider_groups: [
      {
        id: "g-ob",
        org_id: ORG_ID,
        name: "Outer Banks Rehab Group LLC",
        tin: "123456789",
        states: ["NC"],
        is_active: true,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    providers: [provider(phone)],
    provider_group_assignments: [
      {
        id: "ga-1",
        org_id: ORG_ID,
        provider_id: "pr-brooke",
        group_id: "g-ob",
        is_primary: true,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
  };
}

interface Write {
  method: string;
  table: string;
  body: unknown;
}

// Minimal PostgREST mock: GET filters by eq., PATCH merges into the matched
// rows, every unknown table reads as empty and every RPC returns 0.
function mock(data: Record<string, Record<string, unknown>[]>) {
  const writes: Write[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const rows = (data[table] ?? []).filter((row) =>
      [...url.searchParams.entries()].every(
        ([key, raw]) =>
          !(key in row) || !raw.startsWith("eq.") || String(row[key]) === raw.slice(3),
      ),
    );
    if (req.method() === "HEAD") {
      return route.fulfill({ status: 200, headers: { "content-range": `*/${rows.length}` } });
    }
    if (req.method() !== "GET") {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      writes.push({ method: req.method(), table, body });
      if (req.method() === "PATCH") {
        for (const row of rows) Object.assign(row, (body ?? {}) as Record<string, unknown>);
      }
    }
    if (wantsObject) {
      return rows[0] ? json(rows[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
    }
    return json(rows);
  };
  return { handler, writes };
}

async function open(context: BrowserContext, data: Record<string, Record<string, unknown>[]>) {
  const { handler, writes } = mock(data);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
  return writes;
}

const providerPatches = (writes: Write[]) =>
  writes.filter((w) => w.method === "PATCH" && w.table === "providers");

test("PH-01: the record edit rejects a phone with letters and writes nothing; a US number saves", async ({
  context,
  page,
}) => {
  const writes = await open(context, fixtures("252-555-0100"));
  await page.goto("/providers/pr-brooke");
  await expect(page.getByRole("heading", { name: "Provider Info" })).toBeVisible({
    timeout: 30000,
  });

  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Phone", { exact: true }).fill("abc-def-ghij");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${PHONE_ERROR}.`)).toBeVisible();
  expect(providerPatches(writes)).toHaveLength(0);

  await page.getByLabel("Phone", { exact: true }).fill("+1 (252) 555-0199 ext. 4");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("+1 (252) 555-0199 ext. 4")).toBeVisible({ timeout: 15000 });
  expect(providerPatches(writes).map((w) => w.body)).toEqual([
    { phone: "+1 (252) 555-0199 ext. 4" },
  ]);
});

test("PH-02: an untouched legacy phone never blocks an unrelated edit", async ({
  context,
  page,
}) => {
  const writes = await open(context, fixtures("abc-def-ghij"));
  await page.goto("/providers/pr-brooke");
  await expect(page.getByRole("heading", { name: "Provider Info" })).toBeVisible({
    timeout: 30000,
  });

  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Email", { exact: true }).fill("brooke@example.test");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("brooke@example.test")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(`${PHONE_ERROR}.`)).toHaveCount(0);
  expect(providerPatches(writes).map((w) => w.body)).toEqual([{ email: "brooke@example.test" }]);
});

test("PH-03: Add Provider stops on the Personal step for a phone with letters", async ({
  context,
  page,
}) => {
  const writes = await open(context, fixtures("252-555-0100"));
  await page.goto("/providers/new");
  await page.getByLabel("First name", { exact: true }).fill("Nora", { timeout: 30000 });
  await page.getByLabel("Last name", { exact: true }).fill("Newton");
  await page.getByLabel("Phone", { exact: true }).fill("abc-def-ghij");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(PHONE_ERROR, { exact: true })).toBeVisible();
  // Still on Personal: the Credentials step's NPI field never rendered.
  await expect(page.getByLabel("NPI", { exact: true })).toHaveCount(0);

  await page.getByLabel("Phone", { exact: true }).fill("252-555-0100");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("NPI", { exact: true })).toBeVisible();
  expect(writes.filter((w) => w.table === "providers")).toHaveLength(0);
});
