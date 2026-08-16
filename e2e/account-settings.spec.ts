import { test, expect, type Route } from "@playwright/test";

// /account — the user's own settings page (2026-08-16).
//
// Covers what the feature actually promises:
//   - the form loads the caller's profile row (first/last/title)
//   - Save writes profiles AND mirrors the composed name into auth metadata,
//     which is the whole point: profiles.full_name drives every display
//     surface while user_metadata is what {{user.name}} used to fill from, and
//     those two stores were never synced before this page existed
//   - email is read-only, role is read-only (granted by an admin, not here)
//   - a name-less save is blocked (an empty name fills payer forms blank)

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000001";

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
    email: "sowmya@minted.com",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Sowmya" },
    created_at: "2026-08-01T00:00:00Z",
  },
};

const PROFILE = {
  id: USER_ID,
  first_name: "Sowmya",
  last_name: "Surapureddy",
  title: "Credentialing Manager",
  full_name: "Sowmya Surapureddy",
  email: "sowmya@minted.com",
  created_at: "2026-08-01T00:00:00Z",
};

type Recorded = { method: string; path: string; body: unknown };

/** Records every write so the test can assert the WIRE, not just the UI —
 * the dual-store sync is invisible on screen. */
function harness(recorded: Recorded[], profile: Record<string, unknown> = PROFILE) {
  let current = { ...profile };
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    let parsed: unknown = null;
    try {
      parsed = req.postData() ? JSON.parse(req.postData() as string) : null;
    } catch {
      parsed = req.postData();
    }

    // GoTrue: the user read, and the metadata mirror write (PUT /auth/v1/user).
    if (url.pathname.includes("/auth/v1/")) {
      if (req.method() === "PUT") {
        recorded.push({ method: "PUT", path: url.pathname, body: parsed });
        return json(SESSION.user);
      }
      if (url.pathname.endsWith("/user")) return json(SESSION.user);
      return json(SESSION);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (table === "profiles") {
      if (req.method() === "PATCH") {
        recorded.push({ method: "PATCH", path: table, body: parsed });
        current = { ...current, ...(parsed as Record<string, unknown>) };
        return wantsObject ? json(current) : json([current]);
      }
      return wantsObject ? json(current) : json([current]);
    }

    if (table === "memberships") {
      return json([
        {
          org_id: ORG_ID,
          role: "admin",
          organizations: {
            name: "Outer Banks Rehab Group",
            lifecycle_state: "active",
            created_at: "2026-07-01T00:00:00Z",
          },
        },
      ]);
    }

    if (wantsObject) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json([]);
  };
}

test.beforeEach(async ({ context }) => {
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
});

test.describe("/account — user settings", () => {
  test("loads the caller's name and title, with email and role read-only", async ({
    page,
    context,
  }) => {
    const recorded: Recorded[] = [];
    await context.route("https://*.supabase.co/**", harness(recorded));

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "My account" })).toBeVisible({ timeout: 30000 });

    await expect(page.getByLabel("First name")).toHaveValue("Sowmya");
    await expect(page.getByLabel("Last name")).toHaveValue("Surapureddy");
    await expect(page.getByLabel(/^Title/)).toHaveValue("Credentialing Manager");

    // Email is the sign-in identity — shown and copyable, never editable here.
    await expect(page.getByLabel("Email")).toHaveValue("sowmya@minted.com");
    await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");

    // Role is granted by an admin: displayed for orientation, no control.
    // Scoped to the Access card — the sidebar footer also renders the role.
    const access = page
      .locator("main")
      .getByText(/in Outer Banks Rehab Group/)
      .locator("..");
    await expect(access.getByText("Admin", { exact: true })).toBeVisible();
    await expect(
      page.locator("main").getByText(/Your role is set by an administrator/),
    ).toBeVisible();
  });

  test("Save writes profiles AND mirrors the composed name into auth metadata", async ({
    page,
    context,
  }) => {
    const recorded: Recorded[] = [];
    await context.route("https://*.supabase.co/**", harness(recorded));

    await page.goto("/account");
    await expect(page.getByLabel("First name")).toHaveValue("Sowmya", { timeout: 30000 });

    await page.getByLabel(/^Title/).fill("Director of Credentialing");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible({ timeout: 15000 });

    const patch = recorded.find((r) => r.method === "PATCH" && r.path === "profiles");
    expect(patch, "a profiles PATCH must be issued").toBeTruthy();
    expect(patch?.body).toMatchObject({
      first_name: "Sowmya",
      last_name: "Surapureddy",
      title: "Director of Credentialing",
      // The frozen mirror is composed from the parts, never retyped.
      full_name: "Sowmya Surapureddy",
    });

    // THE point of this page: one save keeps the display name and the
    // form-fill token in step. Before /account these two stores drifted.
    const metaWrite = recorded.find((r) => r.method === "PUT");
    expect(metaWrite, "auth metadata must be mirrored on save").toBeTruthy();
    expect(metaWrite?.body).toMatchObject({ data: { full_name: "Sowmya Surapureddy" } });
  });

  test("blocks a save that would leave the user with no name", async ({ page, context }) => {
    const recorded: Recorded[] = [];
    await context.route("https://*.supabase.co/**", harness(recorded));

    await page.goto("/account");
    await expect(page.getByLabel("First name")).toHaveValue("Sowmya", { timeout: 30000 });

    await page.getByLabel("First name").fill("");
    await page.getByLabel("Last name").fill("");

    await expect(page.getByText(/Enter your name/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(recorded.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });
});
