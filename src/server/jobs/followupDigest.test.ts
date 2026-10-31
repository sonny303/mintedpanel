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
import { JOB_REGISTRY } from "./registry";
import { jobLogger, runJob } from "./runner";
import type { JobContext } from "./types";

// MINT-108 job tests against an in-memory PostgREST (rows come back whole,
// unranged reads stop at 1,000) and a stub mailer. SendGrid is never called.
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

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_OFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORG_NONE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const JANE = "11111111-1111-4111-8111-111111111111";
const OMAR = "22222222-2222-4222-8222-222222222222";
const ADA = "33333333-3333-4333-8333-333333333333";
const BILL = "44444444-4444-4444-8444-444444444444";
const FORMER = "99999999-9999-4999-8999-999999999999";

// PHI sentinels seeded into the rows the fake hands back whole.
const SENTINEL_NOTE = "SENTINEL-NOTE called provider about divorce";
const SENTINEL_DOB = "1961-04-12";
const SENTINEL_SSN = "6789";
const SENTINELS = [SENTINEL_NOTE, SENTINEL_DOB, SENTINEL_SSN, "SENTINEL"];

function sequenceRows(orgId: string, name: string, enabled: boolean, step: Partial<FakeRow>) {
  const sequence: FakeRow = {
    id: `seq-${orgId}`,
    org_id: orgId,
    purpose: "followup_digest",
    enabled,
    stop_conditions: [],
    target_days_to_ready: null,
    compress_toward_start_date: false,
    revision: 1,
    created_at: "2026-10-30T00:00:00Z",
    updated_at: "2026-10-30T00:00:00Z",
    updated_by: null,
    organizations: { name },
  };
  const stepRow: FakeRow = {
    id: `step-${orgId}`,
    sequence_id: `seq-${orgId}`,
    org_id: orgId,
    position: 1,
    offset_days: 0,
    channel: "email",
    template_key: "followup_digest_daily",
    cc_recipients: [],
    created_at: "2026-10-30T00:00:00Z",
    updated_at: "2026-10-30T00:00:00Z",
    ...step,
  };
  return { sequence, step: stepRow };
}

