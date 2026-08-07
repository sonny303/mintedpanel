import { test, expect, type Route } from "@playwright/test";

// People contact roles + the contact-token default holder (decisions D1/D5/D6/D8,
// 2026-08-07). Three things this pins that all fail SILENTLY:
//
//   TS-141  the three formerly-reserved roles are assignable — the governed list
//           drives the picker, so a stale is_active would just re-disable them
//           with no error anywhere.
//   TS-142  exactly one holder per (org, role) is the DEFAULT, and that is what
//           the billingContact.*/credentialingContact.*/contractingSigner.*
//           token families resolve. A second holder must land NON-default and
//           be promotable in one click (demote-then-promote).
//   TS-143  the name is captured SPLIT and the retained `name` display column is
//           COMPOSED from the halves on write; the cross-org "Add existing"
//           reuse pool (F0.3.4) is gone with D8.
//
// The harness writes through POST/PATCH into the fixtures so the
// invalidate-and-refetch loop runs for real, and records every request payload
// so the assertions check the wire, not just the rendering.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const PARTY_OWNER = "66666666-6666-4666-8666-666666666666";
const PARTY_SECOND = "77777777-7777-4777-8777-777777777777";

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
    email: "test@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Test User" },
    created_at: "2026-08-07T00:00:00Z",
  },
};

interface AssignmentRow {
  id: string;
  org_id: string;
  party_id: string;
  role_key: string;
  scope_type: string;
  scope_id: string | null;
  is_default: boolean;
  created_at: string;
}

interface PartyRow {
  id: string;
  org_id: string;
  party_type: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone_office: string | null;
  phone_extension: string | null;
  phone_mobile: string | null;
  fax: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  created_by: string;
  created_at: string;
}

function party(over: Partial<PartyRow>): PartyRow {
  return {
    id: PARTY_OWNER,
    org_id: ORG_A,
    party_type: "person",
    name: "",
    first_name: null,
    last_name: null,
    title: null,
    email: null,
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
    created_at: "2026-08-07T00:00:00Z",
    ...over,
  };
}

