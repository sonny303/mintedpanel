import { test, expect, type Route } from "@playwright/test";

// E1.7b — SOP-as-Data over the mock harness (TS-45/46/47 UI slices), extended
// by slice F (payer-and-cases screen 4 — Template Editor):
//   TS-45  publish creates version N+1 through the publish RPC (payload
//          pinned: expected version + change note; the head update is never a
//          plain PATCH), and History renders v1 unchanged as a read-only
//          snapshot next to the current head.
//   TS-46  the extended step shape (phone/fax steps, turnaround/cadence,
//          required artifacts, email tokens) authors and renders through the
//          wizard without loss.
//   TS-47  (#edit-default, E6.7 unlock) the default template appears in the
//          list labeled, opens CONTENT-EDITABLE with its match key locked
//          (no payer/state/group pickers, no Archive/Duplicate), publishes
//          through the same RPC, and exits to Payer Setup.
//   Slice F versioning-lite: the header v-chip; History offers restore-as-new
//          (an old version republishes as version N+1 — never edited in
//          place); a readiness deep-link (?intent=) lands on Actions
//          with a DERIVED context banner that disappears when the work is
//          done, and the owning form panel mounts expanded.
// Selection order itself (fallback only when both payer tiers miss) is pinned
// by unit tests in src/lib/pickTemplate.test.ts.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const FALLBACK_ID = "00000000-0000-4000-a000-00000000e17b";

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

// The Humana KS shape of TS-45: v1 was the out-of-network roster procedure,
// v2 (the current head) is the in-network procedure. The head also carries the
// TS-46 extended step shape.
const HEAD_DEFS = [
  {
    title: "Submit Humana enrollment",
    description: "",
    sortOrder: 0,
    dueOffsetDays: 5,
    steps: [
      {
        label: "Fill the Humana provider portal",
        detail: "",
        stepType: "online_form",
        dataFields: [{ label: "Type 1 NPI", token: "provider.npi" }],
        requiredArtifacts: ["Submission confirmation PDF"],
      },
      { label: "Fax the W-9 if the upload fails", detail: "", stepType: "fax", dataFields: [] },
      {
        label: "Status call to Humana provider relations",
        detail: "",
        stepType: "phone",
        expectedTurnaroundDays: 45,
        followUpEveryDays: 14,
        dataFields: [],
      },
    ],
  },
];

const V1_DEFS = [
  {
    title: "Facility roster update (out-of-network)",
    description: "",
    sortOrder: 0,
    dueOffsetDays: 3,
    steps: [
      {
        label: "Email the roster update with the W-9 attached",
        detail: "",
        stepType: "draft_email",
        emailTemplate: {
          subject: "Roster update for {{group.name}}",
          body: "Please add {{provider.firstName}} {{provider.lastName}} to the roster.",
        },
        dataFields: [],
      },
    ],
  },
];

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
  payers: [],
  provider_groups: [],
  portals: [
    // Slice F intent coverage: a registered portal the deep-linked step can be
    // linked to (payerless, so the payer-agnostic Humana KS template offers it).
    {
      id: "55555555-5555-4555-8555-555555555551",
      org_id: ORG_ID,
      portal_key: "humana_portal",
      name: "Humana provider portal",
      payer_id: null,
      form_url: "https://portal.example/humana",
      is_verified: false,
      last_verified_at: null,
      proven_at: null,
      url_changed_at: null,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    },
  ],
  sop_templates: [
    {
      id: TEMPLATE_ID,
      org_id: ORG_ID,
      name: "Humana KS",
      group_id: null,
      state: "KS",
      specialty: null,
      payer_id: null,
      task_definitions: HEAD_DEFS,
      archived: false,
      current_version: 2,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-12T00:00:00Z",
    },
    {
      id: FALLBACK_ID,
      org_id: null,
      name: "General Enrollment (fallback)",
      group_id: null,
      state: null,
      specialty: null,
      payer_id: null,
      task_definitions: [],
      archived: false,
      current_version: 1,
      created_at: "2026-07-13T00:00:00Z",
      updated_at: "2026-07-13T00:00:00Z",
    },
  ],
  sop_template_versions: [
    {
      id: "44444444-4444-4444-8444-444444444441",
      template_id: TEMPLATE_ID,
      version: 1,
      name: "Humana KS",
      task_definitions: V1_DEFS,
      change_note: null,
      published_at: "2026-07-01T00:00:00Z",
      published_by: null,
    },
    {
      id: "44444444-4444-4444-8444-444444444442",
      template_id: TEMPLATE_ID,
      version: 2,
      name: "Humana KS",
      task_definitions: HEAD_DEFS,
      change_note: "In-network procedure",
      published_at: "2026-07-12T00:00:00Z",
      published_by: USER_ID,
    },
  ],
};

