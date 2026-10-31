// An in-memory stand-in for the tables the follow-up digest job reads and for
// public.notification_sends and its two RPCs
// (supabase/migrations/20261031060000_notification_sends.sql), for the
// MINT-108 job tests.
//
// Reads: from(table).select(columns, { count }).eq().in().order(), then
// either .range(from, to) or a bare await. Like hosted PostgREST, a bare read
// returns at most 1,000 rows and says nothing, so a caller that does not page
// silently loses rows. Rows come back WHOLE, whatever the select names: the
// worst case for PHI, so a test proves the caller maps field by field. Every
// read is recorded with its table, columns and filters.
//
// RPCs: the claim is a no-op while a claimed or sent row holds the key; the
// finish takes only a closed error code and a safe message id, and touches
// only a claimed row. job_runs RPCs go to an optional FakeJobDb, so one fake
// can back runJob end to end. The SQL itself is exercised by
// supabase/tests/mint108-notification-sends.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { FakeJobDb } from "@/__fixtures__/jobRunsFakeDb";
import { JOB_NAME_RE, RUN_KEY_RE } from "@/server/jobs/registry";
import {
  NOTIFICATION_SEND_ERROR_CODES,
  PROVIDER_MESSAGE_ID_RE,
} from "@/server/jobs/notificationSends";

export const POSTGREST_MAX_ROWS = 1000;

export type FakeRow = Record<string, unknown>;

export interface FakeError {
  code: string;
  message: string;
  details?: string;
}

export interface FakeRead {
  table: string;
  columns: string;
  filters: Array<[op: "eq" | "in", column: string, value: unknown]>;
  ranged: boolean;
}

export interface FakeNotificationSend {
  id: string;
  job: string;
  run_key: string;
  org_id: string;
  recipient_user_id: string;
  outcome: "claimed" | "sent" | "failed";
  provider_message_id: string | null;
  error_code: string | null;
}

type SendRpc = "claim_notification_send" | "finish_notification_send";

