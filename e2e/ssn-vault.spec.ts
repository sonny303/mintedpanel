import { test, expect, type Route, type Page, type BrowserContext } from "@playwright/test";

// E4.4 Sensitive Identifiers Vault — the full SSN lives ONLY in the server-only
// vault (no client SELECT grant, encrypted at rest); every app surface renders
// at most the mask ***--1234. The sandbox/CI can't reach *.supabase.co, so this
// mocks the REST layer + the vault RPCs via context.route.
//
//   TS-84  universal masking + no ordinary read path decrypts (the app never
//          queries provider_ssn_vault; a direct PostgREST read returns nothing)
//   TS-86  admin Click-to-Reveal with justification; non-admin never sees it
//   TS-87  both ingress paths (public intake link + internal secure modal) and
//          the intake-link lockdown states
//
// FAKE test SSN only (900-55-6789 — the 900 area is never issued). Never a real SSN.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const FAKE_SSN = "900556789";

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

function providerRow(over: Record<string, unknown> = {}) {
  return {
    id: PROVIDER_ID,
    org_id: ORG_ID,
    first_name: "Brooke",
    last_name: "Ostrander",
    credentials: "PT",
    npi: "1234567890",
    caqh_id: null,
    specialty: "Physical Therapy",
    taxonomy_code: null,
    dea_number: null,
    date_of_birth: "1990-01-01",
    ssn_last4: "6789",
    email: "brooke@example.test",
    phone: "252-555-0101",
    start_date: "2026-06-01",
    home_street: "1 Sandbar Ln",
    home_city: "Nags Head",
    home_state: "NC",
    home_zip: "27959",
    status: "active",
    verification_state: "verified",
    reference_only: false,
    group_id: null,
    ...over,
  };
}

function makeFixtures(role: string, provider: Record<string, unknown>) {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Outer Banks Rehab Group",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        role,
        organizations: {
          name: "Outer Banks Rehab Group",
          lifecycle_state: "active",
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
    providers: [provider],
  } as Record<string, unknown[]>;
}

interface Recorder {
  vaultReads: number;
  rpcCalls: Array<{ name: string; body: unknown }>;
}

async function seedAuth(context: BrowserContext) {
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
}

// Mount the authenticated REST/RPC mock. `rpc` supplies bodies for the vault
// RPCs (reveal_ssn / store_ssn); everything else is the standard fixture shape.
async function mountAuth(
  context: BrowserContext,
  fixtures: Record<string, unknown[]>,
  rpc: Record<string, unknown>,
): Promise<Recorder> {
  const rec: Recorder = { vaultReads: 0, rpcCalls: [] };
  await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);

    // Zero-trust vault: a direct table read has NO grant — return nothing.
    // Record any hit so the test can prove the app never reads it.
    if (url.pathname.includes("/rest/v1/provider_ssn_vault")) {
      rec.vaultReads += 1;
      return json({ code: "42501", message: "permission denied" }, 401);
    }

    const rpcMatch = url.pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    if (rpcMatch) {
      const name = rpcMatch[1];
      let body: unknown = null;
      try {
        body = req.postData() ? JSON.parse(req.postData() as string) : null;
      } catch {
        body = null;
      }
      rec.rpcCalls.push({ name, body });
      if (name === "get_sop_field_tokens") return json([]);
      if (name in rpc) return json(rpc[name]);
      return json(0);
    }

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    const rows = fixtures[table] ?? [];
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    if (req.method() === "POST" || req.method() === "PATCH") return json(null, 201);
    return json(rows);
  });
  await seedAuth(context);
  return rec;
}

async function openProviderDetail(page: Page) {
  await page.goto(`/providers/${PROVIDER_ID}`);
  await expect(page.getByRole("heading", { name: /Brooke Ostrander/ })).toBeVisible({
    timeout: 30000,
  });
}

