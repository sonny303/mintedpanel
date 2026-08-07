// The cross-endpoint contract the extension fill engine depends on:
// portal_field_maps.token (GET /api/portal-field-maps) must join LITERALLY
// against profile token keys (GET /api/providers/:id/profile). Live field-map
// rows store braced "{{provider.firstName}}" while the catalog RPC emits bare
// "provider.firstName" — without server-side normalization every join misses
// and the extension logs "no value in Minted Panel" for every field
// (the 2026-07-05 fields_filled=0 incident). No service mocks here: the real
// handler and services run over fake dbs, and the test performs the same
// string join the extension does.
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext } from "./guard";
// portalFieldMaps now also exposes browser readers that import the anon client
// at load; stub it (this suite runs the real handler/services over fake dbs and
// never touches the anon client).
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
import { handleProviderProfile } from "./extensionRoutes";
import { listPortalFieldMaps } from "@/services/portalFieldMaps";
import type { ProfileToken } from "@/services/providerProfile";

const PROVIDER_ID = "0f0f0f0f-1111-4222-8333-444444444444";

// Chainable fake of the supabase-js builder, keyed by table, with .rpc() for
// the get_sop_field_tokens catalog — same shape as providerProfile.di.test.ts.
function makeFakeDb(
  tables: Record<string, { data: unknown }>,
  catalog: Json | null = null,
): SupabaseClient<Database> {
  const db = {
    from(table: string) {
      const result = () => tables[table] ?? { data: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        // `in` is what the org-contact-family read uses (party_role_assignments
        // filtered to the default holder of each contact role); an unstubbed
        // table falls through to { data: null } like every other one here.
        in: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: () => Promise.resolve(result()),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(res, rej),
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: catalog, error: null }),
  };
  return db as unknown as SupabaseClient<Database>;
}

function ctxWith(db: SupabaseClient<Database>): AuthContext {
  return {
    userId: "u1",
    orgId: "org-1",
    role: "specialist",
    userName: "Tester",
    email: "tester@minted.com",
    userMetadata: { full_name: "Tess Tester" },
    db,
    writeAudit: vi.fn().mockResolvedValue(undefined),
  };
}

// What the live get_sop_field_tokens() emits: BARE tokens.
const CATALOG: Json = [
  { table: "providers", token: "provider.firstName", column: "first_name" },
  { table: "providers", token: "provider.npi", column: "npi" },
];

// What a live portal_field_maps row looks like: token pasted WITH braces.
const fieldMapRow = {
  id: "m1",
  org_id: null,
  portal_key: "bcbs_ks_enrollment",
  url_pattern: "https://portal.example/*",
  page_step: "provider-info",
  map_type: "web",
  selector: "#firstName",
  selector_fallbacks: null,
  source: "token",
  token: "{{provider.firstName}}",
  hardcoded_value: null,
  transform: null,
  field_type: "text",
  notes: null,
  status: "approved",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
};

describe("profile ↔ field-map token join (extension fill contract)", () => {
  it("a provider with first_name set yields a profile the {{provider.firstName}} field map resolves to that value", async () => {
    const profileDb = makeFakeDb(
      {
        providers: {
          data: { id: PROVIDER_ID, group_id: null, first_name: "Brian", npi: "1234567890" },
        },
        state_licenses: { data: [] },
        provider_facility_assignments: { data: [] },
      },
      CATALOG,
    );
    const res = await handleProviderProfile(
      PROVIDER_ID,
      new URL(`https://x.test/api/providers/${PROVIDER_ID}/profile`),
      ctxWith(profileDb),
    );
    expect(res.status).toBe(200);
    const envelope = (await res.json()) as ApiEnvelope<{ tokens: ProfileToken[] }>;
    const profileTokens = envelope.data?.tokens ?? [];

    const maps = await listPortalFieldMaps({
      db: makeFakeDb({ portal_field_maps: { data: [fieldMapRow] } }),
      orgId: "org-1",
    });
    expect(maps).toHaveLength(1);

    // The extension's join: field-map token -> profile token, literal match.
    const joined = profileTokens.find((t) => t.token === maps[0].token);
    expect(joined).toBeDefined();
    expect(joined?.value).toBe("Brian");
  });
});
