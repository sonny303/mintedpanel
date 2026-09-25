import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  downloadEnrollmentProof,
  saveEnrollmentRevision,
  type EnrollmentExplorerContext,
} from "./enrollmentExplorer";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SCOPE = "33333333-3333-4333-8333-333333333333";
const REVISION = "44444444-4444-4444-8444-444444444444";
const PUBLICATION = "55555555-5555-4555-8555-555555555555";
const DOCUMENT = "66666666-6666-4666-8666-666666666666";

function makeContext(db: unknown, audience: "staff" | "client" = "staff") {
  return {
    db: db as SupabaseClient<Database>,
    actorUserId: ACTOR,
    orgId: ORG,
    audience,
  } satisfies EnrollmentExplorerContext;
}

describe("enrollment explorer service contract", () => {
  it("binds actor, organization, audience and revision sources in one save RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { scopeId: SCOPE, revisionId: REVISION, cycleNo: 1, revisionNo: 1, created: true },
      error: null,
    });
    const ctx = makeContext({ rpc });
    const revision = {
      status: "submitted",
      owner: "Payer",
      retroStatus: "unknown",
      payerReference: "R-1",
      staffNote: "reviewed",
    } as const;
    const sources = [
      { sourceKind: "case" as const, sourceId: DOCUMENT, sourceFingerprint: "a".repeat(64) },
    ];

    await saveEnrollmentRevision(ctx, {
      providerId: DOCUMENT,
      groupId: SCOPE,
      payerProductId: REVISION,
      facilityId: PUBLICATION,
      state: "CO",
      revision,
      sources,
    });

    expect(rpc).toHaveBeenCalledWith(
      "save_enrollment_revision",
      expect.objectContaining({
        p_actor_user_id: ACTOR,
        p_org_id: ORG,
        p_audience: "staff",
        p_scope_id: null,
        p_expected_revision_id: null,
        p_revision: revision,
        p_sources: sources,
      }),
    );
  });

  it("rehashes stored bytes and records the exact immutable version before returning them", async () => {
    const bytes = new TextEncoder().encode("stored provider document bytes");
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
            storagePath: "org/provider/version.pdf",
            sha256: digest,
            fileName: "approval.pdf",
          },
          error: null,
        };
      }
      return { data: { recorded: true }, error: null };
    });
    const from = vi.fn((bucket: string) => ({
      download: vi.fn(async (path: string) => {
        expect(bucket).toBe("provider-documents");
        expect(path).toBe("org/provider/version.pdf");
        return { data: blob, error: null };
      }),
    }));

    const result = await downloadEnrollmentProof(
      makeContext({ rpc, storage: { from } }),
      PUBLICATION,
    );

    expect(await result.blob.text()).toBe("stored provider document bytes");
    expect(result).toMatchObject({ fileName: "approval.pdf", sha256: digest });
    expect(calls).toEqual([
      "authorize_enrollment_proof_download",
      "record_enrollment_proof_download",
    ]);
    expect(rpc).toHaveBeenLastCalledWith(
      "record_enrollment_proof_download",
      expect.objectContaining({
        p_actor_user_id: ACTOR,
        p_org_id: ORG,
        p_audience: "staff",
        p_publication_id: PUBLICATION,
        p_document_version_id: DOCUMENT,
        p_sha256: digest,
      }),
    );
  });

  it("does not record or release bytes when stored content differs from the pinned digest", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        publicationId: PUBLICATION,
        documentVersionId: DOCUMENT,
        storagePath: "org/provider/version.pdf",
        sha256: "0".repeat(64),
        fileName: "approval.pdf",
      },
      error: null,
    });
    const from = vi.fn(() => ({
      download: vi.fn().mockResolvedValue({ data: new Blob(["changed bytes"]), error: null }),
    }));

    await expect(
      downloadEnrollmentProof(makeContext({ rpc, storage: { from } }), PUBLICATION),
    ).rejects.toMatchObject({ code: "40001" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
