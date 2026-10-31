import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// The job reuses the MINT-107 sequences service, whose module also builds the
// browser client; nothing here may reach it.
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import {
  createFollowUpDigestFakeDb,
  POSTGREST_MAX_ROWS,
  type FakeDigestDb,
  type FakeRow,
} from "@/__fixtures__/followUpDigestFakeDb";
import { createFakeJobDb } from "@/__fixtures__/jobRunsFakeDb";
import type { EmailEnv } from "../email/env";
import { EmailError, buildMailPayload, type SendEmailInput } from "../email/sendgrid";
import {
  FOLLOWUP_DIGEST_COUNT_KEYS,
  followupDigestJob,
  utcHourKey,
  type FollowUpDigestCounts,
} from "./followupDigest";
import { DIGEST_TOUCH_CASE_CHUNK, DIGEST_TOUCH_FILTER } from "@/services/followUpDigest";
import {
  FollowUpDigestIncompleteError,
  FollowUpDigestNotConfiguredError,
  digestStepProblem,
  runFollowUpDigest,
  type FollowUpDigestConfig,
  type FollowUpDigestDeps,
} from "./followupDigestRun";
import { supabaseJobLedger } from "./ledger";
import { JOB_REGISTRY, RUN_KEY_RE } from "./registry";
import { jobLogger, runJob } from "./runner";
import type { JobContext } from "./types";

// MINT-108 job tests against an in-memory PostgREST (rows come back whole,
// unranged reads stop at 1,000) and a stub mailer. SendGrid is never called.
//
// Minted's default digest goes out at 8 am America/Chicago. On Oct 31, 2026
// Chicago is on CDT (UTC-5), so 8 am is 13:00 UTC; DST ends at 2 am on Nov 1,
// after which 8 am CST is 14:00 UTC.
const SITE = { method: "GET", route: "/api/jobs/followup-digest" };
const NOW = new Date("2026-10-31T13:00:00Z");
const TODAY = "2026-10-31";
const BASE = "https://app.example.test";
const CONFIG: FollowUpDigestConfig = {
  appBaseUrl: BASE,
  fromEmail: "digest@mail.example.test",
  emailReady: true,
};
const ENV: EmailEnv = {
  apiKey: "SG.test",
  fromEmail: CONFIG.fromEmail ?? undefined,
  fromName: "Minted Panel",
  sandbox: true,
};
const JOB = "followup-digest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_OFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORG_NONE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const JANE = "11111111-1111-4111-8111-111111111111";
const OMAR = "22222222-2222-4222-8222-222222222222";
const ADA = "33333333-3333-4333-8333-333333333333";
const BILL = "44444444-4444-4444-8444-444444444444";

// PHI sentinels seeded into the rows the fake hands back whole.
const SENTINEL_NOTE = "SENTINEL-NOTE called provider about divorce";
const SENTINEL_DOB = "1961-04-12";
const SENTINEL_SSN = "6789";
const SENTINELS = [SENTINEL_NOTE, SENTINEL_DOB, SENTINEL_SSN, "SENTINEL"];

const STAMP = { created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z" };

/** Minted's platform defaults, as migration 20261031051500 seeds them. */
function defaultTables(): Record<string, FakeRow[]> {
  return {
    notification_sequence_defaults: [
      {
        purpose: "intake_reminder",
        stop_conditions: ["submitted", "paused", "withdrawn", "provider_replied"],
        target_days_to_ready: 14,
        compress_toward_start_date: false,
        send_hour: null,
        send_time_zone: null,
        ...STAMP,
      },
      {
        purpose: "followup_digest",
        stop_conditions: null,
        target_days_to_ready: null,
        compress_toward_start_date: null,
        send_hour: 8,
        send_time_zone: "America/Chicago",
        ...STAMP,
      },
    ],
    notification_sequence_default_steps: [
      ...["first", "second", "final"].map((name, i) => ({
        id: `dstep-intake-${i + 1}`,
        purpose: "intake_reminder",
        position: i + 1,
        offset_days: [2, 4, 7][i],
        channel: "email",
        template_key: `intake_reminder_${name}`,
        ...STAMP,
      })),
      {
        id: "dstep-digest",
        purpose: "followup_digest",
        position: 1,
        offset_days: 0,
        channel: "email",
        template_key: "followup_digest_daily",
        ...STAMP,
      },
    ],
  };
}

function sequenceRow(orgId: string, enabled: boolean, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: `seq-${orgId}`,
    org_id: orgId,
    purpose: "followup_digest",
    enabled,
    stop_conditions: null,
    target_days_to_ready: null,
    compress_toward_start_date: null,
    // Null: Minted's default (8, America/Chicago).
    send_hour: null,
    send_time_zone: null,
    revision: 1,
    updated_by: null,
    ...STAMP,
    ...overrides,
  };
}

function stepRow(orgId: string, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: `step-${orgId}`,
    sequence_id: `seq-${orgId}`,
    org_id: orgId,
    position: 1,
    offset_days: 0,
    channel: "email",
    template_key: "followup_digest_daily",
    cc_recipients: [],
    ...STAMP,
    ...overrides,
  };
}

function membership(orgId: string, userId: string, role: string, first: string): FakeRow {
  return {
    id: `m-${orgId}-${userId}`,
    org_id: orgId,
    user_id: userId,
    role,
    created_at: `2026-01-0${role === "admin" ? 1 : 2}T00:00:00Z`,
    profiles: {
      first_name: first,
      last_name: "Member",
      full_name: `${first} Member`,
      email: `${first.toLowerCase()}@example.test`,
      title: "SENTINEL title",
    },
  };
}

let caseCount = 0;
function caseRow(
  orgId: string,
  assignedTo: string | null,
  overrides: Partial<FakeRow> = {},
): FakeRow {
  caseCount += 1;
  return {
    id: `case-${String(caseCount).padStart(5, "0")}`,
    org_id: orgId,
    case_number: 1000 + caseCount,
    assigned_to: assignedTo,
    case_status: "in_progress",
    submitted_date: "2026-08-30",
    provider_id: `prov-${caseCount}`,
    payer_id: "payer-aetna",
    case_email_token: "SENTINEL-token",
    providers: {
      org_id: orgId,
      first_name: "Jane",
      last_name: `Smith${caseCount}`,
      date_of_birth: SENTINEL_DOB,
      ssn_last4: SENTINEL_SSN,
      home_street: "SENTINEL 1 Main St",
    },
    payers: { name: "Aetna", avg_decision_days: 45, delegation_note: "SENTINEL payer note" },
    ...overrides,
  };
}

let touchCount = 0;
function touchRow(orgId: string, caseId: string, nextFollowUpDate: string | null): FakeRow {
  touchCount += 1;
  return {
    id: `touch-${String(touchCount).padStart(6, "0")}`,
    org_id: orgId,
    case_id: caseId,
    entry_type: "touchpoint",
    touch_date: "2026-10-20",
    created_at: "2026-10-20T15:00:00Z",
    next_follow_up_date: nextFollowUpDate,
    clears_follow_up: false,
    notes: SENTINEL_NOTE,
    recipient_name: "SENTINEL recipient",
  };
}

