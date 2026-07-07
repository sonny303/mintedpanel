import { describe, it, expect, vi, beforeEach } from "vitest";

// upsertDictionaryEntry is a browser-path service: it imports the anon client
// and the audit helpers directly (no injected ctx, unlike providers.ts). Mock
// both so this suite drives the query builder and observes the audit writes
// without a real env or auth store.
const holder = vi.hoisted(() => ({
  from: (_table: string): unknown => {
    throw new Error("no fake db installed");
  },
}));
const writeAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (table: string) => holder.from(table) },
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: writeAuditMock,
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
}));

import { upsertDictionaryEntry } from "./fieldDictionary";

// Minimal chainable fake of the supabase-js query builder — enough for the
// dictionary upsert shapes: read via select().eq().eq().maybeSingle(),
// insert().select().single(), update().eq().eq().select().single(). Records the
// table, op, payload, and filters per .from() call; terminal methods consume
// results in call order (deterministic in upsertDictionaryEntry).
interface Captured {
  table: string;
  op?: "insert" | "update";
  selectCols?: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const from = (table: string) => {
    const cap: Captured = { table, filters: [] };
    captures.push(cap);
    const builder: Record<string, unknown> = {
      select(cols: string) {
        cap.selectCols = cols;
        return builder;
      },
      insert(payload: unknown) {
        cap.op = "insert";
        cap.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        cap.op = "update";
        cap.payload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        cap.filters.push([col, val]);
        return builder;
      },
      maybeSingle: () => Promise.resolve(take()),
      single: () => Promise.resolve(take()),
    };
    return builder;
  };
  return { from, captures };
}

function installDb(results: Array<{ data: unknown; error?: unknown }>) {
  const fake = makeFakeDb(results);
  holder.from = fake.from;
  return fake.captures;
}

const existingRow = {
  id: "fd-1",
  org_id: "org-1",
  label_normalized: "first name",
  token: "provider.firstName",
  status: "suggested",
  seen_count: 1,
  decided_at: null,
  decided_by: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  writeAuditMock.mockClear();
});

describe("upsertDictionaryEntry — audit + upsert race", () => {
  it("writes a CREATE audit_log row when it inserts a brand-new entry", async () => {
    const inserted = { ...existingRow, id: "fd-new" };
    // read -> no existing row; insert -> the created row.
    const captures = installDb([{ data: null }, { data: inserted }]);

    const result = await upsertDictionaryEntry("First Name", "provider.firstName");

    expect(result.learned).toBe(true);
    expect(result.entry?.id).toBe("fd-new");
    expect(captures[1].op).toBe("insert");

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        entityType: "field_dictionary",
        entityId: "fd-new",
        after: { labelNormalized: "first name", token: "provider.firstName", status: "suggested" },
      }),
    );
  });

  it("writes an UPDATE audit_log row when it bumps an existing entry", async () => {
    const updated = { ...existingRow, seen_count: 2 };
    // read -> existing suggested row; update -> the bumped row.
    const captures = installDb([{ data: existingRow }, { data: updated }]);

    const result = await upsertDictionaryEntry("First Name", "provider.firstName");

    expect(result.learned).toBe(true);
    expect(captures[1].op).toBe("update");
    // Same token -> only seen_count bumps.
    expect(captures[1].payload).toEqual({ seen_count: 2 });

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "field_dictionary",
        entityId: "fd-1",
      }),
    );
  });

  it("converges on a 23505 insert race: re-reads and falls through to the update path", async () => {
    const updated = { ...existingRow, seen_count: 2 };
    const captures = installDb([
      { data: null }, // initial read: nothing yet
      { data: null, error: { code: "23505", message: "duplicate key value" } }, // insert loses the race
      { data: existingRow }, // re-read finds the winner's row
      { data: updated }, // update converges
    ]);

    const result = await upsertDictionaryEntry("First Name", "provider.firstName");

    // Did not throw, and resolved via the update path.
    expect(result.learned).toBe(true);
    expect(result.entry?.id).toBe("fd-1");

    // Four query passes: read, failed insert, re-read, update.
    expect(captures).toHaveLength(4);
    expect(captures[1].op).toBe("insert");
    expect(captures[3].op).toBe("update");

    // Only the converging update audits (the failed insert must not).
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "UPDATE", entityType: "field_dictionary", entityId: "fd-1" }),
    );
  });

  it("rethrows a non-23505 insert error instead of masking it as a race", async () => {
    const captures = installDb([
      { data: null }, // read: nothing
      { data: null, error: { code: "23514", message: "check constraint" } }, // real failure
    ]);

    await expect(upsertDictionaryEntry("First Name", "provider.firstName")).rejects.toMatchObject({
      code: "23514",
    });
    // No re-read, no update, no audit.
    expect(captures).toHaveLength(2);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
