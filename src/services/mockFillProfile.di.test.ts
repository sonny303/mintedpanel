import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { getMockFillProfile, listMockProfileTokens } from "./mockFillProfile";
import { MOCK_FILL_PROFILE_VERSION } from "@/lib/mockFillProfile";
import { USER_TOKEN_FIELDS } from "@/lib/quickCardCatalog";

function fakeDb(catalog: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: catalog, error });
  return { db: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

const CATALOG = [
  { table: "providers", token: "provider.npi", column: "npi" },
  { table: "providers", token: "provider.firstName", column: "first_name" },
  { table: "provider_groups", token: "group.tin", column: "tin" },
];

describe("listMockProfileTokens", () => {
  it("reads the schema-derived catalog and appends the user.* family", async () => {
    const { db, rpc } = fakeDb(CATALOG);
    const tokens = await listMockProfileTokens({ db });
    expect(rpc).toHaveBeenCalledWith("get_sop_field_tokens");
    expect(tokens).toContain("provider.npi");
    expect(tokens).toContain("group.tin");
    // user.* has no schema backing but does appear in real field maps, so a
    // dry run has to be able to resolve it.
    for (const t of USER_TOKEN_FIELDS) expect(tokens).toContain(t);
  });

  it("throws on a non-array or empty catalog rather than serving a thin profile", async () => {
    // Silently returning {} here would make every dry run report every field
    // unmapped, which reads as "your mappings are broken" — the opposite of the
    // truth. Fail loudly instead.
    await expect(listMockProfileTokens({ db: fakeDb("nope").db })).rejects.toThrow(/non-array/);
    await expect(listMockProfileTokens({ db: fakeDb([]).db })).rejects.toThrow(/empty/);
  });

  it("surfaces an RPC error", async () => {
    const { db } = fakeDb(null, { message: "boom" });
    await expect(listMockProfileTokens({ db })).rejects.toBeTruthy();
  });

  it("dedupes and ignores malformed rows", async () => {
    const { db } = fakeDb([
      { token: "provider.npi" },
      { token: "provider.npi" },
      { token: "  " },
      { token: 42 },
      {},
    ]);
    const tokens = await listMockProfileTokens({ db });
    expect(tokens.filter((t) => t === "provider.npi")).toHaveLength(1);
    expect(tokens).not.toContain(42 as unknown as string);
  });
});

describe("getMockFillProfile", () => {
  it("stamps the profile version so a recorded run can be read against it", async () => {
    const { db } = fakeDb(CATALOG);
    const profile = await getMockFillProfile({ db });
    expect(profile.mock_profile_version).toBe(MOCK_FILL_PROFILE_VERSION);
  });

  // THE property the dry run rests on. Because no token can come back empty,
  // a failing dry run can only mean an unmapped field or a selector the page
  // no longer has — never "we had no value for that". If this ever regresses,
  // a pass/fail stops meaning what the UI claims it means.
  it("gives EVERY catalog token a non-empty value, and reports nothing unresolved", async () => {
    const { db } = fakeDb(CATALOG);
    const profile = await getMockFillProfile({ db });
    expect(profile.unresolved).toEqual([]);
    expect(profile.tokens.length).toBeGreaterThan(0);
    for (const t of profile.tokens) {
      expect(typeof t.value).toBe("string");
      expect(String(t.value).trim()).not.toBe("");
    }
  });

  it("covers the whole catalog plus user.*", async () => {
    const { db } = fakeDb(CATALOG);
    const profile = await getMockFillProfile({ db });
    const keys = profile.tokens.map((t) => t.token);
    expect(keys).toContain("provider.npi");
    expect(keys).toContain("group.tin");
    for (const t of USER_TOKEN_FIELDS) expect(keys).toContain(t);
  });

  it("orders tokens stably, so two runs are diffable by hand", async () => {
    const a = await getMockFillProfile({ db: fakeDb(CATALOG).db });
    // Same catalog in a different order must still come back identically.
    const b = await getMockFillProfile({ db: fakeDb([...CATALOG].reverse()).db });
    expect(a.tokens).toEqual(b.tokens);
  });

  it("values are visibly fake — a filled form must never look like real data", async () => {
    const { db } = fakeDb(CATALOG);
    const profile = await getMockFillProfile({ db });
    const first = profile.tokens.find((t) => t.token === "provider.firstName");
    expect(first?.value).toBe("Sample");
  });
});