interface World {
  tables: Record<string, FakeRow[]>;
  cases: Record<string, FakeRow>;
}

interface WorldOptions {
  /** Org A's sequence overrides (send_hour, send_time_zone, ...). */
  a?: Partial<FakeRow>;
  /** Org A's own step; none by default, so it uses Minted's default step. */
  aStep?: Partial<FakeRow>;
  b?: Partial<FakeRow>;
  bStep?: Partial<FakeRow>;
}

/** Org A: Jane (overdue, plus one upcoming), Omar (due today), one
 *  unassigned overdue case, and admin Ada with no cases; it uses Minted's
 *  default step. Org B: Bill, overdue, on its own step. Org OFF: switched
 *  off. Org NONE: no sequence row. Org A also has an enabled intake row. */
function world(options: WorldOptions = {}): World {
  const janeLate = caseRow(ORG_A, JANE, { case_status: "submitted" });
  const omarToday = caseRow(ORG_A, OMAR);
  const unassigned = caseRow(ORG_A, null);
  const janeUpcoming = caseRow(ORG_A, JANE);
  const billLate = caseRow(ORG_B, BILL);
  const offCase = caseRow(ORG_OFF, BILL);
  const noneCase = caseRow(ORG_NONE, BILL);
  return {
    cases: { janeLate, omarToday, unassigned, janeUpcoming, billLate },
    tables: {
      ...defaultTables(),
      notification_sequences: [
        sequenceRow(ORG_A, true, options.a),
        { ...sequenceRow(ORG_A, true), id: "seq-intake-a", purpose: "intake_reminder" },
        sequenceRow(ORG_B, true, options.b),
        sequenceRow(ORG_OFF, false),
      ],
      notification_sequence_steps: [
        ...(options.aStep ? [stepRow(ORG_A, options.aStep)] : []),
        stepRow(ORG_B, options.bStep),
        stepRow(ORG_OFF),
      ],
      organizations: [
        { id: ORG_A, name: "Shelby Rehab", created_at: "2026-01-01T00:00:00Z" },
        { id: ORG_B, name: "Coastal PT", created_at: "2026-01-01T00:00:00Z" },
        { id: ORG_OFF, name: "Off Org", created_at: "2026-01-01T00:00:00Z" },
        { id: ORG_NONE, name: "No Row Org", created_at: "2026-01-01T00:00:00Z" },
      ],
      memberships: [
        membership(ORG_A, ADA, "admin", "Ada"),
        membership(ORG_A, JANE, "specialist", "Jane"),
        membership(ORG_A, OMAR, "specialist", "Omar"),
        membership(ORG_B, BILL, "specialist", "Bill"),
        membership(ORG_OFF, BILL, "admin", "Bill"),
        membership(ORG_NONE, BILL, "admin", "Bill"),
      ],
      credential_cases: [
        janeLate,
        omarToday,
        unassigned,
        janeUpcoming,
        billLate,
        offCase,
        noneCase,
      ],
      touches: [
        touchRow(ORG_A, String(janeLate.id), "2026-10-28"),
        touchRow(ORG_A, String(omarToday.id), TODAY),
        touchRow(ORG_A, String(unassigned.id), "2026-10-25"),
        touchRow(ORG_A, String(janeUpcoming.id), "2026-11-04"),
        touchRow(ORG_B, String(billLate.id), "2026-10-29"),
        touchRow(ORG_OFF, String(offCase.id), "2026-10-29"),
        touchRow(ORG_NONE, String(noneCase.id), "2026-10-29"),
      ],
    },
  };
}

type DigestSend = SendEmailInput<"followup_digest_daily">;

let fake: FakeDigestDb;
let sent: Array<DigestSend & { at: string }>;
let consoleError: MockInstance<(...args: unknown[]) => void>;
let messageSeq = 0;
let clock = NOW;

function mailer(fail: (input: DigestSend) => unknown = () => null) {
  return vi.fn(async (input: DigestSend) => {
    const error = fail(input);
    if (error) throw error;
    sent.push({ ...input, at: clock.toISOString() });
    messageSeq += 1;
    return { status: 202, messageId: `msg${messageSeq}.abc`, sandbox: false };
  });
}

function ctx(now = NOW): JobContext {
  clock = now;
  return { db: fake.db, now, runKey: utcHourKey(now), log: jobLogger(JOB, SITE) };
}

function deps(overrides: Partial<FollowUpDigestDeps> = {}): Partial<FollowUpDigestDeps> {
  return { config: () => CONFIG, send: mailer(), ...overrides };
}

function counts(partial: Partial<FollowUpDigestCounts>): FollowUpDigestCounts {
  return {
    ...(Object.fromEntries(FOLLOWUP_DIGEST_COUNT_KEYS.map((k) => [k, 0])) as FollowUpDigestCounts),
    ...partial,
  };
}

async function incomplete(promise: Promise<unknown>): Promise<FollowUpDigestCounts> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FollowUpDigestIncompleteError);
  return (error as FollowUpDigestIncompleteError).counts;
}

function logged(): string {
  return consoleError.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

const recipients = () => sent.map((input) => input.to).sort();
const completions = () =>
  (fake.tables.notification_org_slots ?? []).map((r) => [r.job, r.org_id, r.slot]).sort();
const ledgerRows = () =>
  fake.sends.map((r) => [r.job, r.slot, r.org_id, r.recipient_user_id, r.outcome]).sort();
const hours = (fromIso: string, count: number) =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(fromIso) + i * 3_600_000));

/** At NOW, 8 am Central: both orgs are due, every coordinator is emailed. */
const BASELINE = counts({
  orgs_enabled: 2,
  orgs_due: 2,
  orgs_completed: 2,
  digests_sent: 3,
  unassigned_follow_ups: 1,
});
/** A later run the same local date: both orgs already had their digest. */
const ALREADY = counts({ orgs_enabled: 2, orgs_due: 2, orgs_already_completed: 2 });

beforeEach(() => {
  vi.stubEnv("DEV", false);
  fake = createFollowUpDigestFakeDb(world().tables);
  sent = [];
  messageSeq = 0;
  clock = NOW;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  consoleError.mockRestore();
});