interface CapturedPublish {
  body: Record<string, unknown> | null;
  headPatches: number;
}

function makeFulfill(captured: CapturedPublish) {
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
        // Case-scoped: must be filtered OUT of the authoring picker (TE-7).
        { token: "payer.name", table: "payers", column: "name" },
      ]);
    }
    if (url.pathname.endsWith("/rpc/publish_sop_template_version")) {
      captured.body = req.postDataJSON() as Record<string, unknown>;
      return json({ template_id: TEMPLATE_ID, version: 3 });
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    if (table === "sop_templates" && req.method() === "PATCH") {
      captured.headPatches += 1;
      return json(FIXTURES.sop_templates[0]);
    }
    let rows = FIXTURES[table] ?? [];
    // Honor every eq. filter (id, template_id, version, …): this supabase-js
    // maybeSingle fetches the ARRAY (Accept */*) and errors client-side on >1
    // rows, so unfiltered fixture rows would break single-row reads.
    for (const [key, value] of url.searchParams.entries()) {
      if (["select", "order", "limit", "offset", "or", "and"].includes(key)) continue;
      if (!value.startsWith("eq.")) continue;
      const want = value.slice(3);
      rows = rows.filter((r) => String((r as Record<string, unknown>)[key]) === want);
    }
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[col] as number | string;
        const bv = (b as Record<string, unknown>)[col] as number | string;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "desc" ? -cmp : cmp;
      });
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

