// E4.5 TE-12 — documentStorage service against a query-shape fake: explicit
// org+owner checks (the service-role client bypasses RLS), server-generated
// object keys, object-presence verification before metadata insert, idempotent
// finalize, supersedes chaining, and the 404-before-signing download wall.
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  createDocumentUploadIntent,
  finalizeDocument,
  signDocumentDownload,
  type DocumentStorageServiceCtx,
} from "./documentStorage";

const ORG = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "0f0f0f0f-1111-4222-8333-444444444444";
const GROUP = "aaaa0000-1111-4222-8333-444444444444";
const FAMILY = "aaaa1111-2222-4333-8444-555566667777";

type Row = Record<string, unknown>;

interface Fixtures {
  providers?: Row[];
  provider_groups?: Row[];
  provider_documents?: Row[];
  credential_cases?: Row[];
}

interface StorageCalls {
  signedUploadPaths: string[];
  signedUrlPaths: string[];
  listed: string[];
  removed: string[][];
}

function fakeDb(
  fixtures: Fixtures,
  storageObjects: Record<string, Array<{ name: string; created_at?: string; metadata?: Row }>> = {},
) {
  const calls: StorageCalls = {
    signedUploadPaths: [],
    signedUrlPaths: [],
    listed: [],
    removed: [],
  };
  const inserted: Row[] = [];
  const tables: Record<string, Row[]> = {
    providers: fixtures.providers ?? [],
    provider_groups: fixtures.provider_groups ?? [],
    provider_documents: fixtures.provider_documents ?? [],
    credential_cases: fixtures.credential_cases ?? [],
  };

  const db = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
        insert(row: Row) {
          inserted.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: "new-doc-id", created_at: "2026-07-17T00:00:00Z", ...row },
                  error: null,
                }),
            }),
          };
        },
      };
      return builder;
    },
    storage: {
      from(_bucket: string) {
        return {
          list: vi.fn((prefix: string) => {
            calls.listed.push(prefix);
            return Promise.resolve({ data: storageObjects[prefix] ?? [], error: null });
          }),
          remove: vi.fn((paths: string[]) => {
            calls.removed.push(paths);
            return Promise.resolve({ data: null, error: null });
          }),
          createSignedUploadUrl: vi.fn((path: string) => {
            calls.signedUploadPaths.push(path);
            return Promise.resolve({
              data: {
                signedUrl: `https://x.supabase.co/storage/v1/object/upload/sign/provider-documents/${path}?token=t`,
                token: "t",
                path,
              },
              error: null,
            });
          }),
          createSignedUrl: vi.fn((path: string) => {
            calls.signedUrlPaths.push(path);
            return Promise.resolve({
              data: { signedUrl: `https://x.supabase.co/sign/${path}?token=s` },
              error: null,
            });
          }),
        };
      },
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, calls, inserted };
}

function ctx(db: SupabaseClient<Database>): DocumentStorageServiceCtx {
  return { db, orgId: ORG, userId: "u1" };
}

const orgProvider = { id: PROVIDER, org_id: ORG };
const orgGroup = { id: GROUP, org_id: ORG };

const intentInput = {
  ownerType: "provider" as const,
  ownerId: PROVIDER,
  kind: "state_license" as const,
  fileName: "license.pdf",
  fileSize: 1000,
  mimeType: "application/pdf",
};

