import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { caseStatusLabel } from "@/lib/caseStatus";

import {
  listOpenProviderCases,
  searchOrgCases,
  type OpenProviderCase,
  type ProviderCasesServiceCtx,
} from "./providerCases";

// The real supabase-js client over a stubbed fetch that answers like
// PostgREST from in-memory tables: eq / in filters, order, offset + limit,
// `Prefer: count=exact` → Content-Range, to-one embeds, and — like a real
// server — never more than MAX_ROWS rows per response however the request is
// ranged. Every request URL is recorded exactly as the client built it.
const MAX_ROWS = 1000;
const URL_LIMIT_BYTES = 8 * 1024;

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

// To-one embeds: target table → FK column on the parent row.
const FOREIGN_KEYS: Record<string, string> = { providers: "provider_id", payers: "payer_id" };

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function makeServer(
  tables: Tables,
  fail: (table: string, offset: number) => boolean = () => false,
) {
  const requests: Array<{ table: string; url: string; offset: number }> = [];

  async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split("/").pop() ?? "";
    const params = url.searchParams;
    const offset = Number(params.get("offset") ?? 0);
    requests.push({ table, url: url.href, offset });
    if (fail(table, offset)) {
      return new Response(JSON.stringify({ message: "page failed", code: "XX000" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    let rows = [...(tables[table] ?? [])];
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      const dot = raw.indexOf(".");
      const op = raw.slice(0, dot);
      const value = raw.slice(dot + 1);
      if (op === "eq") rows = rows.filter((r) => String(r[key]) === value);
      else if (op === "in") {
        const set = new Set(value.slice(1, -1).split(","));
        rows = rows.filter((r) => set.has(String(r[key])));
      } else throw new Error(`fake PostgREST: unsupported filter ${key}=${raw}`);
    }
    const order = (params.get("order") ?? "")
      .split(",")
      .filter(Boolean)
      .map((term) => ({ column: term.split(".")[0], desc: term.split(".")[1] === "desc" }));
    rows.sort((a, b) => {
      for (const { column, desc } of order) {
        const c = compare(a[column], b[column]);
        if (c !== 0) return desc ? -c : c;
      }
      return 0;
    });

    const limit = params.has("limit") ? Number(params.get("limit")) : Infinity;
    const page = rows.slice(offset, offset + Math.min(limit, MAX_ROWS));
    const embeds = [...(params.get("select") ?? "").matchAll(/(\w+)\(([^)]*)\)/g)];
    const data = page.map((row) => {
      const out: Row = { ...row };
      for (const [, embedTable, cols] of embeds) {
        const target = (tables[embedTable] ?? []).find(
          (r) => r.id === row[FOREIGN_KEYS[embedTable]],
        );
        out[embedTable] = target
          ? Object.fromEntries(cols.split(",").map((c) => [c, target[c] ?? null]))
          : null;
      }
      return out;
    });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (new Headers(init?.headers).get("prefer")?.includes("count=exact")) {
      headers["content-range"] = page.length
        ? `${offset}-${offset + page.length - 1}/${rows.length}`
        : `*/${rows.length}`;
    }
    return new Response(JSON.stringify(data), { status: 200, headers });
  }

  const db = createClient<Database>("https://example.supabase.co", "test-anon-key", {
    global: { fetch: serve },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { db: db as SupabaseClient<Database>, requests };
}

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ctxWith = (db: SupabaseClient<Database>): ProviderCasesServiceCtx => ({ db, orgId: ORG });
const pad = (n: number, width = 4) => String(n).padStart(width, "0");
const uuid = (prefix: number, n: number) => `0000000${prefix}-0000-4000-8000-${pad(n, 12)}`;

function caseRow(n: number, over: Row = {}): Row {
  return {
    id: `case-${pad(n)}`,
    org_id: ORG,
    case_number: 1000 + n,
    state: "KS",
    provider_id: "p-filler",
    payer_id: "payer-filler",
    facility_id: null,
    group_id: null,
    submitted_date: null,
    payer_reference_id: null,
    case_status: "in_progress",
    payer_pipeline_state: "drafting",
    ...over,
  };
}

const FILLER_PROVIDER = { id: "p-filler", org_id: ORG, first_name: "Filler", last_name: "Person" };
const FILLER_PAYER = { id: "payer-filler", org_id: null, name: "Filler Health" };
const fillerCases = (count: number, startAt = 1) =>
  Array.from({ length: count }, (_, i) => caseRow(startAt + i));

// The parent commit's search, verbatim over the fixture tables — the oracle:
// one substring check over "<first> <last> <payer> <ref>", or the case
// number containing the query's digits; sorted provider/payer/state. The
// parent then kept the first 50; the cut is now the caller's `limit`.
function parentMatches(tables: Tables, query: string) {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const caseDigitsQuery = /^(?:c-?)?(\d+)$/.exec(q)?.[1] ?? null;
  const rows = [];
  for (const row of tables.credential_cases.filter((c) => c.org_id === ORG)) {
    const p = tables.providers.find((r) => r.id === row.provider_id);
    const payer = tables.payers.find((r) => r.id === row.payer_id);
    const providerName = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
    const payerName = (payer?.name as string | undefined) ?? null;
    const ref = (row.payer_reference_id as string | null) ?? "";
    const caseNumber = (row.case_number as number | null) ?? null;
    const caseDigits = caseNumber != null ? String(caseNumber) : "";
    const haystack = `${providerName} ${payerName ?? ""} ${ref}`.toLowerCase();
    const matchesText = haystack.includes(q);
    const matchesCaseNumber =
      caseDigitsQuery != null && caseDigits !== "" && caseDigits.includes(caseDigitsQuery);
    if (!matchesText && !matchesCaseNumber) continue;
    rows.push({
      id: row.id,
      providerId: row.provider_id,
      providerName,
      payerName,
      state: String(row.state),
      status: row.case_status === "in_progress" ? caseStatusLabel("in_progress") : null,
      payerReferenceId: row.payer_reference_id,
      payerPipelineState: row.payer_pipeline_state ?? "not_started",
      caseNumber,
      facilityId: row.facility_id,
    });
  }
  rows.sort(
    (a, b) =>
      a.providerName.localeCompare(b.providerName) ||
      (a.payerName ?? "").localeCompare(b.payerName ?? "") ||
      a.state.localeCompare(b.state),
  );
  return rows;
}

// The platform default the route resolves (src/server/caseSearchLimit.ts),
// and the parent's fixed cut, which a platform admin may set again.
const DEFAULT_LIMIT = 5;
const PARENT_LIMIT = 50;

describe("searchOrgCases — the parent's matching, over a complete read", () => {
  const FIRST = ["Brooke", "Stan", "Mary Ann", "Addie", "Kyle", "Wendy"];
  const LAST = ["Ostrander", "Marsh", "Watson", "Jones", "Broflovski", "Testaburger"];
  const providers = Array.from({ length: 36 }, (_, i) => ({
    id: `p-${i}`,
    org_id: ORG,
    first_name: FIRST[i % 6],
    last_name: `${LAST[Math.floor(i / 6)]}${i}`,
  }));
  const payers = [
    { id: "pay-bcbs", org_id: null, name: "BCBS of Kansas" },
    { id: "pay-humana", org_id: ORG, name: "Humana" },
    { id: "pay-cigna", org_id: null, name: "Cigna" },
  ];
  const cases = Array.from({ length: 140 }, (_, i) =>
    caseRow(i + 1, {
      provider_id: `p-${i % 36}`,
      payer_id: payers[i % 3].id,
      state: ["KS", "MO", "TX"][i % 3],
      payer_reference_id: i % 7 === 0 ? `REF-${i}-X` : null,
      case_status: i % 5 === 0 ? null : "in_progress",
      payer_pipeline_state: i % 4 === 0 ? null : "drafting",
      facility_id: i % 2 === 0 ? `fac-${i}` : null,
    }),
  );
  cases.push(caseRow(900, { org_id: OTHER_ORG, provider_id: "p-0", payer_id: "pay-bcbs" }));
  const tables: Tables = { credential_cases: cases, providers, payers };

  const queries = [
    "brooke",
    "BROOKE",
    "ostrander0 bcbs",
    "ann watson",
    "a",
    "humana",
    "of kansas",
    "ref-14",
    "C-1001",
    "c1012",
    "100",
    "001",
    "cigna",
    "nobody",
    "   ",
  ];
  const queryLimits: Array<[string, number]> = queries.flatMap((q) =>
    [DEFAULT_LIMIT, PARENT_LIMIT].map((limit): [string, number] => [q, limit]),
  );
  it.each(queryLimits)(
    "returns the parent's rows and order for %j, cut at limit %i",
    async (q, limit) => {
      const { db } = makeServer(tables);
      const expected = parentMatches(tables, q);
      expect(await searchOrgCases(ctxWith(db), q, limit)).toEqual({
        rows: expected.slice(0, limit),
        total: expected.length,
        truncated: expected.length > limit,
      });
    },
  );

  it('matches a query that spans provider and payer, like "ostrander bcbs"', async () => {
    const { db } = makeServer({
      credential_cases: [caseRow(1, { provider_id: "p-b", payer_id: "pay-bcbs" })],
      providers: [{ id: "p-b", org_id: ORG, first_name: "Brooke", last_name: "Ostrander" }],
      payers,
    });
    const result = await searchOrgCases(ctxWith(db), "ostrander bcbs", DEFAULT_LIMIT);
    expect(result.rows.map((r) => r.id)).toEqual(["case-0001"]);
    expect(result).toMatchObject({ total: 1, truncated: false });
  });

  it("treats PostgREST and LIKE syntax characters as literal text", async () => {
    const { db } = makeServer({
      credential_cases: [caseRow(1, { payer_reference_id: 'A,B(1).x%_*"q\\z' }), caseRow(2)],
      providers: [FILLER_PROVIDER],
      payers: [FILLER_PAYER],
    });
    const ids = async (q: string) =>
      (await searchOrgCases(ctxWith(db), q, DEFAULT_LIMIT)).rows.map((r) => r.id);
    expect(await ids('a,b(1).x%_*"q\\z')).toEqual(["case-0001"]);
    expect(await ids("%")).toEqual(["case-0001"]);
    expect(await ids("smith, (john)")).toEqual([]);
  });

  it("returns an empty, complete answer for a blank query without any request", async () => {
    const { db, requests } = makeServer(tables);
    expect(await searchOrgCases(ctxWith(db), "   ", DEFAULT_LIMIT)).toEqual({
      rows: [],
      total: 0,
      truncated: false,
    });
    expect(requests).toHaveLength(0);
  });
});

describe("searchOrgCases — past the max-rows cap", () => {
  it("finds a match that sits past the first 1,000 org cases", async () => {
    const { db, requests } = makeServer({
      credential_cases: [
        ...fillerCases(1149),
        caseRow(1150, { provider_id: "p-brooke" }),
        ...fillerCases(50, 1151),
      ],
      providers: [
        FILLER_PROVIDER,
        { id: "p-brooke", org_id: ORG, first_name: "Brooke", last_name: "Ostrander" },
      ],
      payers: [FILLER_PAYER],
    });

    const result = await searchOrgCases(ctxWith(db), "brooke", DEFAULT_LIMIT);

    expect(result.rows.map((r) => r.id)).toEqual(["case-1150"]);
    expect(result).toMatchObject({ total: 1, truncated: false });
    // Ranged pages with an id tiebreak, all org-scoped.
    expect(requests.map((r) => r.offset)).toEqual([0, 500, 1000]);
    for (const { url } of requests) {
      expect(url).toContain("org_id=eq.org-1");
      expect(url).toContain("order=id.asc");
    }
  });

  it("returns the first `limit` matches across the whole org, flags truncated, and counts every match", async () => {
    // 1,200 matching cases; the alphabetically-first providers are stored last.
    const providers = Array.from({ length: 1200 }, (_, i) => ({
      id: `p-${i}`,
      org_id: ORG,
      first_name: "Brooke",
      last_name: `Z${pad(1199 - i)}`,
    }));
    const { db } = makeServer({
      credential_cases: [
        ...fillerCases(300, 1201),
        ...providers.map((p, i) => caseRow(i + 1, { provider_id: p.id })),
      ],
      providers: [FILLER_PROVIDER, ...providers],
      payers: [FILLER_PAYER],
    });

    const result = await searchOrgCases(ctxWith(db), "brooke", DEFAULT_LIMIT);

    expect(result).toMatchObject({ total: 1200, truncated: true });
    expect(result.rows.map((r) => r.providerName)).toEqual([
      "Brooke Z0000",
      "Brooke Z0001",
      "Brooke Z0002",
      "Brooke Z0003",
      "Brooke Z0004",
    ]);

    // A platform admin can raise the limit; the same read then answers more.
    const raised = await searchOrgCases(ctxWith(db), "brooke", PARENT_LIMIT);
    expect(raised).toMatchObject({ total: 1200, truncated: true });
    expect(raised.rows).toHaveLength(PARENT_LIMIT);
    expect(raised.rows[PARENT_LIMIT - 1].providerName).toBe("Brooke Z0049");
  });

  it("is truncated one match past the limit and not at exactly the limit", async () => {
    const { db } = makeServer({
      credential_cases: [
        ...Array.from({ length: DEFAULT_LIMIT + 1 }, (_, i) =>
          caseRow(i + 1, { payer_reference_id: `REF-${i}` }),
        ),
        ...fillerCases(10, 100),
      ],
      providers: [FILLER_PROVIDER],
      payers: [FILLER_PAYER],
    });
    const atLimit = await searchOrgCases(ctxWith(db), "ref-", DEFAULT_LIMIT + 1);
    expect(atLimit.rows).toHaveLength(DEFAULT_LIMIT + 1);
    expect(atLimit).toMatchObject({ total: DEFAULT_LIMIT + 1, truncated: false });

    const past = await searchOrgCases(ctxWith(db), "ref-", DEFAULT_LIMIT);
    expect(past.rows).toHaveLength(DEFAULT_LIMIT);
    expect(past).toMatchObject({ total: DEFAULT_LIMIT + 1, truncated: true });
  });

  it("fails the search when a middle page fails, rather than answering from part of the org", async () => {
    const { db } = makeServer(
      { credential_cases: fillerCases(1250), providers: [FILLER_PROVIDER], payers: [FILLER_PAYER] },
      (table, offset) => table === "credential_cases" && offset === 500,
    );
    await expect(searchOrgCases(ctxWith(db), "filler", DEFAULT_LIMIT)).rejects.toMatchObject({
      message: "page failed",
    });
  });
});

describe("listOpenProviderCases — complete and URL-bounded", () => {
  const PROVIDER_ID = "99999999-8888-4777-8666-121212121212";

  // Every ninth case is approved (terminal), the rest open.
  function providerTables(caseCount: number, extra: Partial<Tables> = {}): Tables {
    return {
      providers: [{ id: PROVIDER_ID, org_id: ORG, first_name: "P", last_name: "Q" }],
      credential_cases: Array.from({ length: caseCount }, (_, i) =>
        caseRow(i + 1, {
          id: uuid(1, i + 1),
          provider_id: PROVIDER_ID,
          state: `S${pad(i)}`,
          case_status: i % 9 === 0 ? "approved" : "in_progress",
        }),
      ),
      payers: [FILLER_PAYER],
      touches: [],
      tasks: [],
      profiles: [],
      ...extra,
    };
  }

  // The parent's derivation with no cap and no chunking: every touch for the
  // open cases newest-first, every task in id order, authors resolved at once.
  function unchunked(tables: Tables): OpenProviderCase[] {
    const open = tables.credential_cases.filter((c) => c.case_status !== "approved");
    const openIds = new Set(open.map((c) => c.id));
    const touches = tables.touches
      .filter((t) => openIds.has(t.case_id))
      .sort((a, b) => -compare(a.created_at, b.created_at) || compare(a.id, b.id));
    const tasks = tables.tasks
      .filter((t) => openIds.has(t.case_id))
      .sort((a, b) => compare(a.id, b.id));
    const author = (id: unknown) => {
      const p = tables.profiles.find((r) => r.id === id);
      return p ? ((p.full_name ?? p.email) as string | null) : null;
    };
    return open
      .map((c) => {
        const note = touches.find((t) => t.case_id === c.id && t.entry_type === "note");
        const submitted = touches.find((t) => t.case_id === c.id && t.outcome === "submitted");
        return {
          id: c.id as string,
          payerName: FILLER_PAYER.name,
          state: c.state as string,
          status: "In Progress",
          submittedDate: null,
          payerReferenceId: null,
          latestNote: note
            ? {
                text: note.notes as string,
                author: note.coordinator_id ? author(note.coordinator_id) : null,
                at: note.created_at as string,
              }
            : null,
          lastSubmittedAt: (submitted?.created_at as string | undefined) ?? null,
          portalTasks: tasks
            .filter((t) => t.case_id === c.id && t.status !== "completed")
            .map((t) => ({
              taskId: t.id as string,
              title: t.title as string,
              portalKey: "availity",
              status: t.status as string,
            })),
        };
      })
      .sort((a, b) => a.state.localeCompare(b.state));
  }

  it("returns every open case across pages, with an exact count and id tiebreak", async () => {
    const { db, requests } = makeServer(providerTables(1250));
    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    expect(result).toHaveLength(1250 - Math.ceil(1250 / 9));
    const casePages = requests.filter((r) => r.table === "credential_cases");
    expect(casePages.map((r) => r.offset)).toEqual([0, 500, 1000]);
    expect(casePages[0].url).toContain("order=id.asc");
  });

  it("keeps every request URL under 8 KB with 1,250 open cases, matching the unchunked logic", async () => {
    const base = providerTables(1407); // 157 approved + 1,250 open
    const touches: Row[] = [];
    const tasks: Row[] = [];
    const profiles: Row[] = [];
    base.credential_cases.forEach((c, i) => {
      const by = uuid(3, i % 300);
      touches.push(
        {
          id: uuid(2, 2 * i),
          org_id: ORG,
          case_id: c.id,
          entry_type: "note",
          outcome: null,
          notes: `older ${i}`,
          coordinator_id: by,
          created_at: `2026-01-${pad((i % 27) + 1, 2)}T00:00:00Z`,
        },
        {
          id: uuid(2, 2 * i + 1),
          org_id: ORG,
          case_id: c.id,
          entry_type: "note",
          outcome: i % 2 === 0 ? "submitted" : null,
          notes: `newest ${i}`,
          coordinator_id: i % 3 === 0 ? null : by,
          created_at: `2026-02-${pad((i % 27) + 1, 2)}T00:00:00Z`,
        },
      );
      tasks.push({
        id: uuid(4, i),
        org_id: ORG,
        case_id: c.id,
        title: `Task ${i}`,
        status: i % 4 === 0 ? "completed" : "in_progress",
        sop_content: [{ portalKey: "Availity" }],
      });
    });
    for (let a = 0; a < 300; a++) {
      profiles.push({ id: uuid(3, a), full_name: a % 2 ? `Person ${a}` : null, email: `p${a}@x` });
    }
    const tables = { ...base, touches, tasks, profiles };
    const { db, requests } = makeServer(tables);

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    const longest = Math.max(...requests.map((r) => new TextEncoder().encode(r.url).length));
    expect(longest).toBeLessThan(URL_LIMIT_BYTES);
    expect(result).toHaveLength(1250);
    expect(result).toEqual(unchunked(tables));
    expect(requests.filter((r) => r.table === "touches").length).toBeGreaterThanOrEqual(13);
  });

  it("finds the latest note past the first 1,000 touchlog rows", async () => {
    const touches: Row[] = Array.from({ length: 1100 }, (_, i) => ({
      id: `t-${pad(i)}`,
      org_id: ORG,
      case_id: uuid(1, 2),
      entry_type: "touch",
      outcome: null,
      notes: null,
      coordinator_id: null,
      created_at: `2026-10-${pad(1 + (i % 28), 2)}T00:00:00Z`,
    }));
    touches.push({
      id: "t-note",
      org_id: ORG,
      case_id: uuid(1, 3),
      entry_type: "note",
      outcome: "submitted",
      notes: "waiting on payer",
      coordinator_id: null,
      created_at: "2026-01-01T00:00:00Z",
    });
    const { db } = makeServer(providerTables(3, { touches }));

    const result = await listOpenProviderCases(ctxWith(db), PROVIDER_ID);

    const third = result?.find((r) => r.id === uuid(1, 3));
    expect(third?.latestNote).toEqual({
      text: "waiting on payer",
      author: null,
      at: "2026-01-01T00:00:00Z",
    });
    expect(third?.lastSubmittedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("fails the read when a middle case page fails, rather than returning a partial list", async () => {
    const { db } = makeServer(
      providerTables(1250),
      (table, offset) => table === "credential_cases" && offset === 500,
    );
    await expect(listOpenProviderCases(ctxWith(db), PROVIDER_ID)).rejects.toMatchObject({
      message: "page failed",
    });
  });

  it("fails the read when a touchlog request fails", async () => {
    const { db } = makeServer(providerTables(3), (table) => table === "touches");
    await expect(listOpenProviderCases(ctxWith(db), PROVIDER_ID)).rejects.toMatchObject({
      message: "page failed",
    });
  });
});