describe("followup-digest: coordinators only (Sowmya, Oct 30)", () => {
  it("emails each coordinator once, with only their own rows, and reports exact counts", async () => {
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(BASELINE);
    expect(recipients()).toEqual(["bill@example.test", "jane@example.test", "omar@example.test"]);

    const byTo = new Map(sent.map((input) => [input.to, input]));
    for (const input of sent) {
      expect(input.template).toBe("followup_digest_daily");
      expect(input.replyTo).toEqual({ email: CONFIG.fromEmail });
      // One section, the coordinator's own: no unassigned rows, no team table.
      expect(Object.keys(input.data).sort()).toEqual([
        "digestDate",
        "followUps",
        "practiceName",
        "recipientFirstName",
        "workQueueLink",
      ]);
      expect(input.data.digestDate).toBe(TODAY);
    }
    const jane = byTo.get("jane@example.test");
    expect(jane?.practiceName).toBe("Shelby Rehab");
    expect(jane?.data.followUps.rows.map((r) => [r.status, r.dueDate])).toEqual([
      ["overdue", "2026-10-28"],
    ]);
    expect(jane?.data.followUps.rows[0].caseLink).toMatch(
      /^https:\/\/app\.example\.test\/cases\/case-\d{5}$/,
    );
    expect(byTo.get("omar@example.test")?.data.followUps.rows.map((r) => r.status)).toEqual([
      "due_today",
    ]);
    expect(byTo.get("bill@example.test")?.practiceName).toBe("Coastal PT");

    // One sent ledger row per coordinator, keyed on the org's local date.
    expect(ledgerRows()).toEqual(
      [
        [JOB, TODAY, ORG_A, JANE, "sent"],
        [JOB, TODAY, ORG_A, OMAR, "sent"],
        [JOB, TODAY, ORG_B, BILL, "sent"],
      ].sort(),
    );
    expect(fake.sends.every((r) => /^msg\d+\.abc$/.test(r.provider_message_id ?? ""))).toBe(true);
    expect(completions()).toEqual([
      [JOB, ORG_A, TODAY],
      [JOB, ORG_B, TODAY],
    ]);
  });

  it("sends an admin with no cases nothing, and an unassigned follow-up to no one", async () => {
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result.unassigned_follow_ups).toBe(1);
    expect(sent.some((input) => input.to === "ada@example.test")).toBe(false);
    expect(fake.sends.some((r) => r.recipient_user_id === ADA)).toBe(false);
    const unassigned = (
      fake.tables.credential_cases.find(
        (c) => c.assigned_to === null && c.org_id === ORG_A,
      ) as FakeRow
    ).case_number;
    for (const input of sent) {
      expect(input.data.followUps.rows.map((r) => r.caseNumber)).not.toContain(unassigned);
    }
  });

  it("ignores a cc list left on a stale digest step: nobody cc'd gets a copy", async () => {
    // The database now refuses a digest cc; a row from before that still
    // reaches no one, by role or by user.
    fake = createFollowUpDigestFakeDb(
      world({
        aStep: {
          cc_recipients: [
            { kind: "role", role: "admin" },
            { kind: "user", user_id: ADA },
          ],
        },
      }).tables,
    );
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(BASELINE);
    expect(recipients()).toEqual(["bill@example.test", "jane@example.test", "omar@example.test"]);
  });

  it("counts a coordinator with nothing due as suppressed, and skips one with no usable address", async () => {
    const w = world();
    // Jane's profile has no usable email; Omar's only follow-up moves to next week.
    const jane = w.tables.memberships.find((m) => m.user_id === JANE) as FakeRow;
    jane.profiles = { ...(jane.profiles as FakeRow), email: "not an address" };
    const omarTouch = w.tables.touches.find((t) => t.case_id === w.cases.omarToday.id) as FakeRow;
    omarTouch.next_follow_up_date = "2026-11-07";
    fake = createFollowUpDigestFakeDb(w.tables);
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(
      counts({ ...BASELINE, digests_sent: 1, digests_suppressed: 1, recipients_skipped: 1 }),
    );
    expect(recipients()).toEqual(["bill@example.test"]);
  });
});

describe("followup-digest: the per-org send hour", () => {
  it("sends nothing before the hour, and reads nothing past discovery", async () => {
    const config = vi.fn(() => CONFIG);
    const send = mailer();
    // 12:59 UTC is 7:59 am Central.
    const result = await runFollowUpDigest(
      ctx(new Date("2026-10-31T12:59:59Z")),
      deps({ config, send }),
    );
    expect(result).toEqual(counts({ orgs_enabled: 2, orgs_not_due: 2 }));
    expect(send).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toEqual([]);
    expect([...new Set(fake.reads.map((r) => r.table))].sort()).toEqual([
      "notification_sequence_default_steps",
      "notification_sequence_defaults",
      "notification_sequence_steps",
      "notification_sequences",
    ]);
  });

  it("catches up later the same local day when the 8 am run never happened", async () => {
    // 10:00 am Central; nothing ran at 8 or 9.
    const result = await runFollowUpDigest(ctx(new Date("2026-10-31T15:00:00Z")), deps());
    expect(result).toEqual(BASELINE);
    expect(sent.every((input) => input.data.digestDate === TODAY)).toBe(true);
  });

  it("catches up an org whose run failed, in the next hourly run, without resending the other", async () => {
    let failA = true;
    fake.failRead = (read) =>
      failA &&
      read.table === "touches" &&
      read.filters.some(([, column, value]) => column === "org_id" && value === ORG_A)
        ? { code: "57014", message: "canceling statement due to statement timeout" }
        : null;
    const first = await incomplete(runFollowUpDigest(ctx(), deps()));
    expect(first).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 2,
        orgs_failed: 1,
        orgs_completed: 1,
        digests_sent: 1,
      }),
    );
    expect(completions()).toEqual([[JOB, ORG_B, TODAY]]);

    failA = false;
    const next = await runFollowUpDigest(ctx(new Date("2026-10-31T14:00:00Z")), deps());
    expect(next).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 2,
        orgs_already_completed: 1,
        orgs_completed: 1,
        digests_sent: 2,
        unassigned_follow_ups: 1,
      }),
    );
    expect(recipients()).toEqual(["bill@example.test", "jane@example.test", "omar@example.test"]);
    expect(sent.find((input) => input.to === "jane@example.test")?.at).toBe(
      "2026-10-31T14:00:00.000Z",
    );
  });

  it("uses each org's own send hour and zone when Minted set one, the default otherwise", async () => {
    fake = createFollowUpDigestFakeDb(
      world({ b: { send_hour: 10, send_time_zone: "America/Los_Angeles" } }).tables,
    );
    // 13:00 UTC: 8 am Central (A due), 6 am Pacific (B not yet).
    const first = await runFollowUpDigest(ctx(), deps());
    expect(first).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 1,
        orgs_not_due: 1,
        orgs_completed: 1,
        digests_sent: 2,
        unassigned_follow_ups: 1,
      }),
    );
    expect(recipients()).toEqual(["jane@example.test", "omar@example.test"]);
    // 16:59 UTC is 9:59 am Pacific: still not.
    await runFollowUpDigest(ctx(new Date("2026-10-31T16:59:00Z")), deps());
    expect(recipients()).not.toContain("bill@example.test");
    // 17:00 UTC is 10 am Pacific.
    const third = await runFollowUpDigest(ctx(new Date("2026-10-31T17:00:00Z")), deps());
    expect(third).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 2,
        orgs_already_completed: 1,
        orgs_completed: 1,
        digests_sent: 1,
      }),
    );
    expect(fake.sends.find((r) => r.recipient_user_id === BILL)?.slot).toBe(TODAY);
  });

  it("skips and logs an org whose effective send time this runtime cannot use, and sends the rest", async () => {
    fake = createFollowUpDigestFakeDb(world({ a: { send_time_zone: "Mars/Olympus" } }).tables);
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 1,
        orgs_skipped_send_time: 1,
        orgs_completed: 1,
        digests_sent: 1,
      }),
    );
    expect(recipients()).toEqual(["bill@example.test"]);
    expect(logged()).toContain("[jobs:followup-digest] org_skipped_send_time");
  });
});

