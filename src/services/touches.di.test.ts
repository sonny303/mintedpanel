import { beforeEach, describe, expect, it, vi } from "vitest";

// touches.ts is a browser-path service (anon client + audit helpers). Mock both
// so the suite drives the query builder and observes audit writes. camelizeRow /
// the follow-up reducer stay real (pure).
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

import { bulkLogTouch, correctTouch, logTouch } from "./touches";

interface Captured {
  table: string;
  op?: "insert" | "select";
  selectCols?: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

// Chainable fake: select/insert/eq/in return the (thenable) builder; single /
// maybeSingle / a bare await all consume the next queued result in call order.
function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };

  const from = (table: string) => {
    const cap: Captured = { table, filters: [] };
    captures.push(cap);
    const builder: Record<string, unknown> = {
      select(cols: string) {
        if (!cap.op) cap.op = "select";
        cap.selectCols = cols;
        return builder;
      },
      insert(payload: unknown) {
        cap.op = "insert";
        cap.payload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        cap.filters.push([col, val]);
        return builder;
      },
      in(col: string, val: unknown) {
        cap.filters.push([col, val]);
        return builder;
      },
      maybeSingle: () => Promise.resolve(take()),
      single: () => Promise.resolve(take()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(take()).then(onF, onR),
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

const CREATED = {
  id: "t-1",
  org_id: "org-1",
  case_id: "case-1",
  touch_date: "2026-07-10",
  entry_type: "touchpoint",
  touch_type: "call",
  outcome: null,
  next_follow_up_date: null,
  clears_follow_up: false,
  recipient_name: null,
  recipient_contact: null,
  notes: null,
  coordinator_id: "user-1",
  task_id: null,
  communication_event_id: null,
  corrects_touch_id: null,
  source: "manual",
  created_at: "2026-07-10T00:00:00Z",
};

beforeEach(() => {
  writeAuditMock.mockReset();
  writeAuditMock.mockResolvedValue(undefined);
});

describe("logTouch (F4.1.1/F4.1.4/TE-3)", () => {
  it("sets org/case/coordinator/entry_type/source, allows a null outcome, audits once", async () => {
    const captures = installDb([{ data: CREATED }]);

    const created = await logTouch("case-1", {
      touchDate: "2026-07-10",
      touchType: "call",
      // no outcome — disposition is optional and must not be synthesized
    });

    expect(created.id).toBe("t-1");
    const payload = captures[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      entry_type: "touchpoint",
      org_id: "org-1",
      case_id: "case-1",
      coordinator_id: "user-1",
      touch_type: "call",
      outcome: null,
      clears_follow_up: false,
      source: "manual",
    });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "TOUCH_LOGGED", entityType: "touch", entityId: "t-1" }),
    );
  });

  it("honours an explicit extension source and recipient capture (TE-6/F4.1.5)", async () => {
    const captures = installDb([{ data: CREATED }]);
    await logTouch("case-1", {
      touchDate: "2026-07-10",
      touchType: "email",
      source: "extension",
      recipientName: "  Aetna Provider Relations  ",
      recipientContact: "  1-800-555-0100  ",
      clearsFollowUp: true,
    });
    const payload = captures[0].payload as Record<string, unknown>;
    expect(payload.source).toBe("extension");
    expect(payload.recipient_name).toBe("Aetna Provider Relations");
    expect(payload.recipient_contact).toBe("1-800-555-0100");
    expect(payload.clears_follow_up).toBe(true);
  });

  it("propagates an audit-write failure (a failed audit fails the request)", async () => {
    installDb([{ data: CREATED }]);
    writeAuditMock.mockRejectedValueOnce(new Error("audit down"));
    await expect(
      logTouch("case-1", { touchDate: "2026-07-10", touchType: "call" }),
    ).rejects.toThrow("audit down");
  });
});

describe("correctTouch (Edge Cases & Corrections)", () => {
  it("appends a correction that references the original (never an UPDATE)", async () => {
    // lookup original -> insert correction
    const captures = installDb([
      { data: { id: "orig-1", case_id: "case-1" } },
      { data: { ...CREATED, id: "corr-1", corrects_touch_id: "orig-1" } },
    ]);

    const created = await correctTouch("case-1", "orig-1", {
      touchDate: "2026-07-11",
      touchType: "call",
      outcome: "successful",
    });

    expect(created.correctsTouchId).toBe("orig-1");
    // second capture is the append; it carries corrects_touch_id and is an insert
    expect(captures[1].op).toBe("insert");
    expect((captures[1].payload as Record<string, unknown>).corrects_touch_id).toBe("orig-1");
    // no update/delete verbs exist on the fake — correction is append-only
  });

  it("rejects a correction whose original is not on the same case", async () => {
    installDb([{ data: { id: "orig-1", case_id: "other-case" } }]);
    await expect(
      correctTouch("case-1", "orig-1", { touchDate: "2026-07-11", touchType: "call" }),
    ).rejects.toThrow("same case");
  });

  it("rejects a correction whose original is not found in the org", async () => {
    installDb([{ data: null }]);
    await expect(
      correctTouch("case-1", "missing", { touchDate: "2026-07-11", touchType: "call" }),
    ).rejects.toThrow("not found");
  });
});

describe("bulkLogTouch (F4.1.7/TE-6)", () => {
  it("writes one touch per case + one audit per touch + a batch summary, org-scoped", async () => {
    const captures = installDb([
      { data: [{ id: "case-1" }, { id: "case-2" }] }, // ownership check
      {
        data: [
          { ...CREATED, id: "t-a", case_id: "case-1" },
          { ...CREATED, id: "t-b", case_id: "case-2" },
        ],
      },
    ]);

    const result = await bulkLogTouch(["case-1", "case-2"], {
      touchDate: "2026-07-10",
      touchType: "portal",
      outcome: "successful",
    });

    expect(result.caseIds).toEqual(["case-1", "case-2"]);
    // ownership read was org-scoped and id-bounded
    expect(captures[0].table).toBe("credential_cases");
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    // one touch row per case
    expect((captures[1].payload as unknown[]).length).toBe(2);
    // one TOUCH_LOGGED per touch + one batch summary
    expect(writeAuditMock).toHaveBeenCalledTimes(3);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "touch_batch" }),
    );
  });

  it("aborts before any write when a selected case is outside the org", async () => {
    const captures = installDb([
      { data: [{ id: "case-1" }] }, // case-2 is missing -> not owned
    ]);
    await expect(
      bulkLogTouch(["case-1", "case-2"], { touchDate: "2026-07-10", touchType: "portal" }),
    ).rejects.toThrow("not in this organization");
    // only the ownership read ran — no touches insert
    expect(captures).toHaveLength(1);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    installDb([{ data: [] }]);
    await expect(
      bulkLogTouch([], { touchDate: "2026-07-10", touchType: "portal" }),
    ).rejects.toThrow("at least one case");
  });
});
