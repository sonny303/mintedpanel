import { test, expect as baseExpect, type BrowserContext, type Route } from "@playwright/test";

// The first Vite transform can exceed Playwright's five-second assertion
// default when four Chromium workers start together.
const expect = baseExpect.configure({ timeout: 30_000 });

// E6.12 browser/lifecycle evidence. Every Auth, Supabase REST, and E6.12 API
// call below is synthetic and intercepted locally. This suite proves browser
// gating and lifecycle behavior; it is not Auth/REST/Storage UAT evidence.

const AUTH_KEY = "sb-example-auth-token";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ACTOR_B = "22222222-2222-4222-8222-222222222222";
const STAFF_A = "33333333-3333-4333-8333-333333333333";
const STAFF_B = "44444444-4444-4444-8444-444444444444";
const CLIENT_A = "55555555-5555-4555-8555-555555555555";
const CLIENT_B = "66666666-6666-4666-8666-666666666666";
const GROUP_A = "77777777-7777-4777-8777-777777777777";
const GROUP_B = "88888888-8888-4888-8888-888888888888";
const INVITE_TOKEN = "synthetic-e612-invite-token";

type Audience = "staff" | "client";
type ContextFixture = {
  actorUserId?: string;
  audience?: Audience | null;
  selectedOrgId?: string | null;
  staffOrgs?: Array<{
    orgId: string;
    orgName: string;
    role?: string;
    reportStaff?: boolean;
    clientManage?: boolean;
  }>;
  clientOrgs?: Array<{
    orgId: string;
    orgName: string;
    groups: Array<{ groupId: string; groupName: string }>;
  }>;
  globalTraining?: boolean;
  restrictedExternal?: boolean;
  contextRevision?: string;
};

type FixtureState = {
  context: ContextFixture;
  contextResponses?: Array<{ status: number; body: unknown }>;
  selectionResponses?: Record<string, { status: number; body: unknown }>;
  claimResponses?: Array<{ status: number; body: unknown }>;
  contextDelay?: Promise<void>;
  memberships?: unknown[];
  authTokenRequests: number;
  seenTables: string[];
  selectionRequests: Array<Record<string, unknown>>;
  claimRequests?: Array<Record<string, unknown>>;
};