describe("followup-digest: at most one digest per coordinator per local date", () => {
  it("sends nothing new on later runs that day, and again on the next local date", async () => {
    await runFollowUpDigest(ctx(), deps());
    expect(sent).toHaveLength(3);
    for (const at of ["2026-10-31T13:40:00Z", "2026-10-31T18:00:00Z", "2026-11-01T04:59:00Z"]) {
      expect(await runFollowUpDigest(ctx(new Date(at)), deps())).toEqual(ALREADY);
    }
    expect(sent).toHaveLength(3);
    // Nothing past the completion check was read or claimed on those runs.
    expect(fake.rpcCalls.filter((c) => c.fn === "claim_notification_send")).toHaveLength(3);

    // Nov 1, 8 am CST (DST has ended: 14:00 UTC).
    await runFollowUpDigest(ctx(new Date("2026-11-01T14:00:00Z")), deps());
    expect(sent).toHaveLength(6);
    expect(fake.sends.filter((r) => r.slot === "2026-11-01")).toHaveLength(3);
    expect(completions()).toEqual([
      [JOB, ORG_A, "2026-10-31"],
      [JOB, ORG_A, "2026-11-01"],
      [JOB, ORG_B, "2026-10-31"],
      [JOB, ORG_B, "2026-11-01"],
    ]);
  });

  it("keys the send claim on the local date, so even a lost completion row cannot resend", async () => {
    await runFollowUpDigest(ctx(), deps());
    // As if the completion rows were never written: later hours re-plan, but
    // every claim for the local date is taken.
    fake.tables.notification_org_slots = [];
    const later = await runFollowUpDigest(ctx(new Date("2026-10-31T19:00:00Z")), deps());
    expect(later).toEqual(counts({ ...BASELINE, digests_sent: 0, digests_already_sent: 3 }));
    expect(sent).toHaveLength(3);
  });

  it.each([
    ["the send hour moves later", { send_hour: 10 }, "2026-10-31T15:00:00Z"],
    ["the send hour moves earlier", { send_hour: 6 }, "2026-10-31T14:00:00Z"],
    [
      "the zone moves west, same local date",
      { send_time_zone: "America/Los_Angeles" },
      "2026-10-31T15:00:00Z",
    ],
    [
      "the zone moves east, same local date",
      { send_time_zone: "America/New_York" },
      "2026-10-31T14:00:00Z",
    ],
  ])("sends no second digest when %s", async (_label, change, at) => {
    await runFollowUpDigest(ctx(), deps());
    expect(sent).toHaveLength(3);
    const sequence = fake.tables.notification_sequences.find(
      (r) => r.org_id === ORG_A && r.purpose === "followup_digest",
    ) as FakeRow;
    Object.assign(sequence, change);
    const withCompletion = await runFollowUpDigest(ctx(new Date(at)), deps());
    expect(withCompletion.orgs_already_completed).toBe(2);
    // And without the completion rows, the local-date claims still hold.
    fake.tables.notification_org_slots = [];
    const withoutCompletion = await runFollowUpDigest(ctx(new Date(at)), deps());
    expect(withoutCompletion.digests_already_sent).toBe(3);
    expect(withoutCompletion.digests_sent).toBe(0);
    expect(sent).toHaveLength(3);
  });

  it("sends the next local date's digest when a zone change moves the org into it", async () => {
    await runFollowUpDigest(ctx(), deps());
    const sequence = fake.tables.notification_sequences.find(
      (r) => r.org_id === ORG_A && r.purpose === "followup_digest",
    ) as FakeRow;
    sequence.send_time_zone = "Asia/Tokyo";
    // 23:00 UTC Oct 31 is 8 am Nov 1 in Tokyo: a new local date, one digest.
    await runFollowUpDigest(ctx(new Date("2026-10-31T23:00:00Z")), deps());
    const tokyo = sent.filter((input) => input.at === "2026-10-31T23:00:00.000Z");
    expect(tokyo.map((input) => [input.to, input.data.digestDate]).sort()).toEqual([
      ["jane@example.test", "2026-11-01"],
      ["omar@example.test", "2026-11-01"],
    ]);
    expect(fake.sends.filter((r) => r.org_id === ORG_A).map((r) => r.slot)).toEqual([
      "2026-10-31",
      "2026-10-31",
      "2026-11-01",
      "2026-11-01",
    ]);
  });
});

describe("followup-digest: daylight saving time", () => {
  it("DST ends (Nov 1, 2026): one digest per local date, at 8 am Central both days", async () => {
    // Every hour from local midnight Oct 31 (05:00 UTC, CDT) to 10 pm Nov 1 (CST).
    for (const at of hours("2026-10-31T05:00:00Z", 48)) {
      await runFollowUpDigest(ctx(at), deps());
    }
    const byDay = new Map<string, Set<string>>();
    for (const input of sent) {
      const set = byDay.get(input.data.digestDate) ?? new Set();
      set.add(input.at);
      byDay.set(input.data.digestDate, set);
    }
    expect(Object.fromEntries([...byDay].map(([day, at]) => [day, [...at]]))).toEqual({
      "2026-10-31": ["2026-10-31T13:00:00.000Z"],
      "2026-11-01": ["2026-11-01T14:00:00.000Z"],
    });
    expect(sent).toHaveLength(6);
    // Omar's Oct 31 follow-up was due today on Oct 31 and overdue on Nov 1.
    const omar = sent.filter((input) => input.to === "omar@example.test");
    expect(omar.map((input) => input.data.followUps.rows[0].status)).toEqual([
      "due_today",
      "overdue",
    ]);
  });

  it("DST ends: a 1 am send hour goes out in the first 1 am, not again in the repeated one", async () => {
    fake = createFollowUpDigestFakeDb(world({ a: { send_hour: 1 }, b: { send_hour: 1 } }).tables);
    // 06:00 UTC is 1 am CDT; 07:00 UTC is 1 am CST, the same local date.
    const first = await runFollowUpDigest(ctx(new Date("2026-11-01T06:00:00Z")), deps());
    expect(first.digests_sent).toBe(3);
    const repeated = await runFollowUpDigest(ctx(new Date("2026-11-01T07:00:00Z")), deps());
    expect(repeated).toEqual(ALREADY);
    expect(sent).toHaveLength(3);
    expect(sent.every((input) => input.data.digestDate === "2026-11-01")).toBe(true);
  });

  it("DST starts (Mar 14, 2027): a 2 am send hour that does not exist goes out at 3 am, once", async () => {
    fake = createFollowUpDigestFakeDb(world({ a: { send_hour: 2 }, b: { send_hour: 2 } }).tables);
    // From local midnight (06:00 UTC, CST) to 10 am CDT.
    for (const at of hours("2027-03-14T06:00:00Z", 9)) {
      await runFollowUpDigest(ctx(at), deps());
    }
    expect(sent).toHaveLength(3);
    // 07:00 UTC is 1 am CST; the next hour, 08:00 UTC, is 3 am CDT.
    expect([...new Set(sent.map((input) => input.at))]).toEqual(["2027-03-14T08:00:00.000Z"]);
    expect(sent.every((input) => input.data.digestDate === "2027-03-14")).toBe(true);
  });

  it("DST starts: 8 am Central moves from 14:00 UTC to 13:00 UTC", async () => {
    // From 6 am CST Mar 13 to 9 am CDT Mar 14.
    for (const at of hours("2027-03-13T12:00:00Z", 27)) {
      await runFollowUpDigest(ctx(at), deps());
    }
    expect(
      [...new Set(sent.map((input) => `${input.data.digestDate} ${input.at}`))].sort(),
    ).toEqual(["2027-03-13 2027-03-13T14:00:00.000Z", "2027-03-14 2027-03-14T13:00:00.000Z"]);
  });
});

