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

  it("rejects an ACTIVE payer/state-less org template (unsupported combination)", async () => {
    // An organization SOP MUST target a payer and a state — the create is
    // blocked before any DB call (no insert, no audit).
    const captures = installDb([]);

    await expect(createTemplate({ name: "Untitled", taskDefinitions: [] })).rejects.toThrow(
      /payer/i,
    );

    expect(captures).toHaveLength(0);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("allows an ARCHIVED payer/state-less template (migration copy, outside the active grain)", async () => {
    // Archived rows are exempt from the required-match-key + uniqueness rules,
    // so a Duplicate-as-archived copy still persists; only the insert runs.
    const created = {
      id: "arch",
      org_id: "org-1",
      name: "Copy",
      payer_id: null,
      state: null,
      group_id: null,
      archived: true,
      task_definitions: [],
    };
    const captures = installDb([{ data: created }]);

    const result = await createTemplate({ name: "Copy", archived: true, taskDefinitions: [] });

    expect(result.id).toBe("arch");
    expect(captures).toHaveLength(1);
    expect(captures[0].op).toBe("insert");
  });
});
