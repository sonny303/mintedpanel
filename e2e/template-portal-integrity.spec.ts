import { test, expect, type Route } from "@playwright/test";

// E1.7b hotfix — SOP portal-task integrity over the mock harness. The Chrome
// extension closes exactly ONE task per portal submission, so a task whose
// online_form steps point at different portals makes the close-out target
// ambiguous. The Template Wizard must warn on the offending task and block save
// (Publish) BEFORE any write; a single-portal task must be unaffected. Pure
// coverage lives in src/components/templates/editableTemplate.test.ts — this
// spec pins the wizard's inline warning + blocked publish end-to-end.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONFLICT_ID = "33333333-3333-4333-8333-333333333331";
const CLEAN_ID = "33333333-3333-4333-8333-333333333332";
// E4.2 SOP hardening — an org template must target a payer + state to publish.
const PAYER_ID = "55555555-5555-4555-8555-555555555555";

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

// One task, two online_form steps pointing at DIFFERENT portals — the ambiguous
// close-out the invariant forbids.
const CONFLICT_DEFS = [
  {
    title: "Submit enrollment",
    description: "",
    sortOrder: 0,
    dueOffsetDays: 5,
    steps: [
      {
        label: "Fill the Availity portal",
        detail: "",
        stepType: "online_form",
        portalKey: "availity",
        dataFields: [],
      },
      {
        label: "Fill the BCBS portal",
        detail: "",
        stepType: "online_form",
        portalKey: "bcbs_ks_enrollment",
        dataFields: [],
      },
    ],
  },
];

// One task, one portal — the invariant holds, publish must proceed.
const CLEAN_DEFS = [
  {
    title: "Submit enrollment",
    description: "",
    sortOrder: 0,
    dueOffsetDays: 5,
    steps: [
      {
        label: "Fill the Availity portal",
        detail: "",
        stepType: "online_form",
        portalKey: "availity",
        dataFields: [],
      },
    ],
  },
];

function portalRow(id: string, portalKey: string, name: string) {
  return {
    id,
    org_id: ORG_ID,
    portal_key: portalKey,
    name,
    payer_id: null,
    form_url: `https://${portalKey}.example`,
    is_verified: true,
    last_verified_at: null,
    url_changed_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  };
}

function templateRow(id: string, name: string, defs: unknown[]) {
  return {
    id,
    org_id: ORG_ID,
    name,
    group_id: null,
    // E4.2 SOP hardening — org templates carry a valid payer + state so the
    // publish gate passes and the portal-integrity behavior under test is reached.
    state: "KS",
    specialty: null,
    payer_id: PAYER_ID,
    task_definitions: defs,
    archived: false,
    current_version: 1,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  };
}

const FIXTURES: Record<string, unknown[]> = {
  organizations: [{ id: ORG_ID, name: "Outer Banks Rehab Group", lifecycle_state: "active" }],
  memberships: [
    {
      org_id: ORG_ID,
      user_id: USER_ID,
      role: "admin",
      organizations: { name: "Outer Banks Rehab Group", lifecycle_state: "active" },
    },
  ],
  profiles: [{ id: USER_ID, full_name: "Sowmya Seed", email: "sowmya.seed@example.test" }],
  payers: [{ id: PAYER_ID, org_id: ORG_ID, name: "BCBS KS", is_active: true, status: "active" }],
  provider_groups: [],
  portals: [
    portalRow("aaaaaaaa-0000-4000-8000-0000000000a1", "availity", "Availity"),
    portalRow("aaaaaaaa-0000-4000-8000-0000000000a2", "bcbs_ks_enrollment", "BCBS KS Enrollment"),
  ],
  sop_templates: [
    templateRow(CONFLICT_ID, "Enrollment SOP (two portals)", CONFLICT_DEFS),
    templateRow(CLEAN_ID, "Enrollment SOP (one portal)", CLEAN_DEFS),
  ],
  sop_template_versions: [],
};