describe("createDocumentUploadIntent", () => {
  it("404s a cross-org owner and never mints a signed target", async () => {
    const { db, calls } = fakeDb({ providers: [{ id: PROVIDER, org_id: OTHER_ORG }] });
    const result = await createDocumentUploadIntent(ctx(db), intentInput);
    expect(result).toMatchObject({ kind: "rejected", status: 404 });
    expect(calls.signedUploadPaths).toEqual([]);
  });

  it("422s a group kind on the provider grain", async () => {
    const { db } = fakeDb({ providers: [orgProvider] });
    const result = await createDocumentUploadIntent(ctx(db), { ...intentInput, kind: "w9" });
    expect(result).toMatchObject({ kind: "rejected", status: 422 });
  });

  it("mints v1 of a NEW family on a server-generated org-bound path", async () => {
    const { db, calls } = fakeDb({ providers: [orgProvider] });
    const result = await createDocumentUploadIntent(ctx(db), intentInput);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.versionNumber).toBe(1);
    expect(calls.signedUploadPaths[0]).toBe(
      `org/${ORG}/provider/${PROVIDER}/${result.value.familyId}/1/license.pdf`,
    );
  });

  it("versions an existing family (max+1) and rejects an owner/kind mismatch", async () => {
    const famRow = {
      id: "v1",
      org_id: ORG,
      document_family_id: FAMILY,
      version_number: 1,
      supersedes_document_id: null,
      provider_id: PROVIDER,
      group_id: null,
      doc_type: "state_license",
    };
    const { db } = fakeDb({ providers: [orgProvider], provider_documents: [famRow] });
    const ok = await createDocumentUploadIntent(ctx(db), { ...intentInput, familyId: FAMILY });
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") expect(ok.value.versionNumber).toBe(2);

    const mismatch = await createDocumentUploadIntent(ctx(db), {
      ...intentInput,
      kind: "cv",
      familyId: FAMILY,
    });
    expect(mismatch).toMatchObject({ kind: "rejected", status: 422 });
  });

  it("rejects a caseId that is cross-org or not linked to the owner (ASD BITE-ASD-02 — intent gets the same case-link check finalize has)", async () => {
    const { db, calls } = fakeDb({
      providers: [orgProvider],
      credential_cases: [
        { id: "case-1", org_id: OTHER_ORG, provider_id: PROVIDER, group_id: null },
      ],
    });
    const result = await createDocumentUploadIntent(ctx(db), { ...intentInput, caseId: "case-1" });
    expect(result).toMatchObject({ kind: "rejected", status: 404 });
    expect(calls.signedUploadPaths).toEqual([]);
  });

  it("mints an intent when the caseId IS linked to the owner", async () => {
    const { db } = fakeDb({
      providers: [orgProvider],
      credential_cases: [{ id: "case-1", org_id: ORG, provider_id: PROVIDER, group_id: null }],
    });
    const result = await createDocumentUploadIntent(ctx(db), { ...intentInput, caseId: "case-1" });
    expect(result.kind).toBe("ok");
  });

  it("sweeps only EXPIRED orphan version folders in the family prefix (TE-4)", async () => {
    const famRow = {
      id: "v1",
      org_id: ORG,
      document_family_id: FAMILY,
      version_number: 1,
      supersedes_document_id: null,
      provider_id: PROVIDER,
      group_id: null,
      doc_type: "state_license",
    };
    const prefix = `org/${ORG}/provider/${PROVIDER}/${FAMILY}`;
    const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const { db, calls } = fakeDb(
      { providers: [orgProvider], provider_documents: [famRow] },
      {
        [prefix]: [{ name: "1" }, { name: "2" }, { name: "3" }],
        [`${prefix}/2`]: [{ name: "old.pdf", created_at: stale }],
        [`${prefix}/3`]: [{ name: "inflight.pdf", created_at: fresh }],
      },
    );
    const result = await createDocumentUploadIntent(ctx(db), { ...intentInput, familyId: FAMILY });
    expect(result.kind).toBe("ok");
    // Version 1 has metadata (never swept); folder 2's stale object is removed;
    // folder 3's fresh in-flight object is left alone.
    expect(calls.removed).toEqual([[`${prefix}/2/old.pdf`]]);
  });
});

