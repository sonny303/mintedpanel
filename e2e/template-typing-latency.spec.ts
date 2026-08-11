// Measured hotfix (2026-07-17) — Template Wizard interaction-latency
// regression, over the mock harness (recipe: sop-versioning.spec.ts).
//
// The defect: the wizard re-renders on every keystroke and TemplateTaskRow
// was unmemoized (and its handlers unstable), so typing in ONE step's field
// re-rendered EVERY task card. On a 10-task template that measured 264–296ms
// p50 per keystroke (prod build, 4x CPU throttle) — every keystroke a "poor"
// INP interaction. Fixed by React.memo on the row + useCallback handlers in
// the wizard; post-fix the same typing measures ~50ms p50 with zero events
// over 200ms (dev-mode max ~150ms).
//
//   TS-A  typing into a draft-email Subject on a 10-task template stays
//         responsive: no dropped characters, and the Event Timing entries for
//         the keystrokes stay far under the pre-fix profile (which produced
//         100+ entries >=300ms for the same input — the budget below fails
//         loudly on a regression while tolerating slow CI runners).
//   TS-B  validation toasts never cover or intercept the primary action: with
//         an error toast visible, the footer Publish button still receives
//         the click (Playwright fails a click intercepted by an overlay).
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const PAYER_ID = "66666666-6666-4666-8666-666666666600";

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

// A realistic-heavy authored template: 10 tasks x 3 steps (online_form with
// data fields, draft_email with recipients, phone with cadence). The latency
// defect scaled with task count, so the fixture must be big enough that an
// unmemoized wizard fails the TS-A budget decisively.
function makeDefs(nTasks: number) {
  return Array.from({ length: nTasks }, (_, t) => ({
    title: `Task ${t + 1} — Submit enrollment packet ${t + 1}`,
    description: `Procedure for packet ${t + 1}.`,
    sortOrder: t,
    dueOffsetDays: t * 7,
    steps: [
      {
        label: `Fill the payer portal for section ${t + 1}`,
        detail: "Use the provider profile values.",
        stepType: "online_form",
        dataFields: [
          { label: "First name", token: "provider.firstName" },
          { label: "Last name", token: "provider.lastName" },
          { label: "NPI", token: "provider.npi" },
        ],
        requiredArtifacts: ["Submission confirmation PDF"],
      },
      {
        label: `Draft the cover email for packet ${t + 1}`,
        detail: "",
        stepType: "draft_email",
        emailTemplate: {
          subject: `Enrollment packet {{provider.firstName}} — part ${t + 1}`,
          body: `Hello,\n\nPacket for {{provider.firstName}} {{provider.lastName}}.\n\nThanks,\n{{user.name}}`,
          to: [{ source: "literal", address: `network.ops${t}@example-payer.test` }],
          cc: [{ source: "token", token: "provider.email" }],
        },
        dataFields: [],
      },
      {
        label: `Status call to provider relations (packet ${t + 1})`,
        detail: "",
        stepType: "phone",
        expectedTurnaroundDays: 45,
        followUpEveryDays: 14,
        dataFields: [],
      },
    ],
  }));
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
  payers: [
    {
      id: PAYER_ID,
      org_id: ORG_ID,
      name: "Humana",
      status: "active",
      created_at: "2026-07-01T00:00:00Z",
    },
  ],
  provider_groups: [],
  portals: [],
  sop_templates: [
    {
      id: TEMPLATE_ID,
      org_id: ORG_ID,
      name: "Humana KS",
      group_id: null,
      state: "KS",
      specialty: null,
      payer_id: PAYER_ID,
      task_definitions: makeDefs(10),
      archived: false,
      current_version: 2,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-12T00:00:00Z",
    },
  ],
  sop_template_versions: [],
  sop_template_drafts: [],
  notes: [],
  user_table_prefs: [],
};

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.endsWith("/rpc/get_sop_field_tokens")) {
    return json([
      { token: "provider.firstName", table: "providers", column: "first_name" },
      { token: "provider.lastName", table: "providers", column: "last_name" },
      { token: "provider.npi", table: "providers", column: "npi" },
      { token: "provider.email", table: "providers", column: "email" },
    ]);
  }
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  let rows = FIXTURES[table] ?? [];
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
}

test.describe("Template Wizard typing latency (measured hotfix)", () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
    await context.addInitScript(
      ([authKey, session, orgId]) => {
        localStorage.setItem(authKey as string, JSON.stringify(session));
        localStorage.setItem(
          "minted-panel-active-org",
          JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
        );
        // Event Timing observer: any UI event whose full input-to-paint
        // duration reaches 300ms is recorded. Pre-fix, typing below produced
        // 100+ such entries; post-fix it produces none.
        const w = window as unknown as { __slowEvents: number };
        w.__slowEvents = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= 300) w.__slowEvents += 1;
          }
        }).observe({ type: "event", durationThreshold: 104 } as PerformanceObserverInit);
      },
      [AUTH_KEY, SESSION, ORG_ID] as const,
    );
  });

  test("TS-A: draft-email Subject typing on a 10-task template stays under the latency budget", async ({
    page,
  }) => {
    await page.goto(`/admin/templates/${TEMPLATE_ID}`);
    await expect(page.locator("section input").first()).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Actions" }).click();

    // The field wrapper is the div whose DIRECT child is the "Subject" label.
    const subject = page.locator('div:has(> label:text-is("Subject"))').first().locator("input");
    await expect(subject).toBeVisible();
    await subject.click();
    // Settle the click/focus work, then count only the typing.
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      (window as unknown as { __slowEvents: number }).__slowEvents = 0;
    });

    const typed = "Updated subject for the packet";
    await subject.pressSequentially(typed, { delay: 40 });
    // Let trailing event-timing entries flush (they report after paint).
    await page.waitForTimeout(800);

    // No dropped/reordered input — the field holds exactly what was typed.
    await expect(subject).toHaveValue(new RegExp(`${typed}$`));

    // Latency budget: ~30 keystrokes emit 0 events >=300ms post-fix (dev-mode
    // max ~150ms); pre-fix the same input emitted 100+. <=5 tolerates a slow
    // CI runner without letting the O(template-size) regression back in.
    const slow = await page.evaluate(
      () => (window as unknown as { __slowEvents: number }).__slowEvents,
    );
    expect(slow).toBeLessThanOrEqual(5);
  });

  test("TS-B: a validation toast never blocks the primary action", async ({ page }) => {
    await page.goto(`/admin/templates/${TEMPLATE_ID}`);
    const nameInput = page.locator("section input").first();
    await expect(nameInput).toBeVisible({ timeout: 30000 });

    // Force the name-required validation toast: empty name -> footer Publish
    // opens the change-note dialog -> dialog Publish fails validation, toasts,
    // and drops back to step 1.
    await nameInput.fill("");
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Publish" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Publish version");
    await dialog.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Template name is required")).toBeVisible();
    await expect(dialog).not.toBeVisible();

    // With the toast still on screen, the primary actions keep receiving
    // clicks — Playwright's actionability check fails these clicks if any
    // overlay intercepts the pointer.
    await page.getByRole("button", { name: "Review" }).click();
    const publish = page.getByRole("button", { name: "Publish" });
    await expect(publish).toBeEnabled();
    await publish.click({ timeout: 5000 });
    await expect(page.getByRole("dialog")).toContainText("Publish version");
  });
});
