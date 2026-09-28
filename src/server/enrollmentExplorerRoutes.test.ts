import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { handleEnrollmentExplorerRequest } from "./enrollmentExplorerRoutes";
import { createEnrollmentReportViewToken } from "./enrollmentReportToken";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SCOPE = "33333333-3333-4333-8333-333333333333";
const REVISION = "44444444-4444-4444-8444-444444444444";
const PUBLICATION = "55555555-5555-4555-8555-555555555555";
const DOCUMENT = "66666666-6666-4666-8666-666666666666";
const CONTEXT_REVISION = "e6.14-test-context";
const TEST_SERVICE_KEY = "e6.14-route-test-service-key";

let previousServiceKey: string | undefined;

beforeEach(() => {
  previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_KEY;
});

afterEach(() => {
  if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
});

function user(db: unknown) {
  return { userId: ACTOR, db: db as SupabaseClient<Database> } as never;
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://x.test${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function reportSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    accessState: "ready",
    snapshotDigest: "a".repeat(64),
    sections: [],
    filterChoices: {
      groups: [],
      states: [],
      facilities: [],
      products: [],
      disciplines: ["PT", "PTA", "OT", "OTA", "SLP", "Other", "Unknown"],
      statuses: ["approved", "needs_verification"],
    },
    providers: [],
    records: [],
    providerCount: 0,
    rowCount: 0,
    tooLarge: false,
    hasMore: false,
    nextCursorKey: null,
    ...overrides,
  };
}

function csvRecord(overrides: Record<string, unknown> = {}) {
  return {
    providerName: "Ada Example",
    npi: "0000123456",
    taxonomyCode: "225100000X",
    groupLabel: "Example Group",
    payerLabel: "Example Payer",
    productLabel: "Example Product",
    state: "CO",
    facilityLabel: "Main Clinic",
    status: "approved",
    publicationState: "published",
    intakeDate: "2026-01-01",
    completeToSubmitDate: null,
    submittedDate: "2026-02-01",
    payerAcknowledgedDate: null,
    approvedDate: "2026-03-01",
    effectiveDate: "2026-04-01",
    terminationDate: null,
    cycleNo: 1,
    payerReference: "R-1",
    retroType: "unknown",
    retroValue: null,
    retroBasis: null,
    clientSafeBlocker: null,
    owner: "Payer",
    reviewedAsOf: "2026-03-01T00:00:00Z",
    proofLabel: "approval.pdf",
    proofType: "payer_approval_letter",
    authenticatedReportUrl: "/reporting/enrollment-explorer",
    sourceFingerprint: "must-not-export",
    staffNote: "must-not-export",
    storagePath: "must-not-export",
    ...overrides,
  };
}

