import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_COUNT_KEY_RE, MAX_JOB_COUNT_KEYS } from "./counts";
import { JOB_STALE_AFTER_MINUTES } from "./ledger";
import { NOTIFICATION_SEND_ERROR_CODES, PROVIDER_MESSAGE_ID_RE } from "./notificationSends";
import { JOB_NAME_RE, RUN_KEY_RE } from "./registry";
import { JOB_ERROR_CODES } from "./types";

// MINT-106 lockstep pins. The fake ledger in src/__fixtures__/jobRunsFakeDb.ts
// stands in for SQL that cannot run in vitest, so the limits it borrows from
// code must be the ones the migration enforces.
const root = process.cwd();
const MIGRATION = readFileSync(
  join(root, "supabase/migrations/20261031050000_job_runs.sql"),
  "utf8",
);
const ledgerSource = readFileSync(join(root, "src/server/jobs/ledger.ts"), "utf8");

describe("job_runs migration and code agree", () => {
  it("sweeps every slot of the job under the stale timeout the runner documents", () => {
    // No run_key filter: a daily job never claims an earlier day's slot again.
    expect(MIGRATION).toContain(
      [
        "  UPDATE public.job_runs",
        "     SET outcome = 'failed', error_code = 'timed_out', finished_at = now()",
        "   WHERE job = p_job",
        "     AND outcome = 'running'",
        `     AND started_at < now() - interval '${JOB_STALE_AFTER_MINUTES} minutes';`,
      ].join("\n"),
    );
    expect(MIGRATION).toContain(
      "PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job_runs:' || p_job, 0));",
    );
  });

  it("names the partial index as the ON CONFLICT target, so other conflicts raise", () => {
    expect(MIGRATION).toContain(
      "ON CONFLICT (job, run_key) WHERE outcome IN ('running', 'succeeded') DO NOTHING",
    );
    expect(MIGRATION).not.toMatch(/ON CONFLICT DO NOTHING/);
  });

  it("closes error_code to the codes the runner writes, in the CHECK and in finish_job_run", () => {
    const list = JOB_ERROR_CODES.map((code) => `'${code}'`).join(", ");
    expect(MIGRATION).toContain(`error_code IS NULL OR error_code IN (${list})`);
    expect(MIGRATION).toContain(`AND p_error_code NOT IN (${list}) THEN`);
  });

  it("allows one running or succeeded row per (job, run_key)", () => {
    expect(MIGRATION).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS job_runs_one_live_run\s+ON public\.job_runs \(job, run_key\) WHERE outcome IN \('running', 'succeeded'\);/,
    );
  });

  it("checks job names, run keys and count keys with the code's patterns", () => {
    const sqlPattern = (re: RegExp) => `'${re.source}'`;
    expect(MIGRATION).toContain(`CHECK (job ~ ${sqlPattern(JOB_NAME_RE)})`);
    expect(MIGRATION).toContain(`CHECK (run_key ~ ${sqlPattern(RUN_KEY_RE)})`);
    expect(MIGRATION).toContain(`v_key !~ ${sqlPattern(JOB_COUNT_KEY_RE)}`);
    expect(MIGRATION).toContain(`IF v_keys > ${MAX_JOB_COUNT_KEYS} OR`);
  });

  it("calls the RPCs by the names and arguments the migration defines", () => {
    expect(MIGRATION).toContain(
      "CREATE OR REPLACE FUNCTION public.claim_job_run(p_job text, p_run_key text)",
    );
    expect(MIGRATION).toMatch(
      /FUNCTION public\.finish_job_run\(\s+p_id uuid,\s+p_outcome text,\s+p_counts jsonb,\s+p_error_code text DEFAULT NULL\s+\)/,
    );
    expect(ledgerSource).toContain('db.rpc("claim_job_run", { p_job: job, p_run_key: runKey })');
    for (const arg of ["p_id:", "p_outcome:", "p_counts:", "p_error_code:"]) {
      expect(ledgerSource).toContain(arg);
    }
  });

  it("is service_role only: RLS on, no policy, nothing for anon or authenticated", () => {
    expect(MIGRATION).toContain("ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;");
    expect(MIGRATION).not.toMatch(/CREATE POLICY/i);
    expect(MIGRATION).toContain(
      "REVOKE ALL ON TABLE public.job_runs FROM public, anon, authenticated, service_role;",
    );
    expect(MIGRATION).toContain("GRANT SELECT ON TABLE public.job_runs TO service_role;");
    expect(MIGRATION).not.toMatch(/GRANT [^;]* TO [^;]*\b(anon|authenticated)\b/);
    for (const fn of ["claim_job_run(text, text)", "finish_job_run(uuid, text, jsonb, text)"]) {
      expect(MIGRATION).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM public, anon, authenticated;`,
      );
      expect(MIGRATION).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
    expect(MIGRATION.match(/SECURITY DEFINER\nSET search_path = ''/g)).toHaveLength(2);
  });
});

// MINT-108: the fake in src/__fixtures__/followUpDigestFakeDb.ts stands in for
// notification_sends, so its limits must be the migration's.
const SENDS_MIGRATION = readFileSync(
  join(root, "supabase/migrations/20261031060000_notification_sends.sql"),
  "utf8",
);
const sendsLedgerSource = readFileSync(join(root, "src/server/jobs/notificationSends.ts"), "utf8");

describe("notification_sends migration and code agree", () => {
  it("sorts after the job_runs and notification sequences migrations it follows", () => {
    const order = readdirSync(join(root, "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const at = (file: string) => order.indexOf(file);
    expect(at("20261031060000_notification_sends.sql")).toBeGreaterThan(
      at("20261031051500_notification_sequences.sql"),
    );
    expect(at("20261031051500_notification_sequences.sql")).toBeGreaterThan(
      at("20261031050000_job_runs.sql"),
    );
    expect(at("20261031050000_job_runs.sql")).toBeGreaterThan(-1);
  });

  it("allows one claimed or sent row per (job, run_key, org_id, recipient_user_id)", () => {
    expect(SENDS_MIGRATION).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS notification_sends_one_live_send\s+ON public\.notification_sends \(job, run_key, org_id, recipient_user_id\)\s+WHERE outcome IN \('claimed', 'sent'\);/,
    );
    expect(SENDS_MIGRATION).toMatch(
      /ON CONFLICT \(job, run_key, org_id, recipient_user_id\)\s+WHERE outcome IN \('claimed', 'sent'\) DO NOTHING/,
    );
    expect(SENDS_MIGRATION).not.toMatch(/ON CONFLICT DO NOTHING/);
  });

  it("closes error_code to the codes the job writes, in the CHECK and in the finish", () => {
    const list = NOTIFICATION_SEND_ERROR_CODES.map((code) => `'${code}'`).join(", ");
    expect(SENDS_MIGRATION).toContain(`OR error_code IN (${list})`);
    expect(SENDS_MIGRATION).toContain(`AND p_error_code NOT IN (${list}) THEN`);
  });

  it("checks job, run key and message id with the code's patterns", () => {
    const sqlPattern = (re: RegExp) => `'${re.source}'`;
    expect(SENDS_MIGRATION).toContain(`CHECK (job ~ ${sqlPattern(JOB_NAME_RE)})`);
    expect(SENDS_MIGRATION).toContain(`CHECK (run_key ~ ${sqlPattern(RUN_KEY_RE)})`);
    expect(SENDS_MIGRATION).toContain(
      `provider_message_id IS NULL OR provider_message_id ~ ${sqlPattern(PROVIDER_MESSAGE_ID_RE)}`,
    );
  });

  it("calls the RPCs by the names and arguments the migration defines", () => {
    expect(SENDS_MIGRATION).toMatch(
      /FUNCTION public\.claim_notification_send\(\s+p_job text,\s+p_run_key text,\s+p_org_id uuid,\s+p_recipient_user_id uuid\s+\)/,
    );
    expect(SENDS_MIGRATION).toMatch(
      /FUNCTION public\.finish_notification_send\(\s+p_id uuid,\s+p_outcome text,\s+p_provider_message_id text DEFAULT NULL,\s+p_error_code text DEFAULT NULL\s+\)/,
    );
    expect(sendsLedgerSource).toContain('db.rpc("claim_notification_send", {');
    expect(sendsLedgerSource).toContain('db.rpc("finish_notification_send", {');
    for (const arg of [
      "p_job:",
      "p_run_key:",
      "p_org_id:",
      "p_recipient_user_id:",
      "p_id:",
      "p_outcome:",
      "p_provider_message_id:",
      "p_error_code:",
    ]) {
      expect(sendsLedgerSource).toContain(arg);
    }
  });

  it("is service_role only: RLS on, no policy, nothing for anon or authenticated", () => {
    expect(SENDS_MIGRATION).toContain(
      "ALTER TABLE public.notification_sends ENABLE ROW LEVEL SECURITY;",
    );
    expect(SENDS_MIGRATION).not.toMatch(/CREATE POLICY/i);
    expect(SENDS_MIGRATION).toContain(
      "REVOKE ALL ON TABLE public.notification_sends FROM public, anon, authenticated, service_role;",
    );
    expect(SENDS_MIGRATION).toContain(
      "GRANT SELECT ON TABLE public.notification_sends TO service_role;",
    );
    expect(SENDS_MIGRATION).not.toMatch(/GRANT [^;]* TO [^;]*\b(anon|authenticated)\b/);
    for (const fn of [
      "claim_notification_send(text, text, uuid, uuid)",
      "finish_notification_send(uuid, text, text, text)",
    ]) {
      expect(SENDS_MIGRATION).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn.replace(/[()]/g, "\\$&")}\\s+FROM public, anon, authenticated;`,
        ),
      );
      expect(SENDS_MIGRATION).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
    expect(SENDS_MIGRATION.match(/SECURITY DEFINER\nSET search_path = ''/g)).toHaveLength(2);
  });

  it("stores no PHI: ids, the slot, timestamps and codes only", () => {
    const table = SENDS_MIGRATION.slice(
      SENDS_MIGRATION.indexOf("CREATE TABLE IF NOT EXISTS public.notification_sends"),
      SENDS_MIGRATION.indexOf("CREATE UNIQUE INDEX"),
    );
    const columns = [...table.matchAll(/^ {2}([a-z_]+) (?:uuid|text|timestamptz)/gm)].map(
      (m) => m[1],
    );
    expect(columns).toEqual([
      "id",
      "job",
      "run_key",
      "org_id",
      "recipient_user_id",
      "outcome",
      "claimed_at",
      "finished_at",
      "provider_message_id",
      "error_code",
    ]);
    expect(table).toContain("REFERENCES public.organizations(id) ON DELETE CASCADE");
  });
});

describe("jobs code logs only through safeLog", () => {
  it("has no console call outside tests, in any file under src/server/jobs/", () => {
    const dir = join(root, "src/server/jobs");
    const sources = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/\bconsole\s*\./);
    }
  });
});
