// MINT-82 Part 2 — an in-memory PostgREST stand-in for the Luna-scale paging
// harness (e2e/luna-scale-paging.spec.ts). It serves fixture tables the way
// hosted Supabase does where completeness is concerned:
//   * db-max-rows = 1000: an unranged read, or a range wider than 1000,
//     returns at most 1000 rows and says nothing about the rest;
//   * offset/limit query params and a Range header both select a window;
//   * Prefer: count=exact answers Content-Range: <from>-<to>/<total>;
//   * Accept: vnd.pgrst.object returns one object, or 406 PGRST116.
// Every read is logged, and a read the cap cut short with no follow-up page is
// flagged `capped`: that is a silent stop at 1,000.
import type { Route } from "@playwright/test";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const MAX_ROWS = 1000;

export interface ReadLog {
  table: string;
  signature: string;
  offset: number;
  limit: number | null;
  returned: number;
  total: number;
  counted: boolean;
}

// child.column -> parent table, for embeds. Only what the served screens use.
const FOREIGN_KEYS: ReadonlyArray<[string, string, string]> = [
  ["memberships", "org_id", "organizations"],
  ["memberships", "user_id", "profiles"],
  ["facilities", "group_id", "provider_groups"],
  ["providers", "group_id", "provider_groups"],
  ["provider_group_assignments", "provider_id", "providers"],
  ["provider_group_assignments", "group_id", "provider_groups"],
  ["provider_facility_assignments", "provider_id", "providers"],
  ["provider_facility_assignments", "facility_id", "facilities"],
  ["state_licenses", "provider_id", "providers"],
  ["payer_network_targets", "payer_id", "payers"],
  ["payer_network_targets", "group_id", "provider_groups"],
  ["org_payer_assignments", "payer_id", "payers"],
  ["credential_cases", "provider_id", "providers"],
  ["credential_cases", "payer_id", "payers"],
  ["credential_cases", "group_id", "provider_groups"],
  ["credential_cases", "facility_id", "facilities"],
  ["case_facilities", "case_id", "credential_cases"],
  ["case_facilities", "facility_id", "facilities"],
  ["tasks", "case_id", "credential_cases"],
  ["tasks", "provider_id", "providers"],
  ["touches", "case_id", "credential_cases"],
  ["touches", "task_id", "tasks"],
  ["case_status_history", "case_id", "credential_cases"],
  ["enrollment_facts", "provider_id", "providers"],
  ["enrollment_facts", "payer_id", "payers"],
  ["enrollment_facts", "group_id", "provider_groups"],
];

interface SelectNode {
  columns: string[] | "*";
  embeds: EmbedNode[];
}

interface EmbedNode extends SelectNode {
  alias: string;
  table: string;
  hint: string | null;
  inner: boolean;
}

function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === separator) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function parseSelect(select: string | null): SelectNode {
  const node: SelectNode = { columns: [], embeds: [] };
  if (!select) return { columns: "*", embeds: [] };
  for (const item of splitTopLevel(select)) {
    const open = item.indexOf("(");
    if (open >= 0) {
      const head = item.slice(0, open);
      const body = item.slice(open + 1, item.lastIndexOf(")"));
      const [aliasPart, relPart] = head.includes(":") ? head.split(":") : [null, head];
      const [table, ...modifiers] = relPart.split("!");
      const inner = modifiers.includes("inner");
      const hint = modifiers.find((m) => m !== "inner" && m !== "left") ?? null;
      const sub = parseSelect(body);
      node.embeds.push({ ...sub, alias: aliasPart ?? table, table, hint, inner });
    } else if (item === "*") {
      node.columns = "*";
    } else if (node.columns !== "*") {
      const name = item.includes(":") ? item.split(":")[1] : item;
      node.columns.push(name.split("::")[0].trim());
    }
  }
  return node;
}

function parseList(raw: string): string[] {
  const inner = raw.replace(/^[({]/, "").replace(/[)}]$/, "");
  return splitTopLevel(inner).map((value) => value.replace(/^"|"$/g, ""));
}