describe("followup-digest: today is the org's local date", () => {
  it("lists due today and overdue against the local date, not the UTC date", async () => {
    const w = world({ b: { send_time_zone: "Asia/Tokyo" } });
    const billToday = caseRow(ORG_B, BILL);
    const billYesterday = caseRow(ORG_B, BILL);
    w.tables.credential_cases.push(billToday, billYesterday);
    w.tables.touches.push(
      touchRow(ORG_B, String(billToday.id), "2026-11-01"),
      touchRow(ORG_B, String(billYesterday.id), "2026-10-31"),
    );
    fake = createFollowUpDigestFakeDb(w.tables);
    // 23:30 UTC on Oct 31: 6:30 pm Oct 31 in Chicago, 8:30 am Nov 1 in Tokyo.
    await runFollowUpDigest(ctx(new Date("2026-10-31T23:30:00Z")), deps());
    const omar = sent.find((input) => input.to === "omar@example.test")?.data;
    expect(omar?.digestDate).toBe("2026-10-31");
    expect(omar?.followUps.rows.map((r) => r.status)).toEqual(["due_today"]);
    const bill = sent.find((input) => input.to === "bill@example.test")?.data;
    expect(bill?.digestDate).toBe("2026-11-01");
    // Under the UTC date (Oct 31) Nov 1 would be upcoming and Oct 31 due today.
    expect(bill?.followUps.rows.map((r) => [r.caseNumber, r.status, r.dueDate]).sort()).toEqual(
      [
        [w.cases.billLate.case_number, "overdue", "2026-10-29"],
        [billYesterday.case_number, "overdue", "2026-10-31"],
        [billToday.case_number, "due_today", "2026-11-01"],
      ].sort(),
    );
    expect(fake.sends.find((r) => r.recipient_user_id === BILL)?.slot).toBe("2026-11-01");
  });

  it("keeps a late-evening local run on its own date when UTC has moved on", async () => {
    // 04:30 UTC Nov 1 is 11:30 pm Oct 31 in Chicago; nothing ran earlier.
    await runFollowUpDigest(ctx(new Date("2026-11-01T04:30:00Z")), deps());
    const omar = sent.find((input) => input.to === "omar@example.test")?.data;
    expect(omar?.digestDate).toBe("2026-10-31");
    expect(omar?.followUps.rows.map((r) => r.status)).toEqual(["due_today"]);
  });
});

