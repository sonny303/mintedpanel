// E4.5 TE-12 — document route handlers: role gating, input validation, the
// 404-before-signing wall, audit posture (one row per action, never a URL,
// audit failure fails the request), and no-store on every signed response.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext } from "./guard";

vi.mock("@/services/documentStorage", () => ({
  createDocumentUploadIntent: vi.fn(),
  finalizeDocument: vi.fn(),
  signDocumentDownload: vi.fn(),
}));

import {
  createDocumentUploadIntent,
  finalizeDocument,
  signDocumentDownload,
} from "@/services/documentStorage";
import {
  handleCreateUploadIntent,
  handleFinalizeDocument,
  handleDocumentDownload,
} from "./documentRoutes";

const intentMock = vi.mocked(createDocumentUploadIntent);
const finalizeMock = vi.mocked(finalizeDocument);
const signMock = vi.mocked(signDocumentDownload);

function ctx(role: AuthContext["role"] = "specialist"): AuthContext {
  return {
    userId: "u1",
    orgId: "org-1",
    role,
    userName: "Tester",
    email: "tester@minted.com",
    userMetadata: null,
    db: {} as AuthContext["db"],
    writeAudit: vi.fn().mockResolvedValue(undefined),
    asUser: () => ({}) as AuthContext["db"],
  };
}

async function body(res: Response): Promise<ApiEnvelope<unknown>> {
  return (await res.json()) as ApiEnvelope<unknown>;
}

const PROVIDER_ID = "0f0f0f0f-1111-4222-8333-444444444444";
const FAMILY_ID = "aaaa1111-2222-4333-8444-555566667777";
const DOC_ID = "bbbb1111-2222-4333-8444-555566667777";

const intentBody = {
  ownerType: "provider",
  ownerId: PROVIDER_ID,
  kind: "state_license",
  fileName: "license.pdf",
  fileSize: 1234,
  mimeType: "application/pdf",
};

beforeEach(() => vi.clearAllMocks());