function likeToRegex(pattern: string, insensitive: boolean): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[%*]/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, insensitive ? "is" : "s");
}

/** Byte order, which is what ISO dates, timestamps and uuids need. */
function compare(a: unknown, b: string): number {
  if (typeof a === "number") return a - Number(b);
  const text = String(a);
  return text < b ? -1 : text > b ? 1 : 0;
}

/** One PostgREST condition, e.g. `eq.CO`, `not.is.null`, `in.(a,b)`. */
export function matchCondition(value: unknown, condition: string): boolean {
  if (condition.startsWith("not.")) {
    const inner = condition.slice(4);
    // SQL: NOT (NULL op x) is NULL, so a null never passes a negated
    // comparison; only `not.is.*` tests nullness itself.
    if (!inner.startsWith("is.") && (value === null || value === undefined)) return false;
    return !matchCondition(value, inner);
  }
  const dot = condition.indexOf(".");
  const op = condition.slice(0, dot);
  const operand = condition.slice(dot + 1);
  switch (op) {
    case "eq":
      return value !== null && value !== undefined && String(value) === operand;
    case "neq":
      return value !== null && value !== undefined && String(value) !== operand;
    case "is":
      if (operand === "null") return value === null || value === undefined;
      if (operand === "true") return value === true;
      if (operand === "false") return value === false;
      return false;
    case "in":
      return value !== null && value !== undefined && parseList(operand).includes(String(value));
    case "gt":
      return value !== null && value !== undefined && compare(value, operand) > 0;
    case "gte":
      return value !== null && value !== undefined && compare(value, operand) >= 0;
    case "lt":
      return value !== null && value !== undefined && compare(value, operand) < 0;
    case "lte":
      return value !== null && value !== undefined && compare(value, operand) <= 0;
    case "like":
    case "ilike":
      return (
        value !== null &&
        value !== undefined &&
        likeToRegex(operand, op === "ilike").test(String(value))
      );
    case "cs":
      return (
        Array.isArray(value) && parseList(operand).every((item) => value.map(String).includes(item))
      );
    case "ov":
      return (
        Array.isArray(value) && parseList(operand).some((item) => value.map(String).includes(item))
      );
    default:
      throw new Error(`luna-scale PostgREST stand-in: unsupported operator ${op}`);
  }
}