describe("followup-digest: when nothing is sent", () => {
  it("never considers a switched-off org or one with no sequence row: a default cannot switch an org on", async () => {
    const w = world();
    w.tables.notification_sequences = w.tables.notification_sequences.filter(
      (row) => row.org_id === ORG_OFF,
    );
    fake = createFollowUpDigestFakeDb(w.tables);
    const config = vi.fn(() => ({ appBaseUrl: null, fromEmail: null, emailReady: false }));
    const send = mailer();
    const result = await runFollowUpDigest(ctx(), deps({ config, send }));
    expect(result).toEqual(counts({}));
    expect(send).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toEqual([]);
    const discovery = fake.reads.find((r) => r.table === "notification_sequences");
    expect(discovery?.filters).toEqual([
      ["eq", "purpose", "followup_digest"],
      ["eq", "enabled", true],
    ]);
  });

  it("reports nothing to do before the notification tables exist", async () => {
    fake.failTable.notification_sequences = {
      code: "PGRST205",
      message: "Could not find the table 'public.notification_sequences' in the schema cache",
    };
    const send = mailer();
    expect(await runFollowUpDigest(ctx(), deps({ send }))).toEqual(counts({}));
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an unknown template",
      { template_key: "followup_digest_weekly" },
      "org_skipped_unknown_template",
    ],
    [
      "another purpose's template",
      { template_key: "intake_reminder_first" },
      "org_skipped_wrong_purpose",
    ],
    [
      "a channel the template has no body for",
      { channel: "sms" },
      "org_skipped_channel_unsupported",
    ],
  ])(
    "skips an org whose own step names %s, counts it, and still sends the others",
    async (_label, step, event) => {
      fake = createFollowUpDigestFakeDb(world({ aStep: step }).tables);
      const result = await runFollowUpDigest(ctx(), deps());
      expect(result).toEqual(
        counts({
          orgs_enabled: 2,
          orgs_due: 2,
          orgs_skipped_template: 1,
          orgs_completed: 1,
          digests_sent: 1,
        }),
      );
      expect(recipients()).toEqual(["bill@example.test"]);
      expect(fake.sends.map((r) => r.org_id)).toEqual([ORG_B]);
      // The skipped org is never read past its completion check, and stays
      // open so a fix takes effect the same day.
      expect(
        fake.reads.some(
          (r) => r.table === "credential_cases" && r.filters.some((f) => f[2] === ORG_A),
        ),
      ).toBe(false);
      expect(completions()).toEqual([[JOB, ORG_B, TODAY]]);
      expect(logged()).toContain(`[jobs:followup-digest] ${event}`);
    },
  );

  it("knows every reason a step cannot be sent", () => {
    const ok = { templateKey: "followup_digest_daily", channel: "email" as const };
    expect(digestStepProblem([ok])).toBeNull();
    expect(digestStepProblem([])).toBe("no_step");
    expect(digestStepProblem([ok, ok])).toBe("several_steps");
    expect(digestStepProblem([{ ...ok, templateKey: "intake_reminder_bounce_notice" }])).toBe(
      "wrong_purpose",
    );
  });

  it("throws before any claim or send when email or APP_BASE_URL is not configured", async () => {
    const send = mailer();
    for (const config of [
      { ...CONFIG, emailReady: false },
      { ...CONFIG, appBaseUrl: null },
      { ...CONFIG, fromEmail: null },
    ]) {
      await expect(
        runFollowUpDigest(ctx(), deps({ config: () => config, send })),
      ).rejects.toBeInstanceOf(FollowUpDigestNotConfiguredError);
    }
    expect(send).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("followup-digest: at-least-once runs, once-per-day sends", () => {
  it("keeps sending when one coordinator is rejected, fails the run, and the next run retries only that one", async () => {
    const send = mailer((input) =>
      input.to === "jane@example.test"
        ? new EmailError("provider_rejected", "SendGrid rejected the send (503)", 503)
        : null,
    );
    const first = await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    expect(first).toEqual(
      counts({ ...BASELINE, orgs_completed: 1, digests_sent: 2, send_failures: 1 }),
    );
    expect(recipients()).toEqual(["bill@example.test", "omar@example.test"]);
    expect(fake.sends.find((r) => r.recipient_user_id === JANE)).toMatchObject({
      outcome: "failed",
      error_code: "provider_rejected",
      provider_message_id: null,
    });
    // Org A's day stays open; org B's is done.
    expect(completions()).toEqual([[JOB, ORG_B, TODAY]]);
    expect(logged()).toContain("[jobs:followup-digest] send_failed_provider_rejected");

    const retry = await runFollowUpDigest(ctx(new Date("2026-10-31T14:00:00Z")), deps());
    expect(retry).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 2,
        orgs_already_completed: 1,
        orgs_completed: 1,
        digests_sent: 1,
        digests_already_sent: 1,
        unassigned_follow_ups: 1,
      }),
    );
    expect(sent.filter((input) => input.to === "jane@example.test")).toHaveLength(1);
    expect(sent).toHaveLength(3);
  });

  it("records only definite rejections as failed; a timeout or an unexplained error stays claimed", async () => {
    const send = mailer((input) => {
      if (input.to === "jane@example.test") return new EmailError("provider_rejected", "400", 400);
      if (input.to === "omar@example.test") {
        return new EmailError("network", "SendGrid request failed");
      }
      return new TypeError("something unexplained");
    });
    const first = await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    expect(first).toEqual(
      counts({
        ...BASELINE,
        orgs_completed: 1,
        digests_sent: 0,
        send_failures: 1,
        sends_uncertain: 2,
      }),
    );
    const byRecipient = Object.fromEntries(
      fake.sends.map((r) => [r.recipient_user_id, [r.outcome, r.error_code]]),
    );
    expect(byRecipient).toEqual({
      [JANE]: ["failed", "provider_rejected"],
      [OMAR]: ["claimed", null],
      [BILL]: ["claimed", null],
    });
    expect(logged()).toContain("[jobs:followup-digest] send_uncertain_network");
    expect(logged()).toContain("[jobs:followup-digest] send_uncertain_error");
    // Org B's only send may have gone out: nothing left to retry there.
    expect(completions()).toEqual([[JOB, ORG_B, TODAY]]);

    // The next run resends only the definite rejection.
    const retry = await runFollowUpDigest(ctx(new Date("2026-10-31T14:00:00Z")), deps());
    expect(retry).toMatchObject({ digests_sent: 1, digests_already_sent: 1 });
    expect(recipients()).toEqual(["jane@example.test"]);
  });

  it("stops retrying a coordinator after three rejections that local date, without failing the run", async () => {
    const send = mailer((input) =>
      input.to === "jane@example.test"
        ? new EmailError("provider_rejected", "SendGrid rejected the send (400)", 400)
        : null,
    );
    const runs = hours("2026-10-31T13:00:00Z", 4);
    for (const at of runs.slice(0, 3)) await incomplete(runFollowUpDigest(ctx(at), deps({ send })));
    const janeAttempts = () =>
      send.mock.calls.filter(([input]) => input.to === "jane@example.test");
    expect(janeAttempts()).toHaveLength(3);
    expect(fake.sends.filter((r) => r.recipient_user_id === JANE).map((r) => r.outcome)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);

    const fourth = await runFollowUpDigest(ctx(runs[3]), deps({ send }));
    expect(fourth).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 2,
        orgs_already_completed: 1,
        orgs_completed: 1,
        digests_already_sent: 1,
        sends_exhausted: 1,
        unassigned_follow_ups: 1,
      }),
    );
    expect(janeAttempts()).toHaveLength(3);
    expect(logged()).toContain("[jobs:followup-digest] send_retries_exhausted");

    // The cap is per local date: tomorrow's digest is tried again.
    await incomplete(runFollowUpDigest(ctx(new Date("2026-11-01T14:00:00Z")), deps({ send })));
    expect(janeAttempts()).toHaveLength(4);
  });

  it("does not send to a coordinator whose claim fails, still sends the rest, and leaves the day open", async () => {
    fake.failClaimFor.add(OMAR);
    const result = await incomplete(runFollowUpDigest(ctx(), deps()));
    expect(result).toEqual(
      counts({ ...BASELINE, orgs_completed: 1, digests_sent: 2, send_failures: 1 }),
    );
    expect(sent.some((input) => input.to === "omar@example.test")).toBe(false);
    expect(completions()).toEqual([[JOB, ORG_B, TODAY]]);
    expect(logged()).toContain("[jobs:followup-digest] send_claim_failed");
    expect(logged()).toContain('"sqlstate":"08006"');
  });

  it("counts a sent email whose ledger row could not be finished, and never resends it", async () => {
    fake.failNextRpc.finish_notification_send = { code: "08006", message: "connection failure" };
    const result = await incomplete(runFollowUpDigest(ctx(), deps()));
    expect(result).toEqual(counts({ ...BASELINE, sends_unrecorded: 1 }));
    expect(fake.sends.filter((r) => r.outcome === "claimed")).toHaveLength(1);

    fake.tables.notification_org_slots = [];
    const retry = await runFollowUpDigest(ctx(new Date("2026-10-31T14:00:00Z")), deps());
    expect(retry).toEqual(counts({ ...BASELINE, digests_sent: 0, digests_already_sent: 3 }));
    expect(sent).toHaveLength(3);
  });

  it("fails the run when a settled org's completion cannot be recorded, and the next run settles it without resending", async () => {
    fake.failNextRpc.complete_notification_org_slot = { code: "08006", message: "lost" };
    const first = await incomplete(runFollowUpDigest(ctx(), deps()));
    expect(first).toEqual(
      counts({ ...BASELINE, orgs_completed: 1, orgs_completion_unrecorded: 1 }),
    );
    expect(logged()).toContain("[jobs:followup-digest] org_completion_unrecorded");
    expect(completions()).toHaveLength(1);

    const next = await runFollowUpDigest(ctx(new Date("2026-10-31T14:00:00Z")), deps());
    expect(next.orgs_already_completed).toBe(1);
    expect(next.orgs_completed).toBe(1);
    expect(next.digests_sent).toBe(0);
    expect(completions()).toHaveLength(2);
    expect(sent).toHaveLength(3);
  });

  it("does not let one org's failed completion check stop another org", async () => {
    fake.failRead = (read) =>
      read.table === "notification_org_slots" &&
      read.filters.some(([, column, value]) => column === "org_id" && value === ORG_A)
        ? { code: "08006", message: "connection failure" }
        : null;
    const result = await incomplete(runFollowUpDigest(ctx(), deps()));
    expect(result).toEqual(
      counts({
        orgs_enabled: 2,
        orgs_due: 2,
        orgs_failed: 1,
        orgs_completed: 1,
        digests_sent: 1,
      }),
    );
    expect(recipients()).toEqual(["bill@example.test"]);
    expect(logged()).toContain("[jobs:followup-digest] org_failed");
  });

  it("through the runner: one slot per UTC hour; a failed hour is retried in that hour, then skipped", async () => {
    const jobDb = createFakeJobDb(NOW.getTime());
    fake = createFollowUpDigestFakeDb(world().tables, jobDb);
    let failJane = true;
    const send = mailer((input) =>
      failJane && input.to === "jane@example.test"
        ? new EmailError("provider_rejected", "x", 503)
        : null,
    );
    const job = {
      ...followupDigestJob,
      run: (jobCtx: JobContext) => {
        clock = jobCtx.now;
        return runFollowUpDigest(jobCtx, deps({ send }));
      },
    };
    const runAt = (date: Date) => {
      jobDb.clock.now = date.getTime();
      return runJob(job, {
        ledger: supabaseJobLedger(fake.db),
        db: fake.db,
        now: date,
        site: SITE,
      });
    };

    const first = await runAt(NOW);
    expect(first).toMatchObject({ outcome: "failed", runKey: "2026-10-31T13", counts: {} });
    expect(sent).toHaveLength(2);

    failJane = false;
    const second = await runAt(new Date("2026-10-31T13:30:00Z"));
    expect(second).toEqual({
      job: JOB,
      runKey: "2026-10-31T13",
      outcome: "succeeded",
      counts: counts({
        orgs_enabled: 2,
        orgs_due: 2,
        orgs_already_completed: 1,
        orgs_completed: 1,
        digests_sent: 1,
        digests_already_sent: 1,
        unassigned_follow_ups: 1,
      }),
    });
    expect(sent).toHaveLength(3);

    const third = await runAt(new Date("2026-10-31T13:45:00Z"));
    expect(third.outcome).toBe("skipped");

    const nextHour = await runAt(new Date("2026-10-31T14:00:00Z"));
    expect(nextHour).toMatchObject({
      runKey: "2026-10-31T14",
      outcome: "succeeded",
      counts: ALREADY,
    });
    expect(sent).toHaveLength(3);
    expect(jobDb.rows.map((r) => [r.run_key, r.outcome])).toEqual([
      ["2026-10-31T13", "failed"],
      ["2026-10-31T13", "succeeded"],
      ["2026-10-31T14", "succeeded"],
    ]);
  });
});