test.describe("E4.4 authenticated vault surfaces", () => {
  test("TS-84: SSN renders as the mask; the app never reads the vault; a direct read returns nothing", async ({
    context,
    page,
  }) => {
    const rec = await mountAuth(context, makeFixtures("admin", providerRow()), {});
    await openProviderDetail(page);

    // The mask, never the full value.
    await expect(page.getByText("***--6789").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("900-55-6789");
    await expect(page.locator("body")).not.toContainText("900556789");

    // No ordinary read path touched the vault while rendering the provider.
    expect(rec.vaultReads).toBe(0);

    // A direct PostgREST read of the vault returns nothing (no grant).
    const probe = await page.evaluate(async () => {
      const res = await fetch("https://example.supabase.co/rest/v1/provider_ssn_vault?select=*", {
        headers: { apikey: "anon", authorization: "Bearer fake-access-token" },
      });
      return { status: res.status, text: await res.text() };
    });
    expect(probe.status).toBe(401);
    expect(probe.text).not.toContain("900");
    expect(rec.vaultReads).toBe(1); // only the explicit probe, never the app
  });

  test("TS-86: an admin reveals with a justification and sees the full value briefly", async ({
    context,
    page,
  }) => {
    const rec = await mountAuth(context, makeFixtures("admin", providerRow()), {
      reveal_ssn: { ssn: FAKE_SSN, ssn_last4: "6789" },
    });
    await openProviderDetail(page);

    await page.getByRole("button", { name: "Manage SSN" }).click();
    await page.getByRole("menuitem", { name: "Reveal full SSN" }).click();

    // Justification is required — Reveal is disabled until it's typed.
    const revealBtn = page.getByRole("button", { name: "Reveal", exact: true });
    await expect(revealBtn).toBeDisabled();
    await page.locator("#ssn-reveal-justification").fill("Payer RFI needs the full number");
    await expect(revealBtn).toBeEnabled();
    await revealBtn.click();

    // The full value appears (formatted) once, and the RPC carried the justification.
    await expect(page.getByText("900-55-6789")).toBeVisible();
    const reveal = rec.rpcCalls.find((c) => c.name === "reveal_ssn");
    expect(reveal?.body).toMatchObject({ p_justification: "Payer RFI needs the full number" });
  });

  test("TS-86: a non-admin writer never sees the reveal control", async ({ context, page }) => {
    await mountAuth(context, makeFixtures("specialist", providerRow()), {});
    await openProviderDetail(page);

    await page.getByRole("button", { name: "Manage SSN" }).click();
    // A specialist can enter/update securely (the seeded provider already has an
    // SSN, so the store item reads "Update"), but the reveal item is absent.
    await expect(page.getByRole("menuitem", { name: "Update full SSN" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Reveal full SSN" })).toHaveCount(0);
  });

  test("TS-87: the internal secure modal encrypts on save (store_ssn) and never re-shows the value", async ({
    context,
    page,
  }) => {
    const rec = await mountAuth(
      context,
      makeFixtures("specialist", providerRow({ ssn_last4: null })),
      {
        store_ssn: { ok: true, ssn_last4: "6789", mask: "***--6789" },
      },
    );
    await openProviderDetail(page);

    await page.getByRole("button", { name: "Manage SSN" }).click();
    await page.getByRole("menuitem", { name: "Enter full SSN securely" }).click();

    await expect(page.getByRole("heading", { name: "Enter full SSN securely" })).toBeVisible();
    await page.locator("#ssn-store-input").fill("900556789");
    await page.getByRole("button", { name: "Save securely" }).click();

    // The dialog closes on success; store_ssn carried the full value (only here).
    await expect(page.getByRole("heading", { name: "Enter full SSN securely" })).toHaveCount(0);
    const store = rec.rpcCalls.find((c) => c.name === "store_ssn");
    expect(store?.body).toMatchObject({ p_provider_id: PROVIDER_ID, p_ssn: "900556789" });
  });
});

// ---------------------------------------------------------------------------
// TS-87 — the PUBLIC secure intake route (/ssn-intake/:token). No session.
// ---------------------------------------------------------------------------
const VALIDATE = "/rpc/validate_ssn_intake_token";
const SUBMIT = "/rpc/submit_ssn_intake";

function publicMock(
  validateBody: unknown,
  submitBody: unknown = { ok: true, state: "used", mask: "***--6789" },
) {
  const rec: { submitted: unknown } = { submitted: null };
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname.endsWith(VALIDATE)) return json(validateBody);
    if (url.pathname.endsWith(SUBMIT)) {
      try {
        rec.submitted = route.request().postData()
          ? JSON.parse(route.request().postData() as string)
          : null;
      } catch {
        rec.submitted = null;
      }
      return json(submitBody);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    if (url.pathname.includes("/auth/v1/")) return json({});
    return json([]);
  };
  return { handler, rec };
}

const ACTIVE_INTAKE = {
  state: "active",
  org_name: "Outer Banks Rehab Group",
  provider_name: "Brooke Ostrander",
  recipient_email: "brooke@example.test",
  expires_at: "2026-07-20T17:00:00Z",
};

test.describe("E4.4 public SSN intake route (TS-87)", () => {
  test("active link accepts the SSN and reaches the done state without echoing the value", async ({
    context,
    page,
  }) => {
    const { handler, rec } = publicMock(ACTIVE_INTAKE);
    await context.route(/\/(rest|auth)\/v1\//, handler);
    await page.goto("/ssn-intake/testtoken123");

    await expect(page.getByRole("heading", { name: "Enter Social Security Number" })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Brooke Ostrander", { exact: false })).toBeVisible();

    await page.locator("#ssn-intake-value").fill("900556789");
    await page.getByRole("button", { name: "Submit securely" }).click();

    await expect(page.getByText("Thank you — you're all set")).toBeVisible();
    expect(rec.submitted).toMatchObject({ p_token: "testtoken123", p_ssn: "900556789" });
    // The value is never rendered back on the confirmation.
    await expect(page.locator("body")).not.toContainText("900-55-6789");
  });

  test("a used link shows the already-completed lockdown", async ({ context, page }) => {
    const { handler } = publicMock({
      state: "used",
      org_name: "Outer Banks Rehab Group",
      provider_name: "Brooke Ostrander",
    });
    await context.route(/\/(rest|auth)\/v1\//, handler);
    await page.goto("/ssn-intake/usedtoken");
    await expect(page.getByText("This form is already completed")).toBeVisible({ timeout: 30000 });
  });

  test("an expired link shows the expired lockdown", async ({ context, page }) => {
    const { handler } = publicMock({ state: "expired", org_name: "Outer Banks Rehab Group" });
    await context.route(/\/(rest|auth)\/v1\//, handler);
    await page.goto("/ssn-intake/expiredtoken");
    await expect(page.getByText("This link has expired")).toBeVisible({ timeout: 30000 });
  });

  test("an invalid token never reveals a provider or org", async ({ context, page }) => {
    const { handler } = publicMock({ state: "invalid" });
    await context.route(/\/(rest|auth)\/v1\//, handler);
    await page.goto("/ssn-intake/bogus");
    await expect(page.getByText("This link is no longer valid")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Brooke Ostrander", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Outer Banks", { exact: false })).toHaveCount(0);
  });
});