/** `or=(a.eq.1,and(b.is.null,c.gte.2))` */
function matchLogic(row: Row, expression: string, mode: "or" | "and"): boolean {
  const terms = splitTopLevel(expression.replace(/^\(/, "").replace(/\)$/, ""));
  const results = terms.map((term) => {
    if (term.startsWith("or(")) return matchLogic(row, term.slice(2), "or");
    if (term.startsWith("and(")) return matchLogic(row, term.slice(3), "and");
    const dot = term.indexOf(".");
    return matchCondition(row[term.slice(0, dot)], term.slice(dot + 1));
  });
  return mode === "or" ? results.some(Boolean) : results.every(Boolean);
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

export class PostgrestStandIn {
  readonly reads: ReadLog[] = [];
  readonly writes: { table: string; method: string }[] = [];
  readonly rpcs: string[] = [];
  private readonly indexes = new Map<string, Map<string, Row[]>>();
  private inFlight = 0;
  lastActivityAt = 0;

  constructor(
    readonly tables: Tables,
    private readonly rpcHandlers: Record<string, (body: unknown) => unknown> = {},
  ) {}

  get busy(): boolean {
    return this.inFlight > 0;
  }

  private index(table: string, column: string): Map<string, Row[]> {
    const key = `${table}.${column}`;
    let map = this.indexes.get(key);
    if (!map) {
      map = new Map();
      for (const row of this.tables[table] ?? []) {
        const value = String(row[column]);
        const list = map.get(value);
        if (list) list.push(row);
        else map.set(value, [row]);
      }
      this.indexes.set(key, map);
    }
    return map;
  }

  private resolveEmbed(base: string, row: Row, embed: EmbedNode): Row | Row[] | null {
    const manyToOne = FOREIGN_KEYS.find(
      ([child, column, parent]) =>
        child === base && parent === embed.table && (!embed.hint || embed.hint === column),
    );
    if (manyToOne || (embed.table === "organizations" && "org_id" in row)) {
      const column = manyToOne ? manyToOne[1] : "org_id";
      const target = this.index(embed.table, "id").get(String(row[column]))?.[0] ?? null;
      return target ? this.project(embed.table, target, embed) : null;
    }
    const oneToMany = FOREIGN_KEYS.find(
      ([child, , parent]) => child === embed.table && parent === base,
    );
    if (oneToMany) {
      const children = this.index(embed.table, oneToMany[1]).get(String(row.id)) ?? [];
      return children.map((child) => this.project(embed.table, child, embed));
    }
    throw new Error(`luna-scale PostgREST stand-in: no relationship ${base} -> ${embed.table}`);
  }

  private project(table: string, row: Row, node: SelectNode): Row {
    const out: Row = node.columns === "*" ? { ...row } : {};
    if (node.columns !== "*") {
      for (const column of node.columns) out[column] = row[column] ?? null;
    }
    for (const embed of node.embeds) out[embed.alias] = this.resolveEmbed(table, row, embed);
    return out;
  }

  /** Answer one REST request. Returns the fulfil payload. */
  handle(
    method: string,
    url: URL,
    headers: Record<string, string>,
    postData: string | null,
  ): { status: number; headers: Record<string, string>; body: unknown } {
    const path = url.pathname.split("/rest/v1/")[1] ?? "";
    if (path.startsWith("rpc/")) {
      const name = path.slice(4);
      this.rpcs.push(name);
      const handler = this.rpcHandlers[name];
      let body: unknown = null;
      try {
        body = postData ? JSON.parse(postData) : null;
      } catch {
        body = null;
      }
      return { status: 200, headers: {}, body: handler ? handler(body) : [] };
    }
    const table = path;
    if (method !== "GET" && method !== "HEAD") {
      this.writes.push({ table, method });
      return { status: 201, headers: {}, body: [] };
    }
    const select = parseSelect(url.searchParams.get("select"));
    const embedFilters = new Map<string, Array<[string, string]>>();
    let rows = this.tables[table] ?? [];
    for (const [key, raw] of url.searchParams.entries()) {
      if (
        RESERVED.has(key) ||
        key.endsWith(".order") ||
        key.endsWith(".limit") ||
        key.endsWith(".offset")
      )
        continue;
      if (key === "or" || key === "and") {
        rows = rows.filter((row) => matchLogic(row, raw, key));
        continue;
      }
      if (key.includes(".")) {
        const [embed, column] = key.split(".");
        embedFilters.set(embed, [...(embedFilters.get(embed) ?? []), [column, raw]]);
        continue;
      }
      rows = rows.filter((row) => matchCondition(row[key], raw));
    }
    let projected = rows.map((row) => this.project(table, row, select));
    for (const embed of select.embeds) {
      const filters = embedFilters.get(embed.alias) ?? embedFilters.get(embed.table) ?? [];
      if (filters.length === 0 && !embed.inner) continue;
      projected = projected.flatMap((row) => {
        const value = row[embed.alias];
        const keep = (child: unknown) =>
          child !== null &&
          typeof child === "object" &&
          filters.every(([column, condition]) => matchCondition((child as Row)[column], condition));
        if (Array.isArray(value)) {
          const kept = value.filter(keep);
          if (embed.inner && kept.length === 0) return [];
          return [{ ...row, [embed.alias]: kept }];
        }
        if (!keep(value)) return embed.inner ? [] : [{ ...row, [embed.alias]: null }];
        return [row];
      });
    }
    const order = url.searchParams.get("order");
    if (order) {
      const keys = splitTopLevel(order).map((term) => {
        const [column, ...flags] = term.split(".");
        const desc = flags.includes("desc");
        const nullsFirst = flags.includes("nullsfirst") || (desc && !flags.includes("nullslast"));
        return { column, desc, nullsFirst };
      });
      projected = [...projected].sort((a, b) => {
        for (const { column, desc, nullsFirst } of keys) {
          const av = a[column];
          const bv = b[column];
          const aNull = av === null || av === undefined;
          const bNull = bv === null || bv === undefined;
          if (aNull || bNull) {
            if (aNull && bNull) continue;
            return aNull === nullsFirst ? -1 : 1;
          }
          const result =
            typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av) < String(bv)
                ? -1
                : String(av) > String(bv)
                  ? 1
                  : 0;
          if (result !== 0) return desc ? -result : result;
        }
        return 0;
      });
    }

    const total = projected.length;
    let offset = Number(url.searchParams.get("offset") ?? 0);
    let limit: number | null = url.searchParams.has("limit")
      ? Number(url.searchParams.get("limit"))
      : null;
    const range = /^(\d+)-(\d*)$/.exec(headers["range"] ?? "");
    if (range) {
      offset = Number(range[1]);
      if (range[2]) limit = Number(range[2]) - offset + 1;
    }
    const effective = Math.min(limit ?? MAX_ROWS, MAX_ROWS);
    const window = projected.slice(offset, offset + effective);
    const counted = /count=(exact|planned|estimated)/.test(headers["prefer"] ?? "");
    this.reads.push({
      table,
      signature: [...url.searchParams.entries()]
        .filter(([key]) => !["offset", "limit", "select"].includes(key))
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join("&"),
      offset,
      limit,
      returned: window.length,
      total,
      counted,
    });
    const contentRange = `${window.length === 0 ? "*" : `${offset}-${offset + window.length - 1}`}/${counted ? total : "*"}`;
    const wantsObject = (headers["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (window.length !== 1) {
        return {
          status: 406,
          headers: {},
          body: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
        };
      }
      return { status: 200, headers: { "content-range": contentRange }, body: window[0] };
    }
    return {
      status: 200,
      headers: { "content-range": contentRange },
      body: method === "HEAD" ? null : window,
    };
  }

  async route(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    this.inFlight += 1;
    this.lastActivityAt = Date.now();
    try {
      const result = this.handle(request.method(), url, request.headers(), request.postData());
      await route.fulfill({
        status: result.status,
        contentType: "application/json",
        headers: { ...result.headers, "access-control-expose-headers": "content-range" },
        body: result.body === null ? "" : JSON.stringify(result.body),
      });
    } finally {
      this.inFlight -= 1;
      this.lastActivityAt = Date.now();
    }
  }

  /** Reads the 1,000-row cap cut short, with no later page of the same query
   * reaching past row 1,000: the silent stops. */
  cappedReads(): Array<{ table: string; signature: string; returned: number; total: number }> {
    const out = new Map<
      string,
      { table: string; signature: string; returned: number; total: number }
    >();
    for (const read of this.reads) {
      const key = `${read.table}?${read.signature}`;
      const reachedPastCap = this.reads.some(
        (other) =>
          other.table === read.table &&
          other.signature === read.signature &&
          other.offset >= MAX_ROWS,
      );
      const cut =
        read.returned === MAX_ROWS &&
        read.total > MAX_ROWS &&
        (read.limit === null || read.limit > MAX_ROWS);
      if (cut && !reachedPastCap)
        out.set(key, {
          table: read.table,
          signature: read.signature,
          returned: read.returned,
          total: read.total,
        });
    }
    return [...out.values()];
  }

  /** Queries that paged past row 1,000 to completion. */
  completedPagedReads(): Array<{ table: string; pages: number; total: number }> {
    const groups = new Map<string, ReadLog[]>();
    for (const read of this.reads) {
      if (read.limit === null || read.total <= MAX_ROWS) continue;
      const key = `${read.table}?${read.signature}`;
      groups.set(key, [...(groups.get(key) ?? []), read]);
    }
    return [...groups.values()]
      .filter((list) => list.some((read) => read.offset + read.returned >= read.total))
      .map((list) => ({ table: list[0].table, pages: list.length, total: list[0].total }));
  }

  reset(): void {
    this.reads.length = 0;
    this.writes.length = 0;
    this.rpcs.length = 0;
  }
}
