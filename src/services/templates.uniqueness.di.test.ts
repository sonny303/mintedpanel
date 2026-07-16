import { describe, it, expect, vi, beforeEach } from "vitest";

// E4.2 SOP hardening — service-side destination-key validation: createTemplate /
// updateTemplate reject a SECOND active organization template at the supported
// match grain (payer + state + group, group NULLS-NOT-DISTINCT) with a clear
// blocking error, ahead of the DB unique index backstop. Mock the anon client +
// audit like the other *.di.test.ts suites.
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
}));

import { createTemplate } from "./templates";

interface Captured {
  table: string;
  op?: "insert" | "update";
  filters: Array<[string, unknown]>;
  isFilters: Array<[string, unknown]>;
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const from = (table: string) => {
    const cap: Captured = { table, filters: [], isFilters: [] };
    captures.push(cap);
    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      insert() {
        cap.op = "insert";
        return builder;
      },
      eq(col: string, val: unknown) {
        cap.filters.push([col, val]);
        return builder;
      },
      is(col: string, val: unknown) {
        cap.isFilters.push([col, val]);
        return builder;
      },
      neq(col: string, val: unknown) {
        cap.filters.push([`neq:${col}`, val]);
        return builder;
      },
      limit: () => Promise.resolve(take()),
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

beforeEach(() => writeAuditMock.mockClear());

describe("createTemplate — active-org match-key uniqueness", () => {
  it("blocks a duplicate at the same (payer, state, group) with a clear message", async () => {
    // Conflict check finds an existing active template → reject before insert.
    const captures = installDb([{ data: [{ id: "existing", name: "Aetna NC" }] }]);

    await expect(
      createTemplate({
        name: "Aetna NC (dupe)",
        payerId: "pay1",
        state: "NC",
        groupId: "g1",
        taskDefinitions: [],
      }),
    ).rejects.toThrow(/already exists for this payer, state, and group/i);

    // Only the conflict check ran — no insert, no audit.
    expect(captures).toHaveLength(1);
    expect(captures[0].op).toBeUndefined();
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(captures[0].filters).toContainEqual(["archived", false]);
    expect(captures[0].filters).toContainEqual(["payer_id", "pay1"]);
    expect(captures[0].filters).toContainEqual(["state", "NC"]);
    expect(captures[0].filters).toContainEqual(["group_id", "g1"]);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("uses a NULLS-NOT-DISTINCT (IS NULL) check for an any-group template", async () => {
    // No conflict → insert proceeds and audits.
    const created = {
      id: "new",
      org_id: "org-1",
      name: "Aetna NC (any group)",
      payer_id: "pay1",
      state: "NC",
      group_id: null,
      archived: false,
      task_definitions: [],
    };
    const captures = installDb([{ data: [] }, { data: created }]);

    const result = await createTemplate({
      name: "Aetna NC (any group)",
      payerId: "pay1",
      state: "NC",
      groupId: null,
      taskDefinitions: [],
    });

    expect(result.id).toBe("new");
    // The any-group conflict check matches group_id IS NULL, not eq.
    expect(captures[0].isFilters).toContainEqual(["group_id", null]);
    expect(captures[1].op).toBe("insert");
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
  });

  it("does not run the uniqueness check for a payer/state-less template (outside the constrained grain)", async () => {
    // A legacy-shaped template with no payer → the guard is skipped; insert runs.
    const created = {
      id: "legacy",
      org_id: "org-1",
      name: "Untitled",
      payer_id: null,
      state: null,
      group_id: null,
      archived: false,
      task_definitions: [],
    };
    const captures = installDb([{ data: created }]);

    const result = await createTemplate({ name: "Untitled", taskDefinitions: [] });

    expect(result.id).toBe("legacy");
    // First (and only) query is the insert — no conflict-check pass.
    expect(captures).toHaveLength(1);
    expect(captures[0].op).toBe("insert");
  });
});
