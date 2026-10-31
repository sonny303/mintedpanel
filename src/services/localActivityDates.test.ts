// MINT-75 — the browser writes that date an activity record the
// coordinator's local day. Pinned at the ticket's moment: 11:25 PM MDT on
// Oct 19, 2026, when UTC is already Oct 20. A task completed then reads
// "Completed Oct 19" and a note logged then sits on Oct 19, matching the audit
// row and the touch form's default.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; op: "update" | "insert"; payload: unknown }>,
  row: {} as Record<string, unknown>,
}));

// Chainable fake: every filter returns the builder; single / maybeSingle hand
// back the current fixture row. update / insert payloads are captured.
vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.update = (payload: unknown) => {
        holder.writes.push({ table, op: "update", payload });
        return builder;
      };
      builder.insert = (payload: unknown) => {
        holder.writes.push({ table, op: "insert", payload });
        return builder;
      };
      builder.single = async () => ({ data: holder.row, error: null });
      builder.maybeSingle = async () => ({ data: holder.row, error: null });
      return builder;
    },
  },
}));
vi.mock("@/lib/audit", () => ({
  currentUserId: () => "user-1",
  requireActiveOrg: () => "org-1",
  writeAudit: vi.fn(),
}));

import { updateTaskStatus } from "./tasks";
import { logNote } from "./touches";

const priorTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/Denver";
});

afterAll(() => {
  if (priorTz === undefined) delete process.env.TZ;
  else process.env.TZ = priorTz;
});

beforeEach(() => {
  holder.writes = [];
  holder.row = { id: "task-1", status: "in_progress" };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T05:25:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("activity dates written from the browser", () => {
  it("runs the zone and the moment the test pins", () => {
    expect(new Date().getTimezoneOffset()).toBe(360);
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-10-20");
  });

  it("completing a task stamps completed_date with the local day", async () => {
    await updateTaskStatus("task-1", "completed");
    const update = holder.writes.find((w) => w.table === "tasks" && w.op === "update");
    expect(update?.payload).toEqual({ status: "completed", completed_date: "2026-10-19" });
  });

  it("reopening a task still clears completed_date", async () => {
    await updateTaskStatus("task-1", "in_progress");
    const update = holder.writes.find((w) => w.table === "tasks" && w.op === "update");
    expect(update?.payload).toEqual({ status: "in_progress", completed_date: null });
  });

  it("a note is logged under the local day", async () => {
    holder.row = { id: "touch-1", case_id: "case-1", entry_type: "note" };
    await logNote("case-1", { content: "Called the payer back." });
    const insert = holder.writes.find((w) => w.table === "touches" && w.op === "insert");
    expect(insert?.payload).toMatchObject({ entry_type: "note", touch_date: "2026-10-19" });
  });
});
