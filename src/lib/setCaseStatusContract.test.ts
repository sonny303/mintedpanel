// set_case_status is the one case-status transition path. An admin correction
// into Approved (backfilling from the payer letter) must store the effective
// date it is given; before 20261021120000 it fell through to the plain status
// UPDATE and the date was dropped. The behavior itself is proven on a
// disposable Postgres by supabase/tests/set-case-status-correction-effective-date.sql;
// these pin the migration source so a later reissue cannot quietly lose it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FIX = "20261021120000_set_case_status_correction_effective_date.sql";
const PRIOR = "20260727150200_e68_case_status_missing_ack.sql";

const read = (file: string) => readFileSync(join(MIGRATIONS, file), "utf8");
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, "");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

interface Definition {
  file: string;
  args: string;
  body: string;
}

function definitionsIn(file: string): Definition[] {
  const sql = read(file);
  return [
    ...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.set_case_status\s*\(([^)]*)\)/gi),
  ].map((match) => {
    const open = sql.indexOf("AS $$", match.index) + "AS $$".length;
    const close = sql.indexOf("$$;", open);
    return { file, args: normalize(match[1]), body: sql.slice(open, close) };
  });
}

const definitions = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .flatMap(definitionsIn);

const CORRECTION_INTO_APPROVED =
  /ELSIF p_is_correction AND p_to_status = 'approved' THEN\s+UPDATE public\.credential_cases\s+SET case_status = p_to_status,\s+credentialing_status_id = COALESCE\(v_mirror_status, credentialing_status_id\),\s+payer_pipeline_state = v_mirror_pipeline,\s+confirmed_effective_date = COALESCE\(p_effective_date, confirmed_effective_date\),\s+updated_at = now\(\)\s+WHERE id = p_case_id\s+RETURNING \* INTO v_case;/i;

describe("set_case_status keeps a correction's effective date", () => {
  const latest = definitions.at(-1);
  if (!latest) throw new Error("No set_case_status definition found");
  const body = stripSqlComments(latest.body);

  it("the latest definition stores p_effective_date on a correction into Approved", () => {
    expect(latest.file).toBe(FIX);
    expect(body).toMatch(CORRECTION_INTO_APPROVED);
  });

  it("the correction branch leaves expected payer IDs alone, as before", () => {
    const branch = body.match(CORRECTION_INTO_APPROVED)?.[0] ?? "";
    expect(branch).not.toMatch(/payer_individual_provider_id|payer_group_provider_id/);
  });

  it("only the normal close requires the date; a dateless correction stays allowed", () => {
    expect(body).toMatch(
      /IF p_to_status = 'approved' AND NOT p_is_correction THEN\s+IF p_effective_date IS NULL THEN\s+RAISE EXCEPTION 'case_status_approved_needs_effective_date';/,
    );
    expect(body.match(/case_status_approved_needs_effective_date/g)).toHaveLength(1);
  });

  it(`${FIX} changes nothing in the E6.8 body but the correction branch`, () => {
    const [prior] = definitionsIn(PRIOR);
    const [fix] = definitionsIn(FIX);
    const withoutBranch = fix.body.replace(
      /\n {2}ELSIF p_is_correction AND p_to_status = 'approved' THEN\n[\s\S]*?RETURNING \* INTO v_case;/,
      "",
    );
    expect(withoutBranch).not.toBe(fix.body);
    expect(withoutBranch).toBe(prior.body);
  });

  it(`${FIX} replaces the one overload in place and keeps the E6.8 grants`, () => {
    const sql = stripSqlComments(read(FIX)).toLowerCase();
    expect(definitionsIn(FIX)).toHaveLength(1);
    expect(definitionsIn(FIX)[0].args).toBe(definitionsIn(PRIOR)[0].args);
    expect(sql).not.toContain("drop function");
    expect(sql).not.toContain("security definer");
    const signature =
      "public.set_case_status(\n  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid, boolean, boolean\n)";
    expect(sql).toContain(`revoke all on function ${signature} from public;`);
    expect(sql).toContain(`revoke all on function ${signature} from anon;`);
    expect(sql).toContain(`grant execute on function ${signature} to authenticated;`);
  });
});
