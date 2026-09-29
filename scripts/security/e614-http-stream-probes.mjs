// Runs inside the disposable E6.12 topology against real GoTrue, PostgREST,
// and the built Nitro server. The report RPC uses a synthetic transport fixture.
import { createHash } from "node:crypto";
import { E614_HTTP_STREAM } from "/tmp/e614-http-stream-fixtures.mjs";

const headers = [
  "Provider Name",
  "NPI",
  "Discipline",
  "Group",
  "Payer",
  "Product",
  "State",
  "Facility",
  "Status",
  "Publication State",
  "Intake Date",
  "Complete to Submit Date",
  "Submitted Date",
  "Payer Acknowledged Date",
  "Approved Date",
  "Effective Date",
  "Termination Date",
  "Current Application Cycle",
  "Payer Reference",
  "Retro Type",
  "Retro Value",
  "Retro Basis",
  "Client-safe Blocker",
  "Owner",
  "Reviewed As Of",
  "Proof Label",
  "Proof Type",
  "Authenticated Report URL",
];
const record = [
  "E614 Stream Clinician",
  "9000000001",
  "PT",
  "E614 Group",
  "E614 Payer",
  "E614 Product",
  "CO",
  "E614 Facility",
  "submitted",
  "draft",
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  "1",
  "E614-STREAM",
  "unknown",
  null,
  null,
  E614_HTTP_STREAM.blocker,
  "Payer",
  null,
  null,
  null,
  "/reporting/enrollment-explorer",
];
const line = (values) => values.map((value) => (value == null ? "" : `"${value}"`)).join(",");

export async function runE614HttpStreamProbes({ id, tokens, request, app, anonKey, assert }) {
  const authHeaders = (extra = {}) => ({
    authorization: `Bearer ${tokens.admin}`,
    apikey: anonKey,
    ...extra,
  });
  const context = await request(app, "/api/me/access-context", {
    headers: authHeaders(),
  });
  assert("e614.stream_context", context.response.status === 200);
  const revision = context.response.headers.get("x-minted-context-revision");
  const selected = await request(app, "/api/me/access-context/select", {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      audience: "staff",
      orgId: id.orgA,
      contextRevision: revision,
    }),
  });
  assert("e614.stream_selected", selected.response.status === 200);
  const selectedRevision = selected.response.headers.get("x-minted-context-revision");
  const reportHeaders = authHeaders({
    "x-org-id": id.orgA,
    "x-enrollment-audience": "staff",
    "x-minted-context-revision": selectedRevision,
  });
  const query = new URLSearchParams({ search: E614_HTTP_STREAM.search });
  const page = await request(app, `/api/enrollment-explorer/report/page?${query}`, {
    headers: reportHeaders,
  });
  const viewToken = page.body?.data?.viewToken;
  assert(
    "e614.stream_view_token",
    page.response.status === 200 && typeof viewToken === "string" && viewToken.length > 30,
    `status_${page.response.status}`,
  );
  query.set("viewToken", viewToken);
  const response = await fetch(`${app}/api/enrollment-explorer/report.csv?${query}`, {
    headers: reportHeaders,
    signal: AbortSignal.timeout(60_000),
  });
  const delivered = Buffer.from(await response.arrayBuffer());
  const expected = Buffer.from(
    `${line(headers)}\r\n${Array(E614_HTTP_STREAM.rows).fill(line(record)).join("\r\n")}`,
    "utf8",
  );
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert(
    "e614.stream_http_length_hash",
    response.status === 200 &&
      delivered.byteLength > 4.5 * 1024 * 1024 &&
      response.headers.get("content-type")?.includes("text/csv") &&
      delivered.byteLength === expected.byteLength &&
      sha(delivered) === sha(expected),
    `status_${response.status}_bytes_${delivered.byteLength}_expected_${expected.byteLength}`,
  );
  process.stdout.write(`E614|HTTP|PASS|bytes=${delivered.byteLength}|sha256=${sha(delivered)}\n`);
}