test.describe("E1.7b SOP versioning (TS-45/46/47)", () => {
  const captured: CapturedPublish = { body: null, headPatches: 0 };

  test.beforeEach(async ({ context }) => {
    captured.body = null;
    captured.headPatches = 0;
    await context.route(/\/(rest|auth)\/v1\//, makeFulfill(captured));
    await seedAuth(context);
  });

  test("TS-47 (#edit-default): the default template is content-editable with its match key locked, and exits to Payer Setup", async ({
    page,
  }) => {
    // Slice G retired the standalone Templates LIST: TemplatesList.tsx is
    // deleted and /admin/templates now redirects to /admin/payer-admin/setup
    // (a payer's templates live on its detail tab, the payerless default on
    // the Payer Setup card). This test used to assert the fallback's row on
    // that list; the assertion outlived the surface. The redirect itself is
    // pinned by legacy-routes.spec.ts, so nothing is lost by dropping it —
    // and the editor behaviour below, which is what TS-47 is actually about,
    // is unchanged.
    await page.goto(`/admin/templates/${FALLBACK_ID}`);
    await expect(page.getByRole("heading", { name: "Edit default template" })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByText(/Default template — used whenever no payer template matches/),
    ).toBeVisible();

    // E6.7 unlock: CONTENT is editable — the name input takes edits and the
    // footer carries Publish on Review.
    const nameInput = page.locator("section input").first();
    await expect(nameInput).toBeEnabled();

    // The match key stays locked: the fixed "Applies to" line renders instead
    // of payer/state/group pickers, and Archive/Duplicate are gone.
    await expect(page.getByText("Every payer, state, and group")).toBeVisible();
    await expect(page.locator("section").first().getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Duplicate" })).toHaveCount(0);

    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

    // The default template belongs to no payer — it exits to Payer Setup.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/admin\/payer-admin\/setup$/, { timeout: 30000 });
  });

  test("TS-47 (#edit-default): default-template content publishes through the publish RPC", async ({
    page,
  }) => {
    await page.goto(`/admin/templates/${FALLBACK_ID}`);
    await expect(page.getByRole("heading", { name: "Edit default template" })).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("button", { name: "Add action" }).click();
    await page.getByRole("menuitem", { name: /Portal \/ Auto-fill/ }).click();
    await page
      .locator('div:has(> label:text-is("Action 1 name"))')
      .first()
      .locator("input")
      .fill("Confirm the provider is enrollment-ready");
    // Portal preset seeds one online_form step; BITE-SOP-TT-01 requires a
    // linked portal before Auto-fill content can publish.
    await expect(page.getByText("Mode", { exact: true }).first()).toBeVisible();
    const portalTrigger = page
      .getByRole("combobox")
      .filter({ hasText: /No portal|Humana provider portal/ });
    await portalTrigger.click();
    await page.getByRole("option", { name: "Humana provider portal" }).click();

    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Publish" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Publish version 2");
    // Blast-radius ack — the default template reaches every organization.
    await expect(dialog).toContainText("Default template — high blast radius");
    await dialog.getByRole("checkbox").click();
    await page.getByPlaceholder("What changed and why").fill("Tighten the generic checklist");
    await dialog.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText("Published version 3")).toBeVisible({ timeout: 15000 });
    expect(captured.body).toMatchObject({
      p_template_id: FALLBACK_ID,
      p_expected_version: 1,
      p_change_note: "Tighten the generic checklist",
    });
    expect(captured.headPatches).toBe(0);
  });

  test("TS-45: history shows v1 unchanged as a read-only snapshot", async ({ page }) => {
    await page.goto(`/admin/templates/${TEMPLATE_ID}`);
    await expect(page.getByRole("button", { name: "History" })).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "History" }).click();

    // Both versions listed; the head is marked Current.
    await expect(page.getByRole("cell", { name: /v2/ }).getByText("Current")).toBeVisible();
    await expect(page.getByText("In-network procedure")).toBeVisible();

    // Open v1: the out-of-network roster content renders read-only, untouched
    // by the v2 publish.
    await page.getByRole("cell", { name: /v1/ }).click();
    await expect(page.getByText(/Read-only snapshot — current version is 2/)).toBeVisible();
    await expect(page.getByText("Facility roster update (out-of-network)")).toBeVisible();
    await expect(page.getByText("Email the roster update with the W-9 attached")).toBeVisible();
  });

  test("TS-45/46: a content edit publishes v3 via the RPC with the change note", async ({
    page,
  }) => {
    await page.goto(`/admin/templates/${TEMPLATE_ID}`);
    // The Basics step's first textbox is the template name (shadcn Label has
    // no htmlFor association, so getByLabel cannot resolve it).
    const nameInput = page.locator("section input").first();
    await expect(nameInput).toBeVisible({ timeout: 30000 });

    // TS-46 slice: the extended shape renders in the Review preview.
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText("Fax", { exact: true })).toBeVisible();
    await expect(page.getByText("Phone", { exact: true })).toBeVisible();
    await expect(page.getByText("~45 day turnaround · follow up every 14 days")).toBeVisible();
    await expect(page.getByText("Artifacts: Submission confirmation PDF")).toBeVisible();

    // Content edit → Publish (not a plain save).
    await page.getByRole("button", { name: "Basics" }).click();
    await nameInput.fill("Humana KS (in-network)");
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText("Publish version 3")).toBeVisible();
    await page.getByPlaceholder("What changed and why").fill("Renamed after go-live");
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();

    await expect(page.getByText("Published version 3")).toBeVisible({ timeout: 15000 });
    expect(captured.body).toMatchObject({
      p_template_id: TEMPLATE_ID,
      p_expected_version: 2,
      p_name: "Humana KS (in-network)",
      p_change_note: "Renamed after go-live",
    });
    // The content publish never rides the plain head PATCH (TE-5: that path is
    // match-key-only).
    expect(captured.headPatches).toBe(0);
  });

  test("slice F versioning-lite: restore copies an old version forward as a NEW version via the publish RPC", async ({
    page,
  }) => {
    await page.goto(`/admin/templates/${TEMPLATE_ID}`);
    await expect(page.getByRole("button", { name: "History" })).toBeVisible({ timeout: 30000 });
    // The v-chip labels the working copy's version in the header.
    await expect(page.getByText("v2", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "History" }).click();
    const v1Row = page.getByRole("dialog").locator("tr", { hasText: "v1" });
    await v1Row.getByRole("button", { name: "Restore as v3" }).click();

    await expect(page.getByText("Restored v1 as v3")).toBeVisible({ timeout: 15000 });
    // Restore = republish the OLD content as version N+1: the v1 task
    // definitions ride the RPC verbatim under a provenance change note; the
    // old version row itself is never edited.
    expect(captured.body).toMatchObject({
      p_template_id: TEMPLATE_ID,
      p_expected_version: 2,
      p_name: "Humana KS",
      p_change_note: "Restored from v1",
    });
    const defs = (captured.body?.p_task_definitions ?? null) as Array<{ title?: string }> | null;
    expect(defs?.[0]?.title).toBe("Facility roster update (out-of-network)");
    expect(captured.headPatches).toBe(0);
  });

  test("slice F: a readiness deep-link lands on Actions with a DERIVED context banner and the form panel open", async ({
    page,
  }) => {
    await page.goto(`/admin/templates/${TEMPLATE_ID}?intent=register`);

    // Lands directly on the merged step with the register-mode banner.
    await expect(page.getByText("Register the portal this step fills")).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByText("This step fills an online form, but no portal is linked yet."),
    ).toBeVisible();

    // The owning online-form step's panel mounts EXPANDED — its content shows
    // without clicking "Form setup".
    await expect(
      page.getByText("Pick a portal above, or register a new one to link this step."),
    ).toBeVisible();

    // The banner is DERIVED from live step state: linking a portal completes
    // the register work and the banner disappears — no dismissal needed.
    await page.getByRole("combobox").filter({ hasText: "No portal (not linked)" }).first().click();
    await page.getByRole("option", { name: "Humana provider portal" }).click();
    await expect(page.getByText("Register the portal this step fills")).toHaveCount(0);
  });
});