function membership(
  orgId: string,
  userId: string,
  role: string,
  first: string,
  last: string,
): FakeRow {
  return {
    id: `m-${orgId}-${userId}`,
    org_id: orgId,
    user_id: userId,
    role,
    created_at: `2026-01-0${role === "admin" ? 1 : 2}T00:00:00Z`,
    profiles: {
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`,
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
    submitted_date: null,
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
    payers: { name: "Aetna", avg_decision_days: null, delegation_note: "SENTINEL payer note" },
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

/** Org A: Jane (overdue, at risk), Omar (due today), one unassigned overdue,
 *  admin Ada cc'd by role, a former member cc'd by user. Org B: Bill, overdue.
 *  Org OFF: switched off. Org NONE: no sequence row. */
function world(steps: { a?: Partial<FakeRow>; b?: Partial<FakeRow> } = {}): World {
  const a = sequenceRows(ORG_A, "Shelby Rehab", true, {
    cc_recipients: [
      { kind: "role", role: "admin" },
      { kind: "user", user_id: FORMER },
    ],
    ...steps.a,
  });
  const b = sequenceRows(ORG_B, "Coastal PT", true, steps.b ?? {});
  const off = sequenceRows(ORG_OFF, "Off Org", false, {});
  const janeLate = caseRow(ORG_A, JANE, {
    case_status: "submitted",
    submitted_date: "2026-08-30",
    payers: { name: "Aetna", avg_decision_days: 45 },
  });
  const omarToday = caseRow(ORG_A, OMAR);
  const unassigned = caseRow(ORG_A, null);
  const janeUpcoming = caseRow(ORG_A, JANE);
  const billLate = caseRow(ORG_B, BILL);
  const offCase = caseRow(ORG_OFF, null);
  const noneCase = caseRow(ORG_NONE, null);
  return {
    cases: { janeLate, omarToday, unassigned, janeUpcoming, billLate },
    tables: {
      notification_sequences: [a.sequence, b.sequence, off.sequence],
      notification_sequence_steps: [a.step, b.step, off.step],
      memberships: [
        membership(ORG_A, ADA, "admin", "Ada", "Admin"),
        membership(ORG_A, JANE, "specialist", "Jane", "Doe"),
        membership(ORG_A, OMAR, "specialist", "Omar", "Ali"),
        membership(ORG_B, BILL, "specialist", "Bill", "Bay"),
        membership(ORG_OFF, BILL, "admin", "Bill", "Bay"),
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
let sent: DigestSend[];
let consoleError: MockInstance<(...args: unknown[]) => void>;
let messageSeq = 0;

function mailer(fail: (input: DigestSend) => unknown = () => null) {
  return vi.fn(async (input: DigestSend) => {
    const error = fail(input);
    if (error) throw error;
    sent.push(input);
    messageSeq += 1;
    return { status: 202, messageId: `msg${messageSeq}.abc`, sandbox: false };
  });
}

function ctx(runKey = TODAY, now = NOW): JobContext {
  return { db: fake.db, now, runKey, log: jobLogger("followup-digest", SITE) };
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

const BASELINE = counts({
  orgs_considered: 3,
  orgs_enabled: 2,
  digests_sent: 4,
  cc_members_dropped: 1,
});

beforeEach(() => {
  vi.stubEnv("DEV", false);
  fake = createFollowUpDigestFakeDb(world().tables);
  sent = [];
  messageSeq = 0;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  consoleError.mockRestore();
});

describe("followup-digest: who gets what", () => {
  it("emails each coordinator and each cc'd member once, and reports exact counts", async () => {
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(BASELINE);

    const byTo = new Map(sent.map((input) => [input.to, input]));
    expect([...byTo.keys()].sort()).toEqual([
      "ada@example.test",
      "bill@example.test",
      "jane@example.test",
      "omar@example.test",
    ]);
    for (const input of sent) {
      expect(input.template).toBe("followup_digest_daily");
      expect(input.replyTo).toEqual({ email: CONFIG.fromEmail });
    }
    const jane = byTo.get("jane@example.test")?.data;
    expect(jane?.own.rows.map((r) => [r.status, r.dueDate, r.atRisk])).toEqual([
      ["overdue", "2026-10-28", { daysSinceSubmission: 62, avgDecisionDays: 45 }],
    ]);
    expect(jane?.own.rows[0].caseLink).toMatch(/^https:\/\/app\.example\.test\/cases\/case-\d{5}$/);
    expect(jane?.unassigned.rows).toEqual([]);
    expect(byTo.get("jane@example.test")?.practiceName).toBe("Shelby Rehab");
    expect(byTo.get("omar@example.test")?.data.own.rows.map((r) => r.status)).toEqual([
      "due_today",
    ]);
    // Ada is cc'd by role and coordinates nothing: Unassigned rows plus the team.
    const ada = byTo.get("ada@example.test")?.data;
    expect(ada?.own.rows).toEqual([]);
    expect(ada?.unassigned.rows.map((r) => r.dueDate)).toEqual(["2026-10-25"]);
    expect(ada?.team).toEqual([
      { coordinatorName: "Jane Doe", overdue: 1, dueToday: 0, atRisk: 1 },
      { coordinatorName: "Omar Ali", overdue: 0, dueToday: 1, atRisk: 0 },
    ]);
    expect(byTo.get("bill@example.test")?.data.own.rows).toHaveLength(1);

    // One sent ledger row per recipient, keyed on (job, runKey, org, recipient).
    expect(
      fake.sends.map((r) => [r.job, r.run_key, r.org_id, r.recipient_user_id, r.outcome]).sort(),
    ).toEqual(
      [
        ["followup-digest", TODAY, ORG_A, ADA, "sent"],
        ["followup-digest", TODAY, ORG_A, JANE, "sent"],
        ["followup-digest", TODAY, ORG_A, OMAR, "sent"],
        ["followup-digest", TODAY, ORG_B, BILL, "sent"],
      ].sort(),
    );
    expect(fake.sends.every((r) => /^msg\d+\.abc$/.test(r.provider_message_id ?? ""))).toBe(true);
  });

  it("drops a cc'd user who is no longer a member, and never claims a send for them", async () => {
    await runFollowUpDigest(ctx(), deps());
    expect(fake.sends.some((r) => r.recipient_user_id === FORMER)).toBe(false);
    expect(sent.some((input) => input.to.startsWith("former"))).toBe(false);
  });

  it("resolves a cc'd user who is still a member, alongside a role", async () => {
    fake = createFollowUpDigestFakeDb(
      world({
        a: {
          cc_recipients: [
            { kind: "user", user_id: OMAR },
            { kind: "role", role: "specialist" },
          ],
        },
      }).tables,
    );
    const result = await runFollowUpDigest(ctx(), deps());
    // Jane and Omar coordinate and are cc'd; Ada is neither, so she gets nothing.
    expect(result).toEqual(counts({ ...BASELINE, digests_sent: 3, cc_members_dropped: 0 }));
    const omar = sent.find((input) => input.to === "omar@example.test")?.data;
    expect(omar?.unassigned.rows).toHaveLength(1);
    expect(omar?.team).toHaveLength(2);
    expect(sent.some((input) => input.to === "ada@example.test")).toBe(false);
  });

  it("counts unassigned follow-ups as unrouted when no one is cc'd", async () => {
    fake = createFollowUpDigestFakeDb(world({ a: { cc_recipients: [] } }).tables);
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(
      counts({ ...BASELINE, digests_sent: 3, cc_members_dropped: 0, unassigned_unrouted: 1 }),
    );
  });

  it("suppresses an empty digest and skips a recipient with no usable address", async () => {
    const w = world({ a: { cc_recipients: [{ kind: "user", user_id: ADA }] } });
    // Ada's profile has no email; Omar's only follow-up moves out to next week.
    const ada = w.tables.memberships.find((m) => m.user_id === ADA) as FakeRow;
    ada.profiles = { ...(ada.profiles as FakeRow), email: "not an address" };
    const omarTouch = w.tables.touches.find((t) => t.case_id === w.cases.omarToday.id) as FakeRow;
    omarTouch.next_follow_up_date = "2026-11-07";
    fake = createFollowUpDigestFakeDb(w.tables);
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(
      counts({
        ...BASELINE,
        digests_sent: 2,
        cc_members_dropped: 0,
        digests_suppressed: 1,
        recipients_skipped: 1,
      }),
    );
    expect(sent.map((input) => input.to).sort()).toEqual([
      "bill@example.test",
      "jane@example.test",
    ]);
  });
});

describe("followup-digest: when nothing is sent", () => {
  it("sends nothing for a disabled or missing sequence, and needs no email config", async () => {
    const w = world();
    w.tables.notification_sequences = w.tables.notification_sequences.filter(
      (row) => row.org_id === ORG_OFF,
    );
    fake = createFollowUpDigestFakeDb(w.tables);
    const config = vi.fn(() => ({ appBaseUrl: null, fromEmail: null, emailReady: false }));
    const send = mailer();
    const result = await runFollowUpDigest(ctx(), deps({ config, send }));
    expect(result).toEqual(counts({ orgs_considered: 1 }));
    expect(send).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toEqual([]);
    // Nothing beyond the discovery read: the off and missing orgs are never read.
    expect(fake.reads.map((r) => r.table)).toEqual(["notification_sequences"]);
  });

  it("switched off between the discovery read and its own read: nothing is sent", async () => {
    let reads = 0;
    const w = world();
    fake = createFollowUpDigestFakeDb(w.tables);
    fake.failRead = (read) => {
      // After the discovery read, org A's own read sees the switch flipped off.
      if (read.table === "notification_sequences" && ++reads === 2) {
        (w.tables.notification_sequences[0] as FakeRow).enabled = false;
      }
      return null;
    };
    const result = await runFollowUpDigest(ctx(), deps());
    expect(result).toEqual(counts({ orgs_considered: 3, orgs_enabled: 1, digests_sent: 1 }));
    expect(sent.map((input) => input.to)).toEqual(["bill@example.test"]);
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
    "skips an org whose step names %s, counts it, and still sends the others",
    async (_label, step, event) => {
      fake = createFollowUpDigestFakeDb(world({ a: step }).tables);
      const result = await runFollowUpDigest(ctx(), deps());
      expect(result).toEqual(
        counts({ orgs_considered: 3, orgs_enabled: 2, orgs_skipped_template: 1, digests_sent: 1 }),
      );
      expect(sent.map((input) => input.to)).toEqual(["bill@example.test"]);
      expect(fake.sends.map((r) => r.org_id)).toEqual([ORG_B]);
      // The skipped org is never read past its sequence.
      expect(
        fake.reads.some(
          (r) => r.table === "credential_cases" && r.filters.some((f) => f[2] === ORG_A),
        ),
      ).toBe(false);
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
  it("sends nothing new on a rerun the same day, and sends again the next day", async () => {
    await runFollowUpDigest(ctx(), deps());
    expect(sent).toHaveLength(4);

    const rerun = await runFollowUpDigest(ctx(), deps());
    expect(rerun).toEqual(counts({ ...BASELINE, digests_sent: 0, digests_already_sent: 4 }));
    expect(sent).toHaveLength(4);

    const tomorrow = new Date("2026-11-01T00:05:00Z");
    await runFollowUpDigest(ctx("2026-11-01", tomorrow), deps());
    expect(sent).toHaveLength(8);
    expect(fake.sends.filter((r) => r.run_key === "2026-11-01")).toHaveLength(4);
  });

  it("keeps sending when one recipient is rejected, fails the run, and a later call retries only that one", async () => {
    const send = mailer((input) =>
      input.to === "jane@example.test"
        ? new EmailError("provider_rejected", "SendGrid rejected the send (503)", 503)
        : null,
    );
    const first = await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    expect(first).toEqual(counts({ ...BASELINE, digests_sent: 3, send_failures: 1 }));
    expect(sent.map((input) => input.to).sort()).toEqual([
      "ada@example.test",
      "bill@example.test",
      "omar@example.test",
    ]);
    expect(fake.sends.find((r) => r.recipient_user_id === JANE)).toMatchObject({
      outcome: "failed",
      error_code: "provider_rejected",
      provider_message_id: null,
    });
    expect(logged()).toContain("[jobs:followup-digest] send_failed_provider_rejected");

    const retry = await runFollowUpDigest(ctx(), deps());
    expect(retry).toEqual(counts({ ...BASELINE, digests_sent: 1, digests_already_sent: 3 }));
    expect(sent.map((input) => input.to).filter((to) => to === "jane@example.test")).toHaveLength(
      1,
    );
    expect(sent).toHaveLength(4);
  });

  it("records only definite rejections as failed; a timeout or an unexplained error stays claimed", async () => {
    const send = mailer((input) => {
      if (input.to === "jane@example.test") return new EmailError("provider_rejected", "400", 400);
      if (input.to === "omar@example.test") {
        return new EmailError("invalid_input", "Recipient is not a valid email address");
      }
      if (input.to === "ada@example.test")
        return new EmailError("network", "SendGrid request failed");
      return new TypeError("something unexplained");
    });
    const first = await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    expect(first).toEqual(
      counts({ ...BASELINE, digests_sent: 0, send_failures: 2, sends_uncertain: 2 }),
    );
    const byRecipient = Object.fromEntries(
      fake.sends.map((r) => [r.recipient_user_id, [r.outcome, r.error_code]]),
    );
    expect(byRecipient).toEqual({
      [JANE]: ["failed", "provider_rejected"],
      [OMAR]: ["failed", "invalid_input"],
      [ADA]: ["claimed", null],
      [BILL]: ["claimed", null],
    });
    expect(logged()).toContain("[jobs:followup-digest] send_uncertain_network");
    expect(logged()).toContain("[jobs:followup-digest] send_uncertain_error");

    // A later call resends only the definite rejections: the timeout and the
    // unexplained error may have been delivered.
    const retry = await runFollowUpDigest(ctx(), deps());
    expect(retry).toEqual(counts({ ...BASELINE, digests_sent: 2, digests_already_sent: 2 }));
    expect(sent.map((input) => input.to).sort()).toEqual([
      "jane@example.test",
      "omar@example.test",
    ]);
  });

  it("stops retrying a recipient after three rejections that day, without failing the run", async () => {
    const send = mailer((input) =>
      input.to === "jane@example.test"
        ? new EmailError("provider_rejected", "SendGrid rejected the send (400)", 400)
        : null,
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    }
    const janeAttempts = () =>
      send.mock.calls.filter(([input]) => input.to === "jane@example.test");
    expect(janeAttempts()).toHaveLength(3);
    expect(fake.sends.filter((r) => r.recipient_user_id === JANE).map((r) => r.outcome)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);

    const fourth = await runFollowUpDigest(ctx(), deps({ send }));
    expect(fourth).toEqual(
      counts({ ...BASELINE, digests_sent: 0, digests_already_sent: 3, sends_exhausted: 1 }),
    );
    expect(janeAttempts()).toHaveLength(3);
    expect(logged()).toContain("[jobs:followup-digest] send_retries_exhausted");

    // The cap is per day: tomorrow's digest is tried again.
    await incomplete(
      runFollowUpDigest(ctx("2026-11-01", new Date("2026-11-01T13:00:00Z")), deps({ send })),
    );
    expect(janeAttempts()).toHaveLength(4);
  });

  it("does not send to a recipient whose claim fails, and still sends the rest", async () => {
    fake.failClaimFor.add(OMAR);
    const send = mailer();
    const result = await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    expect(result).toEqual(counts({ ...BASELINE, digests_sent: 3, send_failures: 1 }));
    expect(sent.some((input) => input.to === "omar@example.test")).toBe(false);
    expect(logged()).toContain("[jobs:followup-digest] send_claim_failed");
    expect(logged()).toContain('"sqlstate":"08006"');
  });

  it("counts a sent email whose ledger row could not be finished, and never resends it", async () => {
    fake.failNextRpc.finish_notification_send = { code: "08006", message: "connection failure" };
    const result = await incomplete(runFollowUpDigest(ctx(), deps()));
    expect(result).toEqual(counts({ ...BASELINE, sends_unrecorded: 1 }));
    expect(fake.sends.filter((r) => r.outcome === "claimed")).toHaveLength(1);

    const retry = await runFollowUpDigest(ctx(), deps());
    expect(retry).toEqual(counts({ ...BASELINE, digests_sent: 0, digests_already_sent: 4 }));
    expect(sent).toHaveLength(4);
  });

  it("does not let one org's failed read stop another org", async () => {
    fake.failRead = (read) =>
      read.table === "touches" &&
      read.filters.some(([, column, value]) => column === "org_id" && value === ORG_A)
        ? { code: "57014", message: "canceling statement due to statement timeout" }
        : null;
    const result = await incomplete(runFollowUpDigest(ctx(), deps()));
    expect(result).toEqual(
      counts({ orgs_considered: 3, orgs_enabled: 2, orgs_failed: 1, digests_sent: 1 }),
    );
    expect(sent.map((input) => input.to)).toEqual(["bill@example.test"]);
    expect(logged()).toContain("[jobs:followup-digest] org_failed");
  });

  it("through the runner: a failed run is run again by a later call that day, then skipped", async () => {
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
      run: (jobCtx: JobContext) => runFollowUpDigest(jobCtx, deps({ send })),
    };
    const runAt = (date: Date) =>
      runJob(job, { ledger: supabaseJobLedger(fake.db), db: fake.db, now: date, site: SITE });

    const first = await runAt(NOW);
    expect(first).toMatchObject({ outcome: "failed", runKey: TODAY, counts: {} });
    expect(sent).toHaveLength(3);

    failJane = false;
    jobDb.clock.now = NOW.getTime() + 60 * 60_000;
    const second = await runAt(new Date(jobDb.clock.now));
    expect(second).toEqual({
      job: "followup-digest",
      runKey: TODAY,
      outcome: "succeeded",
      counts: counts({ ...BASELINE, digests_sent: 1, digests_already_sent: 3 }),
    });
    expect(sent).toHaveLength(4);

    jobDb.clock.now += 60 * 60_000;
    const third = await runAt(new Date(jobDb.clock.now));
    expect(third.outcome).toBe("skipped");
    expect(sent).toHaveLength(4);
    expect(jobDb.rows.map((r) => r.outcome)).toEqual(["failed", "succeeded"]);
  });
});

describe("followup-digest: today, paging and tenant scope", () => {
  it("uses the UTC day of the run, not the server's local day", async () => {
    // 23:30 in Denver on Oct 31 is Nov 1 in UTC: Omar's Oct 31 follow-up is overdue.
    const late = new Date("2026-10-31T23:30:00-06:00");
    await runFollowUpDigest(ctx("2026-11-01", late), deps());
    const omar = sent.find((input) => input.to === "omar@example.test")?.data;
    expect(omar?.digestDate).toBe("2026-11-01");
    expect(omar?.own.rows.map((r) => r.status)).toEqual(["overdue"]);
  });

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
    expect(jane?.own.rows.map((r) => r.caseNumber)).toContain(9999);
    expect(w.tables.touches.length).toBeGreaterThan(POSTGREST_MAX_ROWS);
    for (const table of ["credential_cases", "touches", "memberships"]) {
      const reads = fake.reads.filter((r) => r.table === table);
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every((r) => r.ranged)).toBe(true);
    }
    expect(fake.reads.filter((r) => r.table === "touches").length).toBeGreaterThan(2);
  });

  it("scopes every read after discovery to the org it serves, and names no PHI column", async () => {
    await runFollowUpDigest(ctx(), deps());
    const [discovery, ...rest] = fake.reads;
    expect(discovery.table).toBe("notification_sequences");
    expect(discovery.filters).toEqual([["eq", "purpose", "followup_digest"]]);
    expect(rest.length).toBeGreaterThan(0);
    for (const read of rest) {
      const orgFilters = read.filters.filter(([op, column]) => op === "eq" && column === "org_id");
      expect(orgFilters, `${read.table} is org-scoped`).toHaveLength(1);
      expect([ORG_A, ORG_B]).toContain(orgFilters[0][2]);
    }
    for (const read of fake.reads) {
      expect(read.columns).not.toMatch(/notes|date_of_birth|ssn|\*/);
    }
  });

  it("keeps note bodies, DOB and SSN out of every email, log line and count", async () => {
    const send = mailer((input) =>
      input.to === "ada@example.test" ? new Error(`boom ${SENTINEL_NOTE} ${SENTINEL_DOB}`) : null,
    );
    const result = await incomplete(runFollowUpDigest(ctx(), deps({ send })));
    // What SendGrid would receive, rendered from what the job handed the mailer.
    const payloads = JSON.stringify(sent.map((input) => buildMailPayload(input, ENV)));
    expect(sent.length).toBe(3);
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
    expect(bill?.own.rows.map((r) => [r.caseNumber, r.dueDate]).sort()).toEqual(
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
    expect(jane?.own.rows.map((r) => r.caseNumber)).toContain(9999);
  });

  it("reads no touches for an org with no open case", async () => {
    const w = world();
    (w.cases.billLate as FakeRow).case_status = "approved";
    fake = createFollowUpDigestFakeDb(w.tables);
    const result = await runFollowUpDigest(ctx(), deps());
    expect(touchReads(ORG_B)).toEqual([]);
    expect(result).toEqual(counts({ ...BASELINE, digests_sent: 3 }));
  });
});

describe("followup-digest: tenant isolation under the service key", () => {
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
    expect(bill?.own.rows.map((r) => r.providerName)).toEqual(["Unknown provider"]);
    expect(JSON.stringify(sent)).not.toContain("Crossorg");
  });
});

describe("followup-digest: registry entry", () => {
  it("is registered under its cron name, with integer count keys only", () => {
    expect(JOB_REGISTRY.get("followup-digest")).toBe(followupDigestJob);
    expect(followupDigestJob.countKeys).toEqual(FOLLOWUP_DIGEST_COUNT_KEYS);
    expect(followupDigestJob.runKey).toBeUndefined();
  });
});