describe("E6.13 enrollment explorer HTTP routes", () => {
  it("rejects caller-supplied identity and authority fields before an RPC", async () => {
    const rpc = vi.fn();
    const response = await handleEnrollmentExplorerRequest(
      request("/api/enrollment-explorer/targets", "POST", {
        groupId: SCOPE,
        payerProductId: REVISION,
        state: "CO",
        actorUserId: "attacker",
      }),
      user({ rpc }),
      { orgId: ORG, audience: "staff" },
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalizes malformed date SQL errors without logging submitted values", async () => {
    const secretDate = "not-a-real-date-sensitive-value";
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "22007", message: `date/time field value out of range: ${secretDate}` },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handleEnrollmentExplorerRequest(
        request("/api/enrollment-explorer/targets", "POST", {
          groupId: SCOPE,
          payerProductId: REVISION,
          state: "CO",
        }),
        user({ rpc }),
        { orgId: ORG, audience: "staff" },
      );

      expect(response.status).toBe(422);
      expect(await response.text()).not.toContain(secretDate);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("supports org-scoped staff triage when no group filter is selected", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [], nextCursor: null }, error: null });

    const response = await handleEnrollmentExplorerRequest(
      request("/api/enrollment-explorer/unresolved"),
      user({ rpc }),
      { orgId: ORG, audience: "staff" },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "get_enrollment_unresolved_page",
      expect.objectContaining({
        p_actor_user_id: ACTOR,
        p_org_id: ORG,
        p_audience: "staff",
        p_group_id: null,
        p_cursor: null,
        p_limit: 50,
      }),
    );
  });

  it("computes proof SHA256 from the immutable stored version before publishing", async () => {
    const bytes = new TextEncoder().encode("provider's signed approval letter");
    const blob = new Blob([bytes]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "get_enrollment_proof_capture_target") {
        return {
          data: {
            documentVersionId: DOCUMENT,
            storagePath: "org/provider/version-7.pdf",
            fileName: "stored-approval.pdf",
          },
          error: null,
        };
      }
      return { data: { publicationId: PUBLICATION, sha256: digest }, error: null };
    });
    const from = vi.fn(() => ({
      download: vi.fn().mockResolvedValue({ data: blob, error: null }),
    }));

    const response = await handleEnrollmentExplorerRequest(
      request("/api/enrollment-explorer/proofs", "POST", {
        scopeId: SCOPE,
        revisionId: REVISION,
        documentVersionId: DOCUMENT,
        evidenceKind: "payer_approval_letter",
        supportedFields: ["enrollment_status", "product_id", "facility_id"],
        reason: "Reviewed signed payer approval letter",
      }),
      user({ rpc, storage: { from } }),
      { orgId: ORG, audience: "staff" },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(calls.map((call) => call.name)).toEqual([
      "get_enrollment_proof_capture_target",
      "publish_enrollment_proof",
    ]);
    expect(calls[1]?.args).toMatchObject({
      p_actor_user_id: ACTOR,
      p_org_id: ORG,
      p_audience: "staff",
      p_document_version_id: DOCUMENT,
      p_sha256: digest,
      p_supported_fields: ["enrollment_status", "product_id", "facility_id"],
    });
  });

  it("streams only reauthorized, digest-matching proof bytes and returns no-store headers", async () => {
    const bytes = new TextEncoder().encode("exact immutable proof payload");
    const blob = new Blob([bytes]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const calls: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      calls.push(name);
      if (name === "authorize_enrollment_proof_download") {
        return {
          data: {
            publicationId: PUBLICATION,
            documentVersionId: DOCUMENT,
            storagePath: "org/provider/version-7.pdf",
            sha256: digest,
            fileName: "approval.pdf",
          },
          error: null,
        };
      }
      return { data: { recorded: true }, error: null };
    });
    const from = vi.fn(() => ({
      download: vi.fn().mockResolvedValue({ data: blob, error: null }),
    }));

    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/proofs/${PUBLICATION}/download`),
      user({ rpc, storage: { from } }),
      { orgId: ORG, audience: "client" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("approval.pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const delivered = new Uint8Array(await response.arrayBuffer());
    expect(createHash("sha256").update(delivered).digest("hex")).toBe(digest);
    expect(calls).toEqual([
      "authorize_enrollment_proof_download",
      "record_enrollment_proof_download",
    ]);
  });

  it("withholds download bytes and audit when storage digest is stale", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        publicationId: PUBLICATION,
        documentVersionId: DOCUMENT,
        storagePath: "org/provider/version-7.pdf",
        sha256: "0".repeat(64),
        fileName: "approval.pdf",
      },
      error: null,
    });
    const from = vi.fn(() => ({
      download: vi.fn().mockResolvedValue({ data: new Blob(["changed"]), error: null }),
    }));

    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/proofs/${PUBLICATION}/download`),
      user({ rpc, storage: { from } }),
      { orgId: ORG, audience: "client" },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      data: null,
      error: "Enrollment data changed; reload and retry",
    });
  });

  it("withholds bytes if publication is revoked while the stored object is being read", async () => {
    const bytes = new TextEncoder().encode("proof revoked during storage read");
    const blob = new Blob([bytes]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const calls: string[] = [];
    const rpc = vi.fn(async (name: string) => {
      calls.push(name);
      if (name === "authorize_enrollment_proof_download") {
        return {
          data: {
            publicationId: PUBLICATION,
            documentVersionId: DOCUMENT,
            storagePath: "org/provider/version-7.pdf",
            sha256: digest,
            fileName: "approval.pdf",
          },
          error: null,
        };
      }
      return { data: null, error: { code: "P0002", message: "enrollment_not_found" } };
    });
    const from = vi.fn(() => ({
      download: vi.fn().mockResolvedValue({ data: blob, error: null }),
    }));

    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/proofs/${PUBLICATION}/download`),
      user({ rpc, storage: { from } }),
      { orgId: ORG, audience: "client" },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(calls).toEqual([
      "authorize_enrollment_proof_download",
      "record_enrollment_proof_download",
    ]);
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("returns a token-bound, allowlisted report page with server-derived discipline", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: reportSnapshot({
        sections: [
          {
            key: `${ORG}:CO`,
            groupId: ORG,
            groupLabel: "Example Group",
            state: "CO",
            targetId: "never-return-this",
            columns: [
              {
                key: "c",
                productId: REVISION,
                payerLabel: "Payer",
                productLabel: "Product",
                intent: "private",
              },
            ],
          },
        ],
        filterChoices: {
          groups: [{ id: ORG, label: "Example Group", internal: "private" }],
          states: ["CO"],
          facilities: [],
          products: [],
          disciplines: ["PT", "Unknown"],
          statuses: ["approved"],
          targetIds: [REVISION],
        },
        providers: [
          {
            providerId: DOCUMENT,
            name: "Ada Example",
            npi: "0000123456",
            taxonomyCode: "225100000X",
            status: "active",
            referenceOnly: false,
            verificationState: "verified",
            sectionKeys: [`${ORG}:CO`],
            staffNote: "private",
            cells: [
              {
                key: "cell",
                sectionKey: `${ORG}:CO`,
                productId: REVISION,
                state: "published",
                locationCount: 1,
                internal: "private",
                locations: [
                  {
                    sectionKey: `${ORG}:CO`,
                    scopeId: SCOPE,
                    facilityId: PUBLICATION,
                    facilityLabel: "Main Clinic",
                    publicationState: "published",
                    historical: false,
                    status: "approved",
                    storagePath: "private",
                  },
                ],
              },
            ],
          },
        ],
        hasMore: true,
        nextCursorKey: { lastName: "example", firstName: "ada", providerId: DOCUMENT },
      }),
      error: null,
    });

    const response = await handleEnrollmentExplorerRequest(
      request("/api/enrollment-explorer/report/page?state=co"),
      user({ rpc }),
      { orgId: ORG, audience: "client", contextRevision: CONTEXT_REVISION },
    );
    const envelope = await response.json();
    const page = envelope.data;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(page.contextRevision).toBe(CONTEXT_REVISION);
    expect(page.filters).toEqual({ state: "CO" });
    expect(page.providers[0].discipline).toBe("PT");
    expect(page.providers[0].cells[0].locations[0].scopeId).toBe(SCOPE);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(page)).not.toMatch(
      /snapshotDigest|targetId|staffNote|storagePath|internal/,
    );
    expect(rpc).toHaveBeenCalledWith(
      "get_enrollment_report_snapshot",
      expect.objectContaining({
        p_actor_user_id: ACTOR,
        p_org_id: ORG,
        p_audience: "client",
        p_filters: { state: "CO" },
        p_mode: "page",
        p_cursor: null,
      }),
    );

    const nextPage = await handleEnrollmentExplorerRequest(
      request(
        `/api/enrollment-explorer/report/page?state=CO&viewToken=${encodeURIComponent(page.viewToken)}&cursor=${encodeURIComponent(page.nextCursor)}`,
      ),
      user({ rpc }),
      { orgId: ORG, audience: "client", contextRevision: CONTEXT_REVISION },
    );
    expect(nextPage.status).toBe(200);
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      p_cursor: { lastName: "example", firstName: "ada", providerId: DOCUMENT },
    });
  });

  it("keeps an authorized no-grants report distinct from an empty cohort", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: reportSnapshot({ accessState: "no_grants" }),
      error: null,
    });
    const response = await handleEnrollmentExplorerRequest(
      request("/api/enrollment-explorer/report/page"),
      user({ rpc }),
      { orgId: ORG, audience: "client", contextRevision: CONTEXT_REVISION },
    );
    const envelope = await response.json();

    expect(response.status).toBe(200);
    expect(envelope.data.accessState).toBe("no_grants");
    expect(envelope.data.providers).toEqual([]);
    expect(envelope.data).not.toHaveProperty("snapshotDigest");
  });

  it("rejects stale report snapshots and mismatched selected organizations", async () => {
    const token = createEnrollmentReportViewToken(
      {
        actorUserId: ACTOR,
        orgId: ORG,
        audience: "staff",
        contextRevision: CONTEXT_REVISION,
        filters: {},
      },
      "b".repeat(64),
    );
    const rpc = vi.fn().mockResolvedValue({ data: reportSnapshot(), error: null });
    const stale = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/report/page?viewToken=${encodeURIComponent(token)}`),
      user({ rpc }),
      { orgId: ORG, audience: "staff", contextRevision: CONTEXT_REVISION },
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("report_snapshot_stale");

    const mismatchedOrg = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/report/page?org=${PUBLICATION}`),
      user({ rpc }),
      { orgId: ORG, audience: "staff", contextRevision: CONTEXT_REVISION },
    );
    expect(mismatchedOrg.status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rechecks the complete report digest after serialization and before CSV streaming", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: reportSnapshot({ records: [csvRecord()], providerCount: 1, rowCount: 1 }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: reportSnapshot({ providerCount: 1, rowCount: 1 }),
        error: null,
      });
    const token = createEnrollmentReportViewToken(
      {
        actorUserId: ACTOR,
        orgId: ORG,
        audience: "staff",
        contextRevision: CONTEXT_REVISION,
        filters: {},
      },
      "a".repeat(64),
    );

    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/report.csv?viewToken=${encodeURIComponent(token)}`),
      user({ rpc }),
      { orgId: ORG, audience: "staff", contextRevision: CONTEXT_REVISION },
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("enrollment-report.csv");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(csv).toContain('"0000123456"');
    expect(csv).not.toMatch(/must-not-export|sourceFingerprint|storagePath|staffNote/);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([name, args]) => [name, args?.p_mode])).toEqual([
      ["get_enrollment_report_snapshot", "export"],
      ["get_enrollment_report_snapshot", "page"],
    ]);
  });

  it("denies CSV bytes when the report digest changes immediately before streaming", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: reportSnapshot({ records: [csvRecord()], providerCount: 1, rowCount: 1 }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: reportSnapshot({ snapshotDigest: "b".repeat(64), providerCount: 1, rowCount: 1 }),
        error: null,
      });
    const token = createEnrollmentReportViewToken(
      {
        actorUserId: ACTOR,
        orgId: ORG,
        audience: "staff",
        contextRevision: CONTEXT_REVISION,
        filters: {},
      },
      "a".repeat(64),
    );

    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/report.csv?viewToken=${encodeURIComponent(token)}`),
      user({ rpc }),
      { orgId: ORG, audience: "staff", contextRevision: CONTEXT_REVISION },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("Ada Example");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("delivers a complete CSV body larger than 4.5 MB through the native response stream", async () => {
    const records = Array.from({ length: 1200 }, (_, index) =>
      csvRecord({
        payerReference: `ROW-${String(index).padStart(4, "0")}-${"X".repeat(3900)}`,
      }),
    );
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: reportSnapshot({ records, providerCount: 1200, rowCount: records.length }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: reportSnapshot({ providerCount: 1200, rowCount: records.length }),
        error: null,
      });
    const token = createEnrollmentReportViewToken(
      {
        actorUserId: ACTOR,
        orgId: ORG,
        audience: "staff",
        contextRevision: CONTEXT_REVISION,
        filters: {},
      },
      "a".repeat(64),
    );
    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/report.csv?viewToken=${encodeURIComponent(token)}`),
      user({ rpc }),
      { orgId: ORG, audience: "staff", contextRevision: CONTEXT_REVISION },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = bytes.toString("utf8");

    expect(response.status).toBe(200);
    expect(bytes.byteLength).toBeGreaterThan(4_500_000);
    expect(body.split("\r\n")).toHaveLength(records.length + 1);
    expect(body).toContain("ROW-0000-");
    expect(body).toContain("ROW-1199-");
    expect(createHash("sha256").update(bytes).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("returns JSON 413 with no CSV bytes when the export snapshot exceeds its row cap", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: reportSnapshot({ tooLarge: true, rowCount: 100_001 }),
      error: null,
    });
    const token = createEnrollmentReportViewToken(
      {
        actorUserId: ACTOR,
        orgId: ORG,
        audience: "client",
        contextRevision: CONTEXT_REVISION,
        filters: {},
      },
      "a".repeat(64),
    );
    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/report.csv?viewToken=${encodeURIComponent(token)}`),
      user({ rpc }),
      { orgId: ORG, audience: "client", contextRevision: CONTEXT_REVISION },
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toContain("report_csv_limit_exceeded");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns JSON 413 with no CSV bytes when UTF-8 serialization exceeds its byte cap", async () => {
    const large = "x".repeat(26 * 1024 * 1024);
    const rpc = vi.fn().mockResolvedValue({
      data: reportSnapshot({ records: [csvRecord({ clientSafeBlocker: large })], rowCount: 1 }),
      error: null,
    });
    const token = createEnrollmentReportViewToken(
      {
        actorUserId: ACTOR,
        orgId: ORG,
        audience: "client",
        contextRevision: CONTEXT_REVISION,
        filters: {},
      },
      "a".repeat(64),
    );
    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/report.csv?viewToken=${encodeURIComponent(token)}`),
      user({ rpc }),
      { orgId: ORG, audience: "client", contextRevision: CONTEXT_REVISION },
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toContain("report_csv_limit_exceeded");
    expect(rpc).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("projects client history to safe historical publication fields", async () => {
    const nextCursor = { createdAt: "2026-09-25T12:00:00Z", revisionId: REVISION };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        audience: "client",
        scopeId: SCOPE,
        items: [
          {
            scopeId: SCOPE,
            orgId: ORG,
            providerId: DOCUMENT,
            groupId: ORG,
            payerProductId: REVISION,
            facilityId: PUBLICATION,
            state: "CO",
            providerName: "Synthetic Provider",
            groupLabel: "Synthetic Group",
            payerLabel: "Synthetic Payer",
            productLabel: "Synthetic Product",
            facilityLabel: "Synthetic Facility",
            status: "approved",
            cycleNo: 1,
            revisionNo: 2,
            historical: true,
            publicationState: "published",
            publishedAt: "2026-09-24T12:00:00Z",
            proofs: [
              {
                publicationId: PUBLICATION,
                evidenceKind: "payer_approval_letter",
                supportedFields: ["enrollment_status"],
                publishedAt: "2026-09-24T12:00:00Z",
                sha256: "private",
                storagePath: "private",
              },
            ],
            sources: [{ sourceId: DOCUMENT, sourceFingerprint: "private" }],
            staffNote: "private",
          },
        ],
        nextCursor,
      },
      error: null,
    });
    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/scopes/${SCOPE}/history?limit=20`),
      user({ rpc }),
      { orgId: ORG, audience: "client" },
    );
    const envelope = await response.json();

    expect(response.status).toBe(200);
    expect(envelope.data.items[0]).toMatchObject({
      historical: true,
      publicationState: "published",
      scopeId: SCOPE,
      productLabel: "Synthetic Product",
      facilityLabel: "Synthetic Facility",
    });
    expect(JSON.stringify(envelope.data)).not.toMatch(
      /sources|sourceFingerprint|staffNote|sha256|storagePath/,
    );
    expect(envelope.data.nextCursor).toBe(
      Buffer.from(JSON.stringify(nextCursor)).toString("base64url"),
    );
    expect(rpc).toHaveBeenCalledWith(
      "get_enrollment_scope_history_page",
      expect.objectContaining({
        p_actor_user_id: ACTOR,
        p_org_id: ORG,
        p_audience: "client",
        p_scope_id: SCOPE,
        p_cursor: null,
        p_limit: 20,
      }),
    );
  });

  it("maps the native staff history revision's snake_case database fields", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        audience: "staff",
        scopeId: SCOPE,
        items: [
          {
            revisionId: REVISION,
            cycleNo: 2,
            revisionNo: 3,
            createdAt: "2026-09-25T12:00:00Z",
            status: "approved",
            revision: {
              status: "approved",
              action_owner: "Payer",
              retro_status: "unknown",
              approved_date: "2026-09-20",
              staff_note: "internal review note",
            },
            sources: [
              {
                sourceKind: "case",
                sourceId: DOCUMENT,
                sourceFingerprint: "a".repeat(64),
                sourceSnapshot: { case_status: "approved" },
              },
            ],
            publications: [
              {
                publicationId: PUBLICATION,
                kind: "summary",
                state: "published",
                publishedAt: "2026-09-24T12:00:00Z",
              },
            ],
          },
        ],
        nextCursor: null,
      },
      error: null,
    });
    const response = await handleEnrollmentExplorerRequest(
      request(`/api/enrollment-explorer/scopes/${SCOPE}/history`),
      user({ rpc }),
      { orgId: ORG, audience: "staff" },
    );
    const envelope = await response.json();

    expect(response.status).toBe(200);
    expect(envelope.data.items[0].revision).toMatchObject({
      owner: "Payer",
      retroStatus: "unknown",
      approvedDate: "2026-09-20",
      staffNote: "internal review note",
    });
    expect(envelope.data.items[0].sources[0].sourceSnapshot).toEqual({ case_status: "approved" });
  });
});