describe("followup-digest: paging and tenant scope", () => {
  it("reads every page: a follow-up past the 1,000-row cap is still listed", async () => {
    const w = world();
    const fillerCases = Array.from({ length: 1_100 }, () => caseRow(ORG_A, OMAR));
    const fillerTouches = fillerCases.map((c) => touchRow(ORG_A, String(c.id), "2026-12-01"));
    // The due case and its touch sort last by id, beyond the first 1,000 rows.
    const last = caseRow(ORG_A, JANE, { id: "case-zzzzz", case_number: 9999 });
    const lastTouch = { ...touchRow(ORG_A, "case-zzzzz", "2026-10-30"), id: "touch-zzzzzz" };
    w.tables.credential_cases.push(...fillerCases, last);
    w.tables.touches.push(...fillerTouches, lastTouch);
    fake = createFollowUpDigestFakeDb(w.tables);
    await runFollowUpDigest(ctx(), deps());
    const jane = sent.find((input) => input.to === "jane@example.test")?.data;
    expect(jane?.followUps.rows.map((r) => r.caseNumber)).toContain(9999);
    expect(w.tables.touches.length).toBeGreaterThan(POSTGREST_MAX_ROWS);
    for (const table of ["credential_cases", "touches", "memberships"]) {
      const reads = fake.reads.filter((r) => r.table === table);
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every((r) => r.ranged)).toBe(true);
    }
    expect(fake.reads.filter((r) => r.table === "touches").length).toBeGreaterThan(2);
  });

  it("finds every enabled org: the discovery read pages past the 1,000-row cap", async () => {
    const w = world();
    // 1,100 enabled orgs that sort before A and B, each due only at 11 pm.
    const filler = Array.from({ length: 1_100 }, (_, i) =>
      sequenceRow(`0${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`, true, {
        send_hour: 23,
      }),
    );
    w.tables.notification_sequences.unshift(...filler);
    fake = createFollowUpDigestFakeDb(w.tables);
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(counts({ ...BASELINE, orgs_enabled: 1_102, orgs_not_due: 1_100 }));
    expect(recipients()).toEqual(["bill@example.test", "jane@example.test", "omar@example.test"]);
    const discovery = fake.reads.filter((r) => r.table === "notification_sequences");
    expect(discovery.length).toBeGreaterThan(2);
    expect(discovery.every((r) => r.ranged)).toBe(true);
    expect(fake.reads.filter((r) => r.table === "notification_sequence_steps").length).toBe(12);
  });

  it("reads across orgs only to discover; scopes every later read to its org and names no PHI column", async () => {
    await runFollowUpDigest(ctx(), deps());
    const discoveryTables = [
      "notification_sequences",
      "notification_sequence_steps",
      "notification_sequence_defaults",
      "notification_sequence_default_steps",
    ];
    const discovery = fake.reads.filter((r) => discoveryTables.includes(r.table));
    const rest = fake.reads.filter((r) => !discoveryTables.includes(r.table));
    expect(discovery.map((r) => r.table)).toEqual(discoveryTables);
    expect(rest.length).toBeGreaterThan(0);
    for (const read of rest) {
      const column = read.table === "organizations" ? "id" : "org_id";
      const orgFilters = read.filters.filter(([op, c]) => op === "eq" && c === column);
      expect(orgFilters, `${read.table} is org-scoped`).toHaveLength(1);
      expect([ORG_A, ORG_B]).toContain(orgFilters[0][2]);
    }
    for (const read of fake.reads) {
      expect(read.columns).not.toMatch(/notes|date_of_birth|ssn|\*/);
      // No at-risk inputs are read any more (MINT-111).
      expect(read.columns).not.toMatch(/avg_decision_days|submitted_date/);
    }
  });

  it("keeps note bodies, DOB and SSN out of every email, log line and count", async () => {
    const send = mailer((input) =>
      input.to === "omar@example.test" ? new Error(`boom ${SENTINEL_NOTE} ${SENTINEL_DOB}`) : null,
    );
    const result = await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    // What SendGrid would receive, rendered from what the job handed the mailer.
    const payloads = JSON.stringify(sent.map((input) => buildMailPayload(input, ENV)));
    expect(sent.length).toBe(2);
    for (const sentinel of SENTINELS) {
      expect(payloads).not.toContain(sentinel);
      expect(JSON.stringify(sent)).not.toContain(sentinel);
      expect(logged()).not.toContain(sentinel);
      expect(JSON.stringify(result)).not.toContain(sentinel);
    }
    // The provider's display name is the one provider value that is sent.
    expect(payloads).toContain("Jane Smith");
    expect(logged()).toContain("send_uncertain_error");
  });

  it("never shows a provider embedded from another org", async () => {
    const w = world();
    // Org B's case points at a provider row that belongs to org A.
    w.cases.billLate.providers = {
      org_id: ORG_A,
      first_name: "Crossorg",
      last_name: "Provider",
      date_of_birth: SENTINEL_DOB,
    };
    fake = createFollowUpDigestFakeDb(w.tables);
    await runFollowUpDigest(ctx(), deps());
    const bill = sent.find((input) => input.to === "bill@example.test")?.data;
    expect(bill?.followUps.rows.map((r) => r.providerName)).toEqual(["Unknown provider"]);
    expect(JSON.stringify(sent)).not.toContain("Crossorg");
  });
});