const SESSION = (id = ACTOR, email = "client@example.test") => ({
  access_token: `synthetic-${id}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: `synthetic-refresh-${id}`,
  user: {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Synthetic E6.12 User" },
    created_at: "2026-07-09T00:00:00Z",
  },
});

const org = (
  id: string,
  name: string,
  lifecycleState = "active",
  createdAt = "2026-07-01T00:00:00Z",
) => ({
  id,
  name,
  lifecycle_state: lifecycleState,
  created_at: createdAt,
});

const membership = (orgId: string, name: string, role = "admin", lifecycleState = "active") => ({
  org_id: orgId,
  role,
  organizations: org(orgId, name, lifecycleState),
});

const clientContext = (overrides: ContextFixture = {}): ContextFixture => ({
  actorUserId: ACTOR,
  email: "client@example.test",
  audience: "client",
  selectedOrgId: CLIENT_A,
  staffOrgs: [],
  clientOrgs: [
    {
      orgId: CLIENT_A,
      orgName: "Client Alpha",
      groups: [{ groupId: GROUP_A, groupName: "Alpha Providers" }],
    },
  ],
  globalTraining: false,
  restrictedExternal: true,
  contextRevision: "rev-client-1",
  ...overrides,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

async function seedAuth(
  browserContext: BrowserContext,
  session = SESSION(),
  activeOrgId: string | null = null,
) {
  await browserContext.addInitScript(
    ([authKey, initialSession, persistedOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(initialSession));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: persistedOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, session, activeOrgId] as const,
  );
}

async function installMockNetwork(browserContext: BrowserContext, state: FixtureState) {
  await browserContext.route(/\/(rest|auth)\/v1\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/token")) {
      state.authTokenRequests += 1;
      return json(route, SESSION());
    }
    if (url.pathname.includes("/auth/v1/")) return json(route, SESSION());
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(route, 0);

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    state.seenTables.push(table);
    if (table === "profiles") {
      const profile = { id: ACTOR, full_name: "Synthetic E6.12 User" };
      return (request.headers().accept ?? "").includes("vnd.pgrst.object")
        ? json(route, profile)
        : json(route, [profile]);
    }
    if (table === "memberships") return json(route, state.memberships ?? []);
    if (table === "organizations") return json(route, []);
    if ((request.headers().accept ?? "").includes("vnd.pgrst.object")) {
      return json(route, { code: "PGRST116", message: "No rows found" }, 406);
    }
    return json(route, []);
  });

  await browserContext.route("**/api/me/access-context**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/select")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.selectionRequests.push(body);
      const key = `${String(body.audience)}:${String(body.orgId)}`;
      const selected = state.selectionResponses?.[key];
      if (selected) {
        return json(
          route,
          selected.status === 200 ? { data: selected.body, error: null } : selected.body,
          selected.status,
        );
      }
      return json(route, { data: { ...state.context, ...body }, error: null });
    }

    if (state.contextDelay) await state.contextDelay;
    const response = state.contextResponses?.shift() ?? { status: 200, body: state.context };
    return json(
      route,
      response.status === 200
        ? { data: response.body, error: null }
        : { data: null, error: "Synthetic context failure" },
      response.status,
      response.status === 200
        ? {
            "X-Minted-Context-Revision": String(
              (response.body as ContextFixture).contextRevision ?? "rev",
            ),
          }
        : undefined,
    );
  });

  await browserContext.route("**/api/me/client-invites/claim**", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.claimRequests?.push(body);
    const response = state.claimResponses?.shift() ?? { status: 200, body: { claimed: true } };
    return json(
      route,
      response.status === 200
        ? { data: response.body, error: null }
        : {
            data: null,
            error: typeof response.body === "string" ? response.body : "Synthetic claim failure",
          },
      response.status,
    );
  });
}

test("blocks shell and staff hooks until a client context resolves", async ({ context, page }) => {
  const gate = deferred();
  const state: FixtureState = {
    context: clientContext(),
    contextDelay: gate.promise,
    memberships: [membership(STAFF_A, "Staff Alpha")],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
  };
  await installMockNetwork(context, state);
  await seedAuth(context, SESSION(), STAFF_A);

  await page.goto("/cases");
  // Startup may still be in the root auth bootstrap frame; either frame is
  // valid only while the protected shell remains absent.
  await expect(page.getByText(/^(Loading\.\.\.|Resolving your access context…)$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
  await expect(page.getByText("Create your first organization", { exact: true })).toHaveCount(0);
  expect(state.seenTables.filter((table) => table.startsWith("cases")).length).toBe(0);

  gate.resolve();
  await expect(page.getByText("Client access context ready")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
});

for (const scenario of [
  {
    name: "pending identity",
    context: clientContext({
      audience: null,
      selectedOrgId: null,
      clientOrgs: [],
      contextRevision: "rev-pending",
    }),
    heading: "Client access is unavailable",
  },
  {
    name: "revoked identity",
    context: clientContext({
      audience: null,
      selectedOrgId: null,
      clientOrgs: [],
      contextRevision: "rev-revoked",
    }),
    heading: "Client access is unavailable",
  },
  {
    name: "active identity without a grant",
    context: clientContext({
      clientOrgs: [{ orgId: CLIENT_A, orgName: "Client Alpha", groups: [] }],
      contextRevision: "rev-no-grant",
    }),
    heading: "No provider groups assigned",
  },
  {
    name: "selected organization without a grant",
    context: clientContext({
      selectedOrgId: CLIENT_A,
      clientOrgs: [
        { orgId: CLIENT_A, orgName: "Client Alpha", groups: [] },
        {
          orgId: CLIENT_B,
          orgName: "Client Beta",
          groups: [{ groupId: GROUP_B, groupName: "Beta Providers" }],
        },
      ],
      contextRevision: "rev-selected-no-grant",
    }),
    heading: "No provider groups assigned",
  },
]) {
  test(`${scenario.name} fails closed before mounting the staff shell`, async ({
    context,
    page,
  }) => {
    const state: FixtureState = {
      context: scenario.context,
      memberships: [],
      authTokenRequests: 0,
      seenTables: [],
      selectionRequests: [],
    };
    await installMockNetwork(context, state);
    await seedAuth(context);

    await page.goto("/cases");
    await expect(page.getByRole("heading", { name: scenario.heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
    await expect(page.getByText("Create your first organization", { exact: true })).toHaveCount(0);
    expect(state.seenTables.some((table) => table.startsWith("cases"))).toBe(false);
  });
}

test("a client-only user with multiple granted orgs chooses the client org explicitly", async ({
  context,
  page,
}) => {
  const clientOnly = {
    actorUserId: ACTOR,
    email: "client@example.test",
    audience: "client",
    selectedOrgId: null,
    staffOrgs: [],
    clientOrgs: [
      {
        orgId: CLIENT_A,
        orgName: "Client Alpha",
        groups: [{ groupId: GROUP_A, groupName: "Alpha Providers" }],
      },
      {
        orgId: CLIENT_B,
        orgName: "Client Beta",
        groups: [{ groupId: GROUP_B, groupName: "Beta Providers" }],
      },
    ],
    globalTraining: false,
    restrictedExternal: true,
    contextRevision: "rev-client-only-discovery",
  } satisfies ContextFixture;
  const state: FixtureState = {
    context: clientOnly,
    selectionResponses: {
      [`client:${CLIENT_B}`]: {
        status: 200,
        body: {
          ...clientOnly,
          audience: "client",
          selectedOrgId: CLIENT_B,
          contextRevision: "rev-client-only-discovery",
        },
      },
    },
    memberships: [],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
  };
  await installMockNetwork(context, state);
  await seedAuth(context, SESSION());

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "Choose a client organization" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Client Alpha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Client Beta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);

  await page.getByRole("button", { name: "Client Beta" }).click();
  await expect(page.getByText("Client access context ready")).toBeVisible();
  await expect(page.getByText("Beta Providers", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
  expect(state.selectionRequests).toEqual([
    {
      audience: "client",
      orgId: CLIENT_B,
      contextRevision: "rev-client-only-discovery",
    },
  ]);
});

test("a dual user in the internal audience is not denied by zero client grants", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    context: {
      actorUserId: ACTOR,
      email: "dual@example.test",
      audience: "staff",
      selectedOrgId: STAFF_A,
      staffOrgs: [
        {
          orgId: STAFF_A,
          orgName: "Staff Alpha",
          role: "admin",
          reportStaff: true,
          clientManage: true,
        },
      ],
      clientOrgs: [{ orgId: CLIENT_A, orgName: "Client Alpha", groups: [] }],
      globalTraining: true,
      restrictedExternal: false,
      contextRevision: "rev-staff-no-client-grants",
    },
    memberships: [membership(STAFF_A, "Staff Alpha")],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
  };
  await installMockNetwork(context, state);
  await seedAuth(context, SESSION(ACTOR, "dual@example.test"), STAFF_A);

  await page.goto("/cases");
  await expect(page.getByRole("link", { name: "Cases" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No provider groups assigned" })).toHaveCount(0);
});

for (const status of [401, 403, 409]) {
  test(`clears a ready client surface after a ${status} context refresh`, async ({
    context,
    page,
  }) => {
    const state: FixtureState = {
      context: clientContext(),
      contextResponses: [
        { status: 200, body: clientContext() },
        { status, body: { rejected: true } },
      ],
      memberships: [],
      authTokenRequests: 0,
      seenTables: [],
      selectionRequests: [],
    };
    await installMockNetwork(context, state);
    await seedAuth(context);

    await page.goto("/cases");
    await expect(page.getByText("Client access context ready")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("heading", { name: "Access context unavailable" })).toBeVisible();
    await expect(page.getByText("Client access context ready")).toHaveCount(0);
    await expect(page.getByText("Alpha Providers", { exact: true })).toHaveCount(0);
  });
}

test("dual-capability users choose audience and organization explicitly, then can switch back", async ({
  context,
  page,
}) => {
  const dual = {
    actorUserId: ACTOR,
    email: "dual@example.test",
    audience: null,
    selectedOrgId: null,
    staffOrgs: [
      {
        orgId: STAFF_A,
        orgName: "Staff Alpha",
        role: "admin",
        reportStaff: true,
        clientManage: true,
      },
      {
        orgId: STAFF_B,
        orgName: "Staff Beta",
        role: "admin",
        reportStaff: true,
        clientManage: true,
      },
    ],
    clientOrgs: [
      {
        orgId: CLIENT_A,
        orgName: "Client Alpha",
        groups: [{ groupId: GROUP_A, groupName: "Alpha Providers" }],
      },
      {
        orgId: CLIENT_B,
        orgName: "Client Beta",
        groups: [{ groupId: GROUP_B, groupName: "Beta Providers" }],
      },
    ],
    globalTraining: true,
    restrictedExternal: false,
    contextRevision: "rev-dual",
  } satisfies ContextFixture;
  const state: FixtureState = {
    context: dual,
    selectionResponses: {
      [`client:${CLIENT_B}`]: {
        status: 200,
        body: {
          ...dual,
          audience: "client",
          selectedOrgId: CLIENT_B,
          contextRevision: "rev-dual",
        },
      },
      [`staff:${STAFF_B}`]: {
        status: 200,
        body: {
          ...dual,
          audience: "staff",
          selectedOrgId: STAFF_B,
          contextRevision: "rev-dual",
        },
      },
    },
    memberships: [membership(STAFF_A, "Staff Alpha"), membership(STAFF_B, "Staff Beta")],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
  };
  await installMockNetwork(context, state);
  await seedAuth(context, SESSION(ACTOR, "dual@example.test"), STAFF_B);

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "Choose an access context" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Client Beta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);

  await page.getByRole("button", { name: "Client Beta" }).click();
  await expect(page.getByText("Client access context ready")).toBeVisible();
  await expect(page.getByText("Beta Providers", { exact: true })).toBeVisible();
  expect(state.selectionRequests[0]).toMatchObject({
    audience: "client",
    orgId: CLIENT_B,
    contextRevision: "rev-dual",
  });

  await page.getByRole("button", { name: "Staff Beta" }).click();
  await expect(page.getByRole("link", { name: "Cases" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("minted-panel-active-org") ?? "{}").state?.activeOrgId,
      ),
    )
    .toBe(STAFF_B);
  expect(state.selectionRequests[1]).toMatchObject({
    audience: "staff",
    orgId: STAFF_B,
    contextRevision: "rev-dual",
  });

  await page.getByRole("button", { name: "Client Beta" }).click();
  await expect(page.getByText("Client access context ready")).toBeVisible();
  expect(state.selectionRequests[2]).toMatchObject({
    audience: "client",
    orgId: CLIENT_B,
    contextRevision: "rev-dual",
  });
});

test("a signed-out recipient signs in with the invite token and claims once", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    context: clientContext(),
    memberships: [],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
    claimResponses: [{ status: 200, body: { claimed: true } }],
    claimRequests: [],
  };
  await installMockNetwork(context, state);

  await page.goto(`/client-invites/claim/${INVITE_TOKEN}`);
  await expect(page.getByRole("heading", { name: "Sign in to claim access" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    `/login?invite=${INVITE_TOKEN}`,
  );
  expect(state.claimRequests).toHaveLength(0);

  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("client@example.test");
  await page.getByLabel("Password").fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.poll(() => state.claimRequests?.length ?? 0, { timeout: 10_000 }).toBe(1);
  await expect(page.getByRole("heading", { name: "Access link claimed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
  await expect(page.getByText("Create your first organization", { exact: true })).toHaveCount(0);
  expect(state.authTokenRequests).toBe(1);
  expect(state.claimRequests).toEqual([{ token: INVITE_TOKEN }]);
});

test("a signed-in recipient claims an invite without mounting the staff shell", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    context: clientContext(),
    memberships: [],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
    claimResponses: [{ status: 200, body: { claimed: true } }],
    claimRequests: [],
  };
  await installMockNetwork(context, state);
  await seedAuth(context, SESSION(ACTOR, "client@example.test"));

  await page.goto(`/client-invites/claim/${INVITE_TOKEN}`);
  await expect.poll(() => state.claimRequests?.length ?? 0, { timeout: 10_000 }).toBe(1);
  await expect(page.getByRole("heading", { name: "Access link claimed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
  await expect(page.getByText("Create your first organization", { exact: true })).toHaveCount(0);
  expect(state.claimRequests).toEqual([{ token: INVITE_TOKEN }]);
});

test("revisiting a claimed invite after an SPA unmount does not reuse completed success", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    context: clientContext(),
    memberships: [],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
    claimResponses: [
      { status: 200, body: { claimed: true } },
      { status: 409, body: "replayed" },
    ],
    claimRequests: [],
  };
  await installMockNetwork(context, state);
  await seedAuth(context, SESSION(ACTOR, "client@example.test"));

  await page.goto(`/client-invites/claim/${INVITE_TOKEN}`);
  await expect(page.getByRole("heading", { name: "Access link claimed" })).toBeVisible();
  expect(state.claimRequests).toHaveLength(1);

  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/client-invites/claim/${INVITE_TOKEN}$`));
  await expect(page.getByRole("heading", { name: "Unable to claim access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access link claimed" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
  expect(state.claimRequests).toHaveLength(2);
});

for (const denial of [
  { name: "replayed", status: 409, detail: "This access link is no longer valid." },
  { name: "expired", status: 409, detail: "This access link is no longer valid." },
  {
    name: "email-mismatched",
    status: 403,
    detail:
      "We couldn't claim this access link. Try again or contact your Minted Panel administrator.",
  },
]) {
  test(`a ${denial.name} invite fails closed without a false ready surface`, async ({
    context,
    page,
  }) => {
    const state: FixtureState = {
      context: clientContext(),
      memberships: [],
      authTokenRequests: 0,
      seenTables: [],
      selectionRequests: [],
      claimResponses: [
        { status: denial.status, body: denial.name },
        { status: denial.status, body: denial.name },
      ],
      claimRequests: [],
    };
    await installMockNetwork(context, state);
    await seedAuth(context, SESSION(ACTOR, "client@example.test"));

    await page.goto(`/client-invites/claim/${INVITE_TOKEN}`);
    await expect(page.getByRole("heading", { name: "Unable to claim access" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(denial.detail);
    await expect(page.getByRole("heading", { name: "Access link claimed" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
    await expect(page.getByText("Create your first organization", { exact: true })).toHaveCount(0);
    expect(state.claimRequests).toEqual([{ token: INVITE_TOKEN }]);
  });
}

test("a post-login context failure is recoverable without another sign-in", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    context: clientContext(),
    contextResponses: [
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 200, body: clientContext() },
    ],
    memberships: [],
    authTokenRequests: 0,
    seenTables: [],
    selectionRequests: [],
  };
  await installMockNetwork(context, state);
  await seedAuth(context);

  await page.goto("/login");
  await expect(page.getByText(/access context/i)).toBeVisible({ timeout: 30000 });
  const authRequestsBeforeRetry = state.authTokenRequests;
  await baseExpect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Client access context ready")).toBeVisible();
  expect(state.authTokenRequests).toBe(authRequestsBeforeRetry);
});

for (const landing of [
  {
    name: "last-used secondary organization",
    activeOrgId: STAFF_B,
    memberships: [
      membership(STAFF_A, "Staff Alpha", "admin"),
      membership(STAFF_B, "Staff Beta", "admin"),
    ],
    context: {
      staffOrgs: [
        { orgId: STAFF_A, orgName: "Staff Alpha" },
        { orgId: STAFF_B, orgName: "Staff Beta" },
      ],
      clientOrgs: [],
      restrictedExternal: false,
      audience: "staff",
      selectedOrgId: STAFF_B,
      contextRevision: "rev-secondary",
    },
    path: "/cases",
  },
  {
    name: "billing membership",
    activeOrgId: STAFF_A,
    memberships: [membership(STAFF_A, "Staff Alpha", "billing")],
    context: {
      staffOrgs: [{ orgId: STAFF_A, orgName: "Staff Alpha", role: "billing" }],
      clientOrgs: [],
      restrictedExternal: false,
      audience: "staff",
      selectedOrgId: STAFF_A,
      contextRevision: "rev-billing",
    },
    path: "/cases",
  },
  {
    name: "all-inactive memberships",
    activeOrgId: STAFF_A,
    memberships: [membership(STAFF_A, "Inactive Alpha", "admin", "inactive")],
    context: {
      staffOrgs: [],
      clientOrgs: [],
      restrictedExternal: false,
      audience: null,
      selectedOrgId: null,
      contextRevision: "rev-inactive",
    },
    path: "/reporting/portfolio",
  },
  {
    name: "zero-membership nonclient",
    activeOrgId: null,
    memberships: [],
    context: {
      staffOrgs: [],
      clientOrgs: [],
      globalTraining: true,
      restrictedExternal: false,
      audience: null,
      selectedOrgId: null,
      contextRevision: "rev-zero",
    },
    path: "/reporting/portfolio",
  },
]) {
  test(`preserves the eligible ${landing.name} landing`, async ({ context, page }) => {
    const state: FixtureState = {
      context: {
        actorUserId: ACTOR,
        email: "staff@example.test",
        globalTraining: true,
        ...landing.context,
      },
      memberships: landing.memberships,
      authTokenRequests: 0,
      seenTables: [],
      selectionRequests: [],
    };
    await installMockNetwork(context, state);
    await seedAuth(context, SESSION(ACTOR, "staff@example.test"), landing.activeOrgId);

    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`${landing.path.replaceAll("/", "\\/")}$`));
  });
}
