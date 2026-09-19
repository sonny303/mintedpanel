// Minimal PostgREST transport for the real Supabase client. All query filters
// originate in the production service; this adapter only translates eq/is/in
// and executes them in PostgreSQL. It is not a hosted PostgREST or RLS test.
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types";

const execAsync = promisify(execFile);
const context = process.env.P03_DOCKER_CONTEXT;
const container = process.env.P03_OWNED_CONTAINER;
const runId = process.env.P03_RUN_ID;
if (!context || !runId || !/^[a-f0-9-]{36}$/.test(runId) || container !== `minted-p03-${runId}`)
  throw new Error("Run only through scripts/security/verify-license-races.mjs");
const inspect = JSON.parse(
  execFileSync("docker", ["--context", context, "inspect", container], { encoding: "utf8" }),
)[0];
if (
  inspect?.Config?.Labels?.["com.minted.p03"] !== runId ||
  inspect?.HostConfig?.NetworkMode !== "none" ||
  inspect?.HostConfig?.ReadonlyRootfs !== true ||
  inspect?.Mounts?.some((mount: { Type: string }) => mount.Type !== "tmpfs")
)
  throw new Error("P03 owned isolated container required");

const dockerArgs = ["--context", context, "exec", "-i", container];
const psqlArgs = [
  "psql",
  "-XqAt",
  "-h",
  "/tmp",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
];
const identifier = (name: string) => {
  if (!/^[a-z_][a-z_0-9]*$/.test(name)) throw new Error("Unsupported SQL identifier");
  return `"${name}"`;
};
export const literal = (value: unknown): string => {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") throw new Error("Unsupported SQL value");
  return `'${value.replaceAll("'", "''")}'`;
};