export interface FakeDigestDb {
  db: SupabaseClient<Database>;
  tables: Record<string, FakeRow[]>;
  reads: FakeRead[];
  sends: FakeNotificationSend[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  /** A read of this table answers with this error, every time. */
  failTable: Record<string, FakeError>;
  /** A read this returns an error for answers with it (e.g. one org's). */
  failRead: ((read: FakeRead) => FakeError | null) | null;
  /** The next call of this RPC answers with this error. */
  failNextRpc: Partial<Record<SendRpc, FakeError>>;
  /** A claim for one of these recipients answers with a connection error. */
  failClaimFor: Set<string>;
}

type Result = { data: unknown; error: FakeError | null; count?: number | null };

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

export function createFollowUpDigestFakeDb(
  tables: Record<string, FakeRow[]> = {},
  jobDb?: FakeJobDb,
): FakeDigestDb {
  const state: FakeDigestDb = {
    db: undefined as unknown as SupabaseClient<Database>,
    tables,
    reads: [],
    sends: [],
    rpcCalls: [],
    failTable: {},
    failRead: null,
    failNextRpc: {},
    failClaimFor: new Set(),
  };
  let sequence = 0;

  const from = (table: string) => {
    const read: FakeRead = { table, columns: "", filters: [], ranged: false };
    let wantCount = false;
    const orders: Array<{ column: string; ascending: boolean }> = [];

    const run = (range: [number, number] | null): Result => {
      state.reads.push({ ...read, filters: [...read.filters], ranged: range !== null });
      const failure = state.failTable[table] ?? state.failRead?.(read) ?? null;
      if (failure) return { data: null, error: failure, count: null };
      let rows = (state.tables[table] ?? []).filter((row) =>
        read.filters.every(([op, column, value]) =>
          op === "eq"
            ? row[column] === value
            : Array.isArray(value) && (value as unknown[]).includes(row[column]),
        ),
      );
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending } of orders) {
          const order = compare(a[column], b[column]);
          if (order !== 0) return ascending ? order : -order;
        }
        return 0;
      });
      const total = rows.length;
      const page = range
        ? rows.slice(range[0], Math.min(range[1] + 1, range[0] + POSTGREST_MAX_ROWS))
        : rows.slice(0, POSTGREST_MAX_ROWS);
      return {
        data: page.map((row) => structuredClone(row)),
        error: null,
        count: wantCount ? total : null,
      };
    };

    const builder = {
      select(columns: string, options?: { count?: string }) {
        read.columns = columns;
        wantCount = options?.count === "exact";
        return builder;
      },
      eq(column: string, value: unknown) {
        read.filters.push(["eq", column, value]);
        return builder;
      },
      in(column: string, values: unknown[]) {
        read.filters.push(["in", column, [...values]]);
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orders.push({ column, ascending: options?.ascending !== false });
        return builder;
      },
      range(start: number, end: number) {
        return { then: (resolve: (r: Result) => unknown) => resolve(run([start, end])) };
      },
      then(resolve: (r: Result) => unknown) {
        return resolve(run(null));
      },
    };
    return builder;
  };

  const claim = (args: Record<string, unknown>): Result => {
    const job = String(args.p_job);
    const runKey = String(args.p_run_key);
    const orgId = String(args.p_org_id);
    const recipient = String(args.p_recipient_user_id);
    if (!JOB_NAME_RE.test(job) || !RUN_KEY_RE.test(runKey)) {
      return { data: null, error: { code: "23514", message: "notification_sends check" } };
    }
    if (state.failClaimFor.has(recipient)) {
      return { data: null, error: { code: "08006", message: "connection failure" } };
    }
    const live = state.sends.some(
      (row) =>
        row.job === job &&
        row.run_key === runKey &&
        row.org_id === orgId &&
        row.recipient_user_id === recipient &&
        (row.outcome === "claimed" || row.outcome === "sent"),
    );
    if (live) return { data: null, error: null };
    sequence += 1;
    const id = `10800000-0000-4000-b000-${String(sequence).padStart(12, "0")}`;
    state.sends.push({
      id,
      job,
      run_key: runKey,
      org_id: orgId,
      recipient_user_id: recipient,
      outcome: "claimed",
      provider_message_id: null,
      error_code: null,
    });
    return { data: id, error: null };
  };

  const finish = (args: Record<string, unknown>): Result => {
    const outcome = args.p_outcome;
    if (outcome !== "sent" && outcome !== "failed") {
      return { data: null, error: { code: "22023", message: "finish_notification_send: outcome" } };
    }
    const code = typeof args.p_error_code === "string" ? args.p_error_code : null;
    if (code !== null && !(NOTIFICATION_SEND_ERROR_CODES as readonly string[]).includes(code)) {
      return { data: null, error: { code: "22023", message: "finish_notification_send: code" } };
    }
    const messageId =
      typeof args.p_provider_message_id === "string" ? args.p_provider_message_id : null;
    if (
      (outcome === "failed") !== (code !== null) ||
      (messageId !== null && (outcome !== "sent" || !PROVIDER_MESSAGE_ID_RE.test(messageId)))
    ) {
      return { data: null, error: { code: "23514", message: "notification_sends check" } };
    }
    const row = state.sends.find((r) => r.id === args.p_id && r.outcome === "claimed");
    if (!row) return { data: false, error: null };
    row.outcome = outcome;
    row.error_code = code;
    row.provider_message_id = messageId;
    return { data: true, error: null };
  };

  const rpc = async (fn: string, args: Record<string, unknown>): Promise<Result> => {
    if (fn === "claim_job_run" || fn === "finish_job_run") {
      if (!jobDb) return { data: null, error: { code: "PGRST202", message: "no job_runs" } };
      return (await jobDb.db.rpc(fn, args as never)) as unknown as Result;
    }
    state.rpcCalls.push({ fn, args });
    if (fn === "claim_notification_send" || fn === "finish_notification_send") {
      const injected = state.failNextRpc[fn];
      if (injected) {
        delete state.failNextRpc[fn];
        return { data: null, error: injected };
      }
      return fn === "claim_notification_send" ? claim(args) : finish(args);
    }
    return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  };

  state.db = { from, rpc } as unknown as SupabaseClient<Database>;
  return state;
}