describe("followup-digest: the touches read", () => {
  const touchReads = (orgId: string) =>
    fake.reads.filter(
      (r) => r.table === "touches" && r.filters.some(([, c, v]) => c === "org_id" && v === orgId),
    );
  const askedCaseIds = (orgId: string) =>
    touchReads(orgId).flatMap((r) =>
      r.filters
        .filter(([op, c]) => op === "in" && c === "case_id")
        .flatMap(([, , v]) => v as string[]),
    );

  it("asks only for the open cases' touches that set or clear a follow-up", async () => {
    const w = world();
    const closed = caseRow(ORG_A, JANE, { case_status: "approved" });
    w.tables.credential_cases.push(closed);
    w.tables.touches.push(touchRow(ORG_A, String(closed.id), "2026-10-29"));
    fake = createFollowUpDigestFakeDb(w.tables);
    await runFollowUpDigest(ctx(), deps());
    for (const orgId of [ORG_A, ORG_B]) {
      expect(touchReads(orgId).length).toBeGreaterThan(0);
      for (const read of touchReads(orgId)) {
        expect(read.filters).toContainEqual(["or", DIGEST_TOUCH_FILTER, null]);
        expect(read.filters).toContainEqual(["eq", "entry_type", "touchpoint"]);
      }
    }
    const openA = [w.cases.janeLate, w.cases.omarToday, w.cases.unassigned, w.cases.janeUpcoming];
    expect(askedCaseIds(ORG_A).sort()).toEqual(openA.map((c) => String(c.id)).sort());
    expect(askedCaseIds(ORG_A)).not.toContain(closed.id);
  });

  it("still ends a follow-up on a clear, and carries one past a date-less touch", async () => {
    const w = world();
    const cleared = caseRow(ORG_B, BILL);
    const carried = caseRow(ORG_B, BILL);
    w.tables.credential_cases.push(cleared, carried);
    w.tables.touches.push(
      { ...touchRow(ORG_B, String(cleared.id), "2026-10-25"), touch_date: "2026-10-01" },
      {
        ...touchRow(ORG_B, String(cleared.id), null),
        touch_date: "2026-10-10",
        clears_follow_up: true,
      },
      { ...touchRow(ORG_B, String(cleared.id), null), touch_date: "2026-10-20" },
      { ...touchRow(ORG_B, String(carried.id), "2026-10-26"), touch_date: "2026-10-01" },
      { ...touchRow(ORG_B, String(carried.id), null), touch_date: "2026-10-20" },
    );
    fake = createFollowUpDigestFakeDb(w.tables);
    await runFollowUpDigest(ctx(), deps());
    const bill = sent.find((input) => input.to === "bill@example.test")?.data;
    expect(bill?.followUps.rows.map((r) => [r.caseNumber, r.dueDate]).sort()).toEqual(
      [
        [w.cases.billLate.case_number, "2026-10-29"],
        [carried.case_number, "2026-10-26"],
      ].sort(),
    );
  });

  it("asks for at most DIGEST_TOUCH_CASE_CHUNK case ids per read, covering every open case", async () => {
    const w = world();
    const filler = Array.from({ length: 250 }, () => caseRow(ORG_A, OMAR));
    const last = caseRow(ORG_A, JANE, { id: "case-zzzzz", case_number: 9999 });
    w.tables.credential_cases.push(...filler, last);
    w.tables.touches.push(
      ...filler.map((c) => touchRow(ORG_A, String(c.id), "2026-12-01")),
      touchRow(ORG_A, "case-zzzzz", "2026-10-30"),
    );
    fake = createFollowUpDigestFakeDb(w.tables);
    await runFollowUpDigest(ctx(), deps());
    const sizes = touchReads(ORG_A).map(
      (r) => (r.filters.find(([op, c]) => op === "in" && c === "case_id")?.[2] as string[]).length,
    );
    expect(sizes.every((size) => size > 0 && size <= DIGEST_TOUCH_CASE_CHUNK)).toBe(true);
    expect(new Set(askedCaseIds(ORG_A)).size).toBe(4 + 250 + 1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(4 + 250 + 1);
    const jane = sent.find((input) => input.to === "jane@example.test")?.data;
    expect(jane?.followUps.rows.map((r) => r.caseNumber)).toContain(9999);
  });

  it("reads no touches for an org with no open case, and still settles its day", async () => {
    const w = world();
    (w.cases.billLate as FakeRow).case_status = "approved";
    fake = createFollowUpDigestFakeDb(w.tables);
    const result = await runFollowUpDigest(ctx(), deps());
    expect(touchReads(ORG_B)).toEqual([]);
    expect(result).toEqual(counts({ ...BASELINE, digests_sent: 2 }));
    expect(completions()).toContainEqual([JOB, ORG_B, TODAY]);
  });
});

describe("followup-digest: registry entry", () => {
  it("is registered under its cron name, with integer count keys and an hourly run key", () => {
    expect(JOB_REGISTRY.get(JOB)).toBe(followupDigestJob);
    expect(followupDigestJob.countKeys).toEqual(FOLLOWUP_DIGEST_COUNT_KEYS);
    expect(followupDigestJob.runKey).toBe(utcHourKey);
    // Every count key is declared and integer-valued in a real run.
    for (const key of FOLLOWUP_DIGEST_COUNT_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("keys a run on the UTC hour, inside the existing run-key pattern", () => {
    for (const [iso, key] of [
      ["2026-10-31T13:00:00Z", "2026-10-31T13"],
      ["2026-10-31T13:59:59.999Z", "2026-10-31T13"],
      ["2026-11-01T06:00:00Z", "2026-11-01T06"],
      ["2026-11-01T07:00:00Z", "2026-11-01T07"],
    ] as const) {
      expect(utcHourKey(new Date(iso))).toBe(key);
      expect(key).toMatch(RUN_KEY_RE);
    }
  });
});