interface Captured {
  publishCount: number;
  lastPublishBody: Record<string, unknown> | null;
}

function makeFulfill(captured: Captured) {
  return async function fulfillSupabase(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/get_sop_field_tokens")) {
      return json([
        { token: "provider.firstName", table: "providers", column: "first_name" },
        { token: "provider.npi", table: "providers", column: "npi" },
      ]);
    }
    if (url.pathname.endsWith("/rpc/publish_sop_template_version")) {
      captured.publishCount += 1;
      captured.lastPublishBody = req.postDataJSON() as Record<string, unknown>;
      return json({ template_id: CLEAN_ID, version: 2 });
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    if (table === "sop_templates" && req.method() === "PATCH")
      return json(FIXTURES.sop_templates[0]);

    let rows = FIXTURES[table] ?? [];
    // Honor eq. filters so maybeSingle (Accept */*, array fetch) resolves a
    // single row — same discipline as sop-versioning.spec.ts.
    for (const [key, value] of url.searchParams.entries()) {
      if (["select", "order", "limit", "offset", "or", "and"].includes(key)) continue;
      if (!value.startsWith("eq.")) continue;
      const want = value.slice(3);
      rows = rows.filter((r) => String((r as Record<string, unknown>)[key]) === want);
    }
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    if (req.method() === "POST" || req.method() === "PATCH") return json(null, 201);
    return json(rows);
  };
}

function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
  return context.addInitScript(
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

test.describe("E1.7b portal-task integrity", () => {
  const captured: Captured = { publishCount: 0, lastPublishBody: null };

  test.beforeEach(async ({ context }) => {
    captured.publishCount = 0;
    captured.lastPublishBody = null;
    await context.route(/\/(rest|auth)\/v1\//, makeFulfill(captured));
    await seedAuth(context);
  });

  test("warns on the offending task and blocks Publish before any write", async ({ page }) => {
    await page.goto(`/admin/templates/${CONFLICT_ID}`);
    // The Basics step's first textbox is the template name (shadcn Label has no
    // htmlFor association, so getByLabel cannot resolve it).
    const nameInput = page.locator("section input").first();
    await expect(nameInput).toBeVisible({ timeout: 30000 });

    // Step 3 shows the per-task conflict warning naming both portals.
    await page.getByRole("button", { name: "Steps & fields" }).click();
    await expect(
      page.getByText(/This task links more than one portal \(availity, bcbs_ks_enrollment\)/),
    ).toBeVisible();

    // A content edit turns the footer action into Publish.
    await page.getByRole("button", { name: "Basics" }).click();
    await nameInput.fill("Enrollment SOP (edited)");
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Publish" }).click();

    // Blocked: the publish dialog never opens, an error toast names the conflict,
    // and the publish RPC is never called.
    await expect(page.getByText(/"Submit enrollment" links more than one portal/)).toBeVisible();
    await expect(page.getByText("Publish version 2")).toHaveCount(0);
    expect(captured.publishCount).toBe(0);
  });

  test("a single-portal task is not warned and publishes", async ({ page }) => {
    await page.goto(`/admin/templates/${CLEAN_ID}`);
    const nameInput = page.locator("section input").first();
    await expect(nameInput).toBeVisible({ timeout: 30000 });

    // No conflict warning anywhere in the steps view.
    await page.getByRole("button", { name: "Steps & fields" }).click();
    await expect(page.getByText(/links more than one portal/)).toHaveCount(0);

    await page.getByRole("button", { name: "Basics" }).click();
    await nameInput.fill("Enrollment SOP (edited)");
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Publish" }).click();

    // Not blocked: the publish dialog opens and confirms through the RPC.
    await expect(page.getByText("Publish version 2")).toBeVisible();
    await page.getByPlaceholder("What changed and why").fill("Edit");
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published version 2")).toBeVisible({ timeout: 15000 });
    expect(captured.publishCount).toBe(1);
  });
});