export async function sql(statement: string, appName = "p03_observer"): Promise<string> {
  const { stdout } = await execAsync(
    "docker",
    [
      ...dockerArgs,
      ...psqlArgs,
      "-c",
      `SET application_name = ${literal(appName)}; SET default_transaction_isolation = 'read committed'; ${statement}`,
    ],
    { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

export async function storedRows(): Promise<Record<string, unknown>[]> {
  return JSON.parse(
    await sql(
      "SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.id), '[]'::json) FROM state_licenses r;",
    ),
  );
}

/** One persistent connection lets writer B hold an uncommitted row lock. */
export class WriterSession {
  private process = spawn("docker", [...dockerArgs, ...psqlArgs], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  private pending: {
    marker: string;
    resolve: (output: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private output = "";

  constructor() {
    this.process.stdout.on("data", (chunk: Buffer) => {
      this.output += chunk.toString();
      if (this.pending && this.output.includes(`${this.pending.marker}\n`)) {
        const { marker, resolve, timer } = this.pending;
        clearTimeout(timer);
        this.pending = null;
        const result = this.output.slice(0, this.output.indexOf(marker)).trim();
        this.output = this.output.slice(this.output.indexOf(marker) + marker.length + 1);
        resolve(result);
      }
    });
    this.process.stderr.on("data", (chunk: Buffer) => {
      if (/ERROR|FATAL/.test(chunk.toString())) this.fail("P03 writer SQL failed");
    });
    this.process.on("error", () => this.fail("P03 writer process failed"));
    this.process.on("exit", () => this.fail("P03 writer process exited early"));
  }

  private fail(message: string) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(new Error(message));
    this.pending = null;
  }

  query(statement: string): Promise<string> {
    if (this.pending) throw new Error("P03 writer already has a pending query");
    const marker = `p03_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail("P03 writer query timed out"), 10_000);
      this.pending = { marker, resolve, reject, timer };
      this.process.stdin.write(`${statement}\nSELECT ${literal(marker)};\n`);
    });
  }

  async close() {
    if (this.process.exitCode !== null) return;
    try {
      await this.query("ROLLBACK;");
    } finally {
      this.process.stdin.end("\\q\n");
    }
  }
}

export interface SqlRequest {
  table: string;
  method: string;
  url: URL;
  statement: string;
  resultRowCount?: number;
}

export class LicenseSqlBridge {
  readonly requests: SqlRequest[] = [];
  beforeMutation?: (request: SqlRequest) => Promise<void>;
  afterMutationStarted?: (request: SqlRequest) => Promise<void>;
  readonly client = createClient<Database>("http://p03.invalid", "synthetic-only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => this.fetch(input, init) },
  });

  private async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (url.origin !== "http://p03.invalid") throw new Error("P03 refuses external requests");
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    if (!["providers", "state_licenses"].includes(table))
      throw new Error(`P03 unsupported table: ${table}`);
    const method = init?.method || "GET";
    const params = url.searchParams;
    const select = params.get("select") || "*";
    const columns = select === "*" ? "*" : select.split(",").map(identifier).join(", ");
    const predicates: string[] = [];
    for (const [column, filter] of params) {
      if (column === "select" || column === "columns") continue;
      const name = identifier(column);
      if (filter.startsWith("eq.")) predicates.push(`${name} = ${literal(filter.slice(3))}`);
      else if (filter === "is.null") predicates.push(`${name} IS NULL`);
      else if (/^in\.\([a-f0-9,"-]+\)$/.test(filter))
        predicates.push(
          `${name} IN (${filter
            .slice(4, -1)
            .split(",")
            .map((value) => literal(value.replaceAll('"', "")))
            .join(", ")})`,
        );
      else throw new Error(`P03 unsupported filter: ${column}=${filter}`);
    }
    const where = predicates.length ? ` WHERE ${predicates.join(" AND ")}` : "";
    const target = `public.${identifier(table)}`;
    let statement: string;
    if (method === "GET") {
      statement = `SELECT ${columns} FROM ${target}${where}`;
    } else if (method === "DELETE") {
      statement = `DELETE FROM ${target}${where} RETURNING ${columns}`;
    } else {
      if (typeof init?.body !== "string") throw new Error("P03 requires JSON request body");
      const parsed: unknown = JSON.parse(init.body);
      if (method === "PATCH" && !Array.isArray(parsed) && parsed && typeof parsed === "object") {
        const updates = Object.entries(parsed).map(
          ([key, value]) => `${identifier(key)} = ${literal(value)}`,
        );
        if (!updates.length) throw new Error("P03 unexpected empty PATCH");
        statement = `UPDATE ${target} SET ${updates.join(", ")}${where} RETURNING ${columns}`;
      } else if (method === "POST") {
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        if (!rows.length || !rows.every((r) => r && typeof r === "object" && !Array.isArray(r)))
          throw new Error("P03 invalid INSERT");
        const keys = Object.keys(rows[0]);
        if (rows.some((row) => Object.keys(row).join() !== keys.join()))
          throw new Error("P03 inconsistent INSERT columns");
        const values = rows.map((row) => `(${keys.map((key) => literal(row[key])).join(", ")})`);
        statement = `INSERT INTO ${target} (${keys.map(identifier).join(", ")}) VALUES ${values.join(", ")} RETURNING ${columns}`;
      } else throw new Error(`P03 unsupported method: ${method}`);
    }
    const request: SqlRequest = { table, method, url, statement };
    this.requests.push(request);
    const mutation = method !== "GET";
    if (mutation) await this.beforeMutation?.(request);
    const query = sql(
      `WITH result AS (${statement}) SELECT coalesce(json_agg(result), '[]'::json) FROM result;`,
      mutation ? "p03_mutation" : "p03_service_read",
    );
    // Attach an immediate rejection handler while the second session is driven.
    // Preserve the rejection on await below rather than creating an unhandled one.
    query.catch(() => undefined);
    if (mutation) await this.afterMutationStarted?.(request);
    const rows: unknown[] = JSON.parse(await query);
    request.resultRowCount = rows.length;
    const single = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object+json");
    if (single && rows.length !== 1)
      return Response.json(
        { code: "PGRST116", message: "Expected exactly one row", details: `${rows.length} rows` },
        { status: 406 },
      );
    return Response.json(single ? rows[0] : rows);
  }
}

export async function waitForBlockedMutation(): Promise<void> {
  const deadline = Date.now() + 10_000;
  do {
    const blocked = await sql(
      "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'p03_mutation' AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0;",
    );
    if (blocked === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error("P03 did not observe the production mutation waiting on writer B's row lock");
}
