import { test, expect, type Route } from "@playwright/test";

// E0.5 TE-7/TE-6 — the PUBLIC inbound "contact us" route (/contact). No token, no
// session. Mocks the anon submit_inbound_lead RPC. A submitted inquiry becomes a
// triaged lead (verified server-side elsewhere); here we assert the public form
// validates required fields and reaches the thank-you state.
//
// The second test closes the loop operator-side (E4.2 golden-path step 1):
// the triage queue on /get-started converts a NEW lead into a PROSPECT org via
// the 3-arg create_organization (owner = the lead's contact), marks the lead
// converted with the new org id, and drops it from the queue.

async function fulfill(route: Route) {
  const url = new URL(route.request().url());
  const json = (b: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  if (url.pathname.endsWith("/rpc/submit_inbound_lead")) return json({ ok: true });
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
  if (url.pathname.includes("/auth/v1/")) return json({});
  return json([]);
}

test("public contact form submits to a lead and shows the thank-you state (F0.5.5)", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, fulfill);
  await page.goto("/contact");

  await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible({ timeout: 30000 });

  // Required-field gate: submitting empty surfaces errors and does not advance.
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Organization name is required")).toBeVisible();

  await page.locator("#lead-org").fill("Dillon Sports Medicine");
  await page.locator("#lead-name").fill("Coach Eric Taylor");
  await page.locator("#lead-email").fill("coach@dillon.example.test");
  await page.locator("#lead-phone").fill("432-555-0118");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thanks for reaching out")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Operator-side triage: inbound lead → prospect organization (F0.5.5 convert).
// Authenticated mock harness per the CLAUDE.md recipe.
// ---------------------------------------------------------------------------

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ORG_ID = "99999999-9999-4999-8999-999999999999";

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

const LEAD = {
  id: "lead-1",
  org_name: "Capeside Physical Therapy",
  contact_name: "Dawson Leery",
  contact_email: "dawson@capeside.example.test",
  contact_phone: "508-555-0199",
  company_website: "",
  status: "new",
  converted_org_id: null,
  created_at: "2026-07-15T00:00:00Z",
};

interface OperatorWrite {
  kind: string;
  body: Record<string, unknown> | null;
}

function makeOperatorHandler() {
  const fixtures: Record<string, Record<string, unknown>[]> = {
    memberships: [
      { org_id: ORG_ID, role: "admin", organizations: { name: "Dillon Sports Medicine" } },
    ],
    profiles: [{ id: USER_ID, full_name: "Sowmya Seed", email: "sowmya.seed@example.test" }],
    inbound_leads: [{ ...LEAD }],
    party_role_assignments: [],
    notes: [],
    user_table_prefs: [],
  };
  const writes: OperatorWrite[] = [];

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/create_organization") && req.method() === "POST") {
      writes.push({
        kind: "rpc/create_organization",
        body: req.postDataJSON() as Record<string, unknown>,
      });
      return json(NEW_ORG_ID);
    }
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    if (table === "inbound_leads" && req.method() === "PATCH") {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ kind: "patch/inbound_leads", body });
      const idFilter = url.searchParams.get("id") ?? "";
      const id = idFilter.startsWith("eq.") ? idFilter.slice(3) : idFilter;
      const row = fixtures.inbound_leads.find((r) => r.id === id);
      if (row) Object.assign(row, body);
      return json(null, 204);
    }

    const rows = fixtures[table] ?? [];
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, writes };
}

test("operator converts an inbound lead into a prospect org and the queue clears (F0.5.5 / golden-path step 1)", async ({
  context,
  page,
}) => {
  const { handler, writes } = makeOperatorHandler();
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );

  await page.goto("/get-started");

  // The shared triage inbox renders the NEW lead with its captured contact.
  await expect(page.getByText("New inbound inquiries")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Capeside Physical Therapy")).toBeVisible();
  await expect(page.getByText("Dawson Leery", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Convert to org" }).click();

  // Convert = the E0.1 3-arg create_organization: the lead's org name becomes a
  // PROSPECT org (lifecycle set server-side by the RPC) and its contact the owner.
  await expect(page.getByText("Created Capeside Physical Therapy as a prospect")).toBeVisible({
    timeout: 15000,
  });
  const rpc = writes.find((w) => w.kind === "rpc/create_organization");
  expect(rpc?.body).toMatchObject({
    p_name: "Capeside Physical Therapy",
    p_owner_name: "Dawson Leery",
    p_owner_email: "dawson@capeside.example.test",
  });

  // The lead is marked converted and LINKED to the new org — history preserved,
  // never deleted.
  const patch = writes.find((w) => w.kind === "patch/inbound_leads");
  expect(patch?.body).toMatchObject({ status: "converted", converted_org_id: NEW_ORG_ID });

  // A converted lead leaves the NEW queue; with nothing to triage the panel hides.
  await expect(page.getByText("New inbound inquiries")).toHaveCount(0);
});