function baseFixtures(): Record<string, unknown[]> {
  return {
    organizations: [
      {
        id: ORG_A,
        name: "Rose City Rehab Collective",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_A,
        role: "admin",
        organizations: {
          name: "Rose City Rehab Collective",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Test User",
        email: "test@example.test",
        created_at: "2026-08-07T00:00:00Z",
      },
    ],
    notes: [],
    user_table_prefs: [],
    parties: [
      party({
        id: PARTY_OWNER,
        name: "Jane Owner",
        first_name: "Jane",
        last_name: "Owner",
        email: "jane@example.test",
        phone_office: "555-555-0100",
        address_line1: "123 Main St",
        city: "Portland",
        state: "OR",
        postal_code: "97201",
      }),
      party({
        id: PARTY_SECOND,
        name: "Sam Second",
        first_name: "Sam",
        last_name: "Second",
        email: "sam@example.test",
        phone_office: "555-555-0200",
        address_line1: "9 Second Ave",
        city: "Portland",
        state: "OR",
        postal_code: "97202",
      }),
    ],
    party_role_assignments: [
      {
        id: "a1",
        org_id: ORG_A,
        party_id: PARTY_OWNER,
        role_key: "owner",
        scope_type: "org",
        scope_id: null,
        is_default: true,
        created_at: "2026-08-07T00:00:00Z",
      } satisfies AssignmentRow,
    ],
    // The three formerly-reserved roles are ACTIVE now (migration
    // 20260807130000). The picker reads this list, so it is the fixture that
    // decides whether they are offerable.
    party_role_types: [
      { role_key: "owner", label: "Authorized contact", is_active: true },
      { role_key: "customer_escalation_contact", label: "Organization contact", is_active: true },
      { role_key: "sales_rep", label: "Sales Rep", is_active: true },
      { role_key: "billing_contact", label: "Billing Contact", is_active: true },
      { role_key: "contracting_signer", label: "Contracting Signer", is_active: true },
      { role_key: "credentialing_contact", label: "Credentialing Contact", is_active: true },
    ],
    inbound_leads: [],
    party_capture_links: [],
    audit_log: [],
  };
}

interface Recorded {
  method: string;
  table: string;
  url: string;
  body: unknown;
}

function makeHandler(fixtures: Record<string, unknown[]>, recorded: Recorded[]) {
  return async function fulfillSupabase(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    if (req.method() !== "GET") {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = req.postData();
      }
      recorded.push({ method: req.method(), table, url: req.url(), body });
    }

    if (table === "party_role_assignments") {
      const rows = fixtures.party_role_assignments as AssignmentRow[];

      if (req.method() === "POST") {
        const payload = req.postDataJSON() as Partial<AssignmentRow>;
        const row: AssignmentRow = {
          id: `a${rows.length + 1}`,
          org_id: payload.org_id ?? ORG_A,
          party_id: payload.party_id ?? "",
          role_key: payload.role_key ?? "",
          scope_type: payload.scope_type ?? "org",
          scope_id: null,
          is_default: Boolean(payload.is_default),
          created_at: new Date().toISOString(),
        };
        rows.push(row);
        return json([row], 201);
      }

      if (req.method() === "PATCH") {
        const payload = req.postDataJSON() as { is_default?: boolean };
        const roleEq = (url.searchParams.get("role_key") ?? "").replace("eq.", "");
        const partyEq = (url.searchParams.get("party_id") ?? "").replace("eq.", "");
        const defaultEq = url.searchParams.get("is_default");
        for (const row of rows) {
          if (roleEq && row.role_key !== roleEq) continue;
          if (partyEq && row.party_id !== partyEq) continue;
          if (defaultEq === "eq.true" && !row.is_default) continue;
          row.is_default = Boolean(payload.is_default);
        }
        return json([], 200);
      }

      if (req.method() === "DELETE") {
        const partyId = (url.searchParams.get("party_id") ?? "").replace("eq.", "");
        const roleKey = (url.searchParams.get("role_key") ?? "").replace("eq.", "");
        fixtures.party_role_assignments = rows.filter(
          (a) => !(a.party_id === partyId && (!roleKey || a.role_key === roleKey)),
        );
        return route.fulfill({ status: 204, contentType: "application/json", body: "" });
      }

      const selectParam = url.searchParams.get("select") ?? "";
      // The default-holder probe in assignRole: a narrow id read filtered to
      // the role's existing default.
      if (selectParam.trim() === "id") {
        const roleEq = (url.searchParams.get("role_key") ?? "").replace("eq.", "");
        return json(
          rows.filter((r) => r.role_key === roleEq && r.is_default).map((r) => ({ id: r.id })),
        );
      }
      if (selectParam.includes("parties")) {
        const partyMap = Object.fromEntries((fixtures.parties as PartyRow[]).map((p) => [p.id, p]));
        return json(
          rows.map((a) => ({
            role_key: a.role_key,
            is_default: a.is_default,
            parties: partyMap[a.party_id] ?? null,
          })),
        );
      }
      return json(rows);
    }

    if (table === "parties") {
      if (req.method() === "POST") {
        const payload = req.postDataJSON() as Partial<PartyRow>;
        const row = party({ ...payload, id: `new-${(fixtures.parties as unknown[]).length + 1}` });
        (fixtures.parties as PartyRow[]).push(row);
        return json([row], 201);
      }
      if (req.method() === "PATCH") {
        return json([(fixtures.parties as PartyRow[])[0]], 200);
      }
    }

    if (table === "audit_log" && req.method() === "POST") {
      return json([], 201);
    }

    const rows = fixtures[table] ?? [];
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
}

async function bootWorkspace(context: import("@playwright/test").BrowserContext) {
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      window.localStorage.setItem(authKey as string, JSON.stringify(session));
      window.localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_A] as const,
  );
}

test("TS-141: the three formerly-reserved roles are assignable, and the first holder becomes the default", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const recorded: Recorded[] = [];
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, recorded));
  await bootWorkspace(context);

  await page.goto("/org-detail");
  await expect(page.getByText("Jane Owner").first()).toBeVisible();
  const card = page.locator("div.rounded-md.border", { hasText: "Jane Owner" }).last();

  // The role picker offers Billing Contact as SELECTABLE — "(coming soon)" was
  // the reserved-role rendering and must be gone for all three.
  await card.getByRole("combobox").first().click();
  const billing = page.getByRole("option", { name: /Billing Contact/ });
  await expect(billing).toBeVisible();
  await expect(billing).not.toHaveText(/coming soon/);
  await expect(page.getByRole("option", { name: /Contracting Signer/ })).not.toHaveText(
    /coming soon/,
  );
  await expect(page.getByRole("option", { name: /Credentialing Contact/ })).not.toHaveText(
    /coming soon/,
  );
  await billing.click();

  // The FIRST holder of a role is written as its default, so the contact token
  // family resolves immediately instead of sitting null until someone notices.
  await expect
    .poll(() => recorded.filter((r) => r.table === "party_role_assignments" && r.method === "POST"))
    .toHaveLength(1);
  const post = recorded.find(
    (r) => r.table === "party_role_assignments" && r.method === "POST",
  )!;
  expect(post.body).toMatchObject({
    org_id: ORG_A,
    role_key: "billing_contact",
    scope_type: "org",
    is_default: true,
  });

  // The chip now carries the role AND marks it as the org's default holder —
  // the only holder, so there is nothing to promote.
  await expect(card.getByText("Billing Contact", { exact: false }).first()).toBeVisible();
  await expect(card.getByLabel("Billing Contact — used for form fields")).toBeVisible();
  await expect(
    card.getByRole("button", { name: /Use this person for Billing Contact/ }),
  ).toHaveCount(0);
});