describe("finalizeDocument", () => {
  const finalizeInput = {
    ...intentInput,
    familyId: FAMILY,
    versionNumber: 1,
    expirationDate: "2027-01-01",
  };
  const objectPath = `org/${ORG}/provider/${PROVIDER}/${FAMILY}/1`;

  it("requires the expiration date for a dated kind (D2)", async () => {
    const { db, inserted } = fakeDb({ providers: [orgProvider] });
    const result = await finalizeDocument(ctx(db), { ...finalizeInput, expirationDate: null });
    expect(result).toMatchObject({ kind: "rejected", status: 422 });
    expect(inserted).toEqual([]);
  });

  it("never writes metadata for a missing object (TE-4)", async () => {
    const { db, inserted } = fakeDb({ providers: [orgProvider] }, {});
    const result = await finalizeDocument(ctx(db), finalizeInput);
    expect(result).toMatchObject({ kind: "rejected", status: 422 });
    expect(inserted).toEqual([]);
  });

  it("inserts the immutable row with supersedes = the family head", async () => {
    const v1 = {
      id: "v1",
      org_id: ORG,
      document_family_id: FAMILY,
      version_number: 1,
      supersedes_document_id: null,
      provider_id: PROVIDER,
      group_id: null,
      doc_type: "state_license",
    };
    const { db, inserted } = fakeDb(
      { providers: [orgProvider], provider_documents: [v1] },
      {
        [`org/${ORG}/provider/${PROVIDER}/${FAMILY}/2`]: [
          { name: "license.pdf", metadata: { size: 1000, mimetype: "application/pdf" } },
        ],
      },
    );
    const result = await finalizeDocument(ctx(db), { ...finalizeInput, versionNumber: 2 });
    expect(result.kind).toBe("ok");
    expect(inserted[0]).toMatchObject({
      org_id: ORG,
      provider_id: PROVIDER,
      group_id: null,
      doc_type: "state_license",
      document_family_id: FAMILY,
      version_number: 2,
      supersedes_document_id: "v1",
      uploaded_by: "u1",
    });
  });

  it("replays idempotently: an existing (family, version) row returns with no insert", async () => {
    const v1 = {
      id: "v1",
      org_id: ORG,
      document_family_id: FAMILY,
      version_number: 1,
      supersedes_document_id: null,
      provider_id: PROVIDER,
      group_id: null,
      doc_type: "state_license",
      file_name: "license.pdf",
      file_path: `${objectPath}/license.pdf`,
    };
    const { db, inserted } = fakeDb({ providers: [orgProvider], provider_documents: [v1] });
    const result = await finalizeDocument(ctx(db), finalizeInput);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.replay).toBe(true);
    expect(inserted).toEqual([]);
  });

  it("rejects a caseId that is cross-org or not linked to the owner", async () => {
    const { db } = fakeDb({
      providers: [orgProvider],
      credential_cases: [
        { id: "case-1", org_id: OTHER_ORG, provider_id: PROVIDER, group_id: null },
      ],
    });
    const result = await finalizeDocument(ctx(db), { ...finalizeInput, caseId: "case-1" });
    expect(result).toMatchObject({ kind: "rejected", status: 404 });
  });

  it("accepts a group-grain finalize for an org group", async () => {
    const { db, inserted } = fakeDb(
      { provider_groups: [orgGroup] },
      {
        [`org/${ORG}/group/${GROUP}/${FAMILY}/1`]: [
          { name: "w9.pdf", metadata: { size: 500, mimetype: "application/pdf" } },
        ],
      },
    );
    const result = await finalizeDocument(ctx(db), {
      ownerType: "group",
      ownerId: GROUP,
      kind: "w9",
      familyId: FAMILY,
      versionNumber: 1,
      fileName: "w9.pdf",
      mimeType: "application/pdf",
    });
    expect(result.kind).toBe("ok");
    expect(inserted[0]).toMatchObject({ group_id: GROUP, provider_id: null, doc_type: "w9" });
  });
});

describe("signDocumentDownload", () => {
  const docRow = {
    id: "doc-1",
    org_id: ORG,
    provider_id: PROVIDER,
    group_id: null,
    case_id: null,
    doc_type: "state_license",
    file_name: "license.pdf",
    file_path: `org/${ORG}/provider/${PROVIDER}/${FAMILY}/1/license.pdf`,
    document_family_id: FAMILY,
    version_number: 1,
    supersedes_document_id: null,
  };

  it("returns null (the route's 404) for a cross-org id and never signs", async () => {
    const { db, calls } = fakeDb({ provider_documents: [{ ...docRow, org_id: OTHER_ORG }] });
    const result = await signDocumentDownload(ctx(db), "doc-1");
    expect(result).toBeNull();
    expect(calls.signedUrlPaths).toEqual([]);
  });

  it("signs the stored path short-lived for an org-owned document", async () => {
    const { db, calls } = fakeDb({ provider_documents: [docRow] });
    const result = await signDocumentDownload(ctx(db), "doc-1");
    expect(result).not.toBeNull();
    expect(result?.expiresIn).toBe(120);
    expect(result?.fileName).toBe("license.pdf");
    expect(calls.signedUrlPaths).toEqual([docRow.file_path]);
  });
});
