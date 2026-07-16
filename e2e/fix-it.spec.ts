// E4.3a — form-drift repair signal over the mock harness. The last real fill
// reported two trained selectors as "field not found on this page"; the Fix-it
// queue surfaces ONE consolidated "Form drift" card, and "Send to training"
// re-proposes the org's own broken mappings (write-through PATCH) and hands the
// user to the exact training surface. Non-drift skip reasons never raise a card.
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const PORTAL_KEY = "bcbs_ks";

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

const fieldMap = (id: string, over: Record<string, unknown>) => ({
  id,
  org_id: ORG_ID,
  portal_key: PORTAL_KEY,
  url_pattern: null,
  page_step: null,
  map_type: "web",
  selector: "label:Field",
  selector_fallbacks: null,
  source: "token",
  token: "provider.npi",
  hardcoded_value: null,
  transform: null,
  field_type: "text",
  notes: null,
  status: "approved",
  field_label: null,
  form_section: null,
  confidence: null,
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
  ...over,
});

function makeFixtures() {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Shelby Sports Rehab",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Shelby Sports Rehab",
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
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    party_role_assignments: [],
    // One (non-reference) provider so the queue clears its empty-input guard.
    providers: [
      {
        id: "pr-1",
        org_id: ORG_ID,
        first_name: "Jane",
        last_name: "Whitaker",
        status: "active",
        reference_only: false,
        verification_state: "verified",
        updated_at: "2026-07-10T00:00:00Z",
      },
    ],
    credential_cases: [],
    tasks: [],
    payers: [],
    status_configs: [],
    field_dictionary: [],
    portals: [
      {
        id: "portal-1",
        org_id: ORG_ID,
        portal_key: PORTAL_KEY,
        name: "BCBS Kansas Enrollment",
        payer_id: null,
        form_url: "https://portal.example/enroll",
        is_verified: true,
        last_verified_at: "2026-07-10T00:00:00Z",
        url_changed_at: null,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T00:00:00Z",
      },
    ],
    portal_field_maps: [
      fieldMap("m1", { selector: "label:NPI", token: "provider.npi" }),
      fieldMap("m2", {
        selector: "label:City",
        token: "facility.city",
        field_label: "Service location city",
      }),
    ],
    fill_sessions: [
      {
        id: "fs-1",
        org_id: ORG_ID,
        case_id: null,
        provider_id: "pr-1",
        portal_key: PORTAL_KEY,
        fill_mode: "web",
        started_at: "2026-07-15T00:00:00Z",
        completed_at: "2026-07-15T00:00:05Z",
        fields_filled: 3,
        fields_skipped: [
          // Two drift signals — trained selectors that matched nothing.
          { label: "NPI", reason: "field not found on this page", kind: "skipped", mapId: "m1" },
          { label: "City", reason: "field not found on this page", kind: "skipped", mapId: "m2" },
          // Non-drift skips must never raise the card.
          { label: "CAQH ID", reason: "no value in Minted Panel", kind: "skipped" },
          { label: "Attachment", reason: "file upload - attach manually", kind: "manual" },
        ],
        docs_attached: null,
        performed_by: USER_ID,
        is_test: false,
      },
    ],
  } as Record<string, Record<string, unknown>[]>;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    // The token catalog the training surface loads — an array, never 0.
    if (url.pathname.endsWith("/rpc/get_sop_field_tokens")) return json([]);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (req.method() !== "GET") {
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = req.postDataJSON();
        body = Array.isArray(parsed)
          ? ((parsed[0] ?? null) as Record<string, unknown> | null)
          : (parsed as Record<string, unknown> | null);
      } catch {
        body = null;
      }

      // reproposeFieldMap: PATCH portal_field_maps ?id=eq.<id> back to proposed.
      if (table === "portal_field_maps" && req.method() === "PATCH") {
        const idFilter = url.searchParams.get("id") ?? "";
        const id = idFilter.startsWith("eq.") ? idFilter.slice(3) : idFilter;
        const row = fixtures.portal_field_maps.find((r) => r.id === id);
        if (!row) return json({ code: "PGRST116", message: "no rows" }, 406);
        Object.assign(row, body ?? {});
        return json(wantsObject ? row : [row]);
      }

      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) return json(wantsObject ? {} : [{}]);
      return json(null, 201);
    }

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        }
      }
      return true;
    };

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler };
}

function seedAuth(
  context: { addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void> },
  orgId: string,
) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, orgId] as const,
  );
}

test("form-drift repair card sends the org's broken mappings back to training", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_ID);

  await page.goto("/fix-it");

  // ONE consolidated "Form drift" card for the portal: exactly the two
  // not-found selectors (the "no value" and "manual" skips do not count).
  await expect(page.getByText("Form drift")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("2 trained fields didn't match the live BCBS Kansas Enrollment form."),
  ).toBeVisible();
  await expect(page.getByText("Service location city")).toBeVisible();

  // Send the org's broken mappings back to training.
  await page.getByRole("button", { name: "Send to training" }).click();
  await expect(page.getByText("2 fields sent back to training")).toBeVisible({ timeout: 15000 });

  // The card opens the exact training surface for this portal…
  await expect(page).toHaveURL(new RegExp(`/portals/${PORTAL_KEY}/train`));
  // …and both org rows were re-proposed (write-through PATCH), never global.
  const maps = fixtures.portal_field_maps;
  expect(maps.every((m) => m.status === "proposed")).toBe(true);
  expect(maps.every((m) => m.source === "token")).toBe(true);
});

test("the Home Fix-it preview renders the form-drift row, not a blank row", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_ID);

  // The Fix-it session summary lands the specialist back on Home; the top-3
  // preview must render a broken_mapping card with real text, not the empty
  // "· " row a missing card-kind branch would produce.
  await page.goto("/home");
  const row = page.getByRole("link").filter({ hasText: "Form drift" });
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText("BCBS Kansas Enrollment");
});
