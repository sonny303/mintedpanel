import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { handleEnrollmentExplorerRequest } from "./enrollmentExplorerRoutes";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SCOPE = "33333333-3333-4333-8333-333333333333";
const REVISION = "44444444-4444-4444-8444-444444444444";
const PUBLICATION = "55555555-5555-4555-8555-555555555555";
const DOCUMENT = "66666666-6666-4666-8666-666666666666";

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
});