describe("upload intent handler", () => {
  it("403s billing before any service call", async () => {
    const c = ctx("billing");
    const res = await handleCreateUploadIntent(intentBody, c);
    expect(res.status).toBe(403);
    expect(intentMock).not.toHaveBeenCalled();
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("422s an unknown kind and a malformed owner id without touching the service", async () => {
    const c = ctx();
    expect((await handleCreateUploadIntent({ ...intentBody, kind: "passport" }, c)).status).toBe(
      422,
    );
    expect((await handleCreateUploadIntent({ ...intentBody, ownerId: "nope" }, c)).status).toBe(
      404,
    );
    expect(intentMock).not.toHaveBeenCalled();
  });

  it("mints the intent, audits the family (never the URL/token), no-store", async () => {
    const c = ctx();
    intentMock.mockResolvedValue({
      kind: "ok",
      value: {
        familyId: FAMILY_ID,
        versionNumber: 1,
        path: `org/org-1/provider/${PROVIDER_ID}/${FAMILY_ID}/1/license.pdf`,
        uploadUrl: "https://example.supabase.co/storage/v1/object/upload/sign/x?token=secret",
        token: "secret-token",
      },
    });
    const res = await handleCreateUploadIntent(intentBody, c);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const env = await body(res);
    expect((env.data as { familyId: string }).familyId).toBe(FAMILY_ID);
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    const audit = JSON.stringify(vi.mocked(c.writeAudit).mock.calls[0][0]);
    expect(audit).not.toContain("secret");
    expect(audit).toContain(FAMILY_ID);
  });

  it("passes a service rejection through as its status", async () => {
    const c = ctx();
    intentMock.mockResolvedValue({ kind: "rejected", status: 404, message: "Provider not found" });
    const res = await handleCreateUploadIntent(intentBody, c);
    expect(res.status).toBe(404);
    expect(c.writeAudit).not.toHaveBeenCalled();
  });
});

describe("finalize handler", () => {
  const finalizeBody = {
    ...intentBody,
    familyId: FAMILY_ID,
    versionNumber: 1,
    expirationDate: "2027-01-01",
  };
  const doc = {
    id: DOC_ID,
    orgId: "org-1",
    providerId: PROVIDER_ID,
    groupId: null,
    caseId: null,
    docType: "state_license",
    fileName: "license.pdf",
    filePath: `org/org-1/provider/${PROVIDER_ID}/${FAMILY_ID}/1/license.pdf`,
    effectiveDate: null,
    expirationDate: "2027-01-01",
    uploadedBy: "u1",
    createdAt: "2026-07-17T00:00:00Z",
    documentFamilyId: FAMILY_ID,
    versionNumber: 1,
    supersedesDocumentId: null,
  } as const;

  it("403s billing", async () => {
    const res = await handleFinalizeDocument(finalizeBody, ctx("billing"));
    expect(res.status).toBe(403);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("422s a malformed date before the service", async () => {
    const res = await handleFinalizeDocument(
      { ...finalizeBody, expirationDate: "01/01/2027" },
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("201s a new version with ONE CREATE audit row", async () => {
    const c = ctx();
    finalizeMock.mockResolvedValue({ kind: "ok", value: doc });
    const res = await handleFinalizeDocument(finalizeBody, c);
    expect(res.status).toBe(201);
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(c.writeAudit).mock.calls[0][0]).toMatchObject({
      actionType: "CREATE",
      entityType: "provider_document",
      entityId: DOC_ID,
    });
  });

  it("200s a replay and re-runs NO side effects (no second audit)", async () => {
    const c = ctx();
    finalizeMock.mockResolvedValue({ kind: "ok", value: doc, replay: true });
    const res = await handleFinalizeDocument(finalizeBody, c);
    expect(res.status).toBe(200);
    expect(c.writeAudit).not.toHaveBeenCalled();
  });
});

describe("download handler", () => {
  const signedResult = {
    url: "https://example.supabase.co/storage/v1/object/sign/provider-documents/x?token=signed-secret",
    fileName: "license.pdf",
    expiresIn: 120,
    document: {
      id: DOC_ID,
      orgId: "org-1",
      providerId: PROVIDER_ID,
      groupId: null,
      caseId: null,
      docType: "state_license",
      fileName: "license.pdf",
      filePath: "org/org-1/provider/x/f/1/license.pdf",
      effectiveDate: null,
      expirationDate: "2027-01-01",
      uploadedBy: "u1",
      createdAt: "2026-07-17T00:00:00Z",
      documentFamilyId: FAMILY_ID,
      versionNumber: 1,
      supersedesDocumentId: null,
    },
  } as const;

  it("404s a non-uuid id without touching the service", async () => {
    const c = ctx();
    const res = await handleDocumentDownload("not-a-uuid", c);
    expect(res.status).toBe(404);
    expect(signMock).not.toHaveBeenCalled();
  });

  it("404s a cross-org/nonexistent id with no audit (a 404 is not a read)", async () => {
    const c = ctx();
    signMock.mockResolvedValue(null);
    const res = await handleDocumentDownload(DOC_ID, c);
    expect(res.status).toBe(404);
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("billing may download (member read rule) — no writer gate", async () => {
    const c = ctx("billing");
    signMock.mockResolvedValue({ ...signedResult });
    const res = await handleDocumentDownload(DOC_ID, c);
    expect(res.status).toBe(200);
  });

  it("signs with no-store + ONE READ audit that never carries the URL", async () => {
    const c = ctx();
    signMock.mockResolvedValue({ ...signedResult });
    const res = await handleDocumentDownload(DOC_ID, c);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const env = await body(res);
    expect((env.data as { url: string }).url).toContain("token=");
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    const audit = JSON.stringify(vi.mocked(c.writeAudit).mock.calls[0][0]);
    expect(audit).toContain(DOC_ID);
    expect(audit).not.toContain("signed-secret");
    expect(vi.mocked(c.writeAudit).mock.calls[0][0]).toMatchObject({
      actionType: "READ",
      entityType: "provider_document",
    });
  });

  it("fails the request when the audit write fails (no un-audited signed link)", async () => {
    const c = ctx();
    signMock.mockResolvedValue({ ...signedResult });
    vi.mocked(c.writeAudit).mockRejectedValue(new Error("audit_log insert failed"));
    await expect(handleDocumentDownload(DOC_ID, c)).rejects.toThrow("audit_log insert failed");
  });
});