test("TS-142: a second holder lands non-default and is promoted in one click (demote, then promote)", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  // Jane already holds billing_contact as the org's default.
  (fixtures.party_role_assignments as AssignmentRow[]).push({
    id: "a2",
    org_id: ORG_A,
    party_id: PARTY_OWNER,
    role_key: "billing_contact",
    scope_type: "org",
    scope_id: null,
    is_default: true,
    created_at: "2026-08-07T00:00:00Z",
  });
  // Sam is in the org holding an unrelated role.
  (fixtures.party_role_assignments as AssignmentRow[]).push({
    id: "a3",
    org_id: ORG_A,
    party_id: PARTY_SECOND,
    role_key: "sales_rep",
    scope_type: "org",
    scope_id: null,
    is_default: true,
    created_at: "2026-08-07T00:00:00Z",
  });

  const recorded: Recorded[] = [];
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, recorded));
  await bootWorkspace(context);

  await page.goto("/org-detail");
  await expect(page.getByText("Sam Second")).toBeVisible();

  const samCard = page.locator("div.rounded-md.border", { hasText: "Sam Second" }).last();
  await samCard.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Billing Contact/ }).click();

  // Jane is already the default, so Sam's row must NOT claim it — the partial
  // unique index would reject two, and silently stealing it would repoint every
  // billingContact.* token without anyone asking for that.
  const post = await expect
    .poll(() =>
      recorded.find(
        (r) =>
          r.table === "party_role_assignments" &&
          r.method === "POST" &&
          (r.body as { role_key?: string }).role_key === "billing_contact",
      ),
    )
    .toBeTruthy()
    .then(() =>
      recorded.find(
        (r) =>
          r.table === "party_role_assignments" &&
          r.method === "POST" &&
          (r.body as { role_key?: string }).role_key === "billing_contact",
      ),
    );
  expect(post!.body).toMatchObject({ party_id: PARTY_SECOND, is_default: false });

  // Promote Sam: demote-then-promote, never a single write that could leave two
  // defaults for the same (org, role).
  await samCard.getByRole("button", { name: /Use this person for Billing Contact/ }).click();
  await expect
    .poll(() =>
      recorded.filter((r) => r.table === "party_role_assignments" && r.method === "PATCH").length,
    )
    .toBe(2);
  const patches = recorded.filter(
    (r) => r.table === "party_role_assignments" && r.method === "PATCH",
  );
  expect(patches[0].body).toEqual({ is_default: false });
  expect(patches[0].url).toContain("is_default=eq.true");
  expect(patches[1].body).toEqual({ is_default: true });
  expect(patches[1].url).toContain(`party_id=eq.${PARTY_SECOND}`);

  const defaults = (fixtures.party_role_assignments as AssignmentRow[]).filter(
    (a) => a.role_key === "billing_contact" && a.is_default,
  );
  expect(defaults).toHaveLength(1);
  expect(defaults[0].party_id).toBe(PARTY_SECOND);
});

test("TS-143: a new person is captured with a split name and no cross-org reuse door", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const recorded: Recorded[] = [];
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, recorded));
  await bootWorkspace(context);

  await page.goto("/org-detail");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  // D8 retired the cross-org reuse pool, so its entry point must be gone —
  // otherwise a party could still be shared between two orgs.
  await expect(page.getByRole("button", { name: "Add existing" })).toHaveCount(0);

  await page.getByRole("button", { name: /Add person/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#new-party-first-name").fill("Dana");
  await dialog.locator("#new-party-last-name").fill("Reyes");
  await dialog.locator("#new-party-title").fill("Managing Partner");
  await dialog.locator("#new-party-email").fill("dana@example.test");
  await dialog.locator("#new-party-phone").fill("503-555-0150");
  await dialog.locator("#new-party-ext").fill("204");
  await dialog.locator("#new-party-line1").fill("500 NW Everett St");
  await dialog.locator("#new-party-city").fill("Portland");
  await dialog.locator("#new-party-zip").fill("97209");
  await dialog.locator("#new-party-state").click();
  await page.getByRole("option", { name: "OR", exact: true }).click();
  // The dialog also requires a role before it will write anything.
  await dialog.getByRole("combobox").last().click();
  await page.getByRole("option", { name: /Billing Contact/ }).click();

  await dialog.getByRole("button", { name: /^Add person$/ }).click();

  const post = await expect
    .poll(() => recorded.find((r) => r.table === "parties" && r.method === "POST"))
    .toBeTruthy()
    .then(() => recorded.find((r) => r.table === "parties" && r.method === "POST"));
  // The halves are stored AND the retained display column is composed from
  // them — never typed separately, so the two can never disagree.
  expect(post!.body).toMatchObject({
    org_id: ORG_A,
    first_name: "Dana",
    last_name: "Reyes",
    name: "Dana Reyes",
    title: "Managing Partner",
    phone_extension: "204",
  });
});
