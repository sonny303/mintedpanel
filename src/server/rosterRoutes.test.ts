import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./guard";
import type { RosterExportSnapshot, RosterOverride } from "@/types";

vi.mock("@/services/rosterEngineData", () => ({
  commitRosterExport: vi.fn(),
  getIdempotentRosterExport: vi.fn(),
  getRosterExportFile: vi.fn(),
  getRosterMappingRecord: vi.fn(),
  getRosterMappingTemplate: vi.fn(),
  getRosterSourceSnapshot: vi.fn(),
  listRosterExportSnapshots: vi.fn(),
  listRosterMappings: vi.fn(),
  listRosterOverrides: vi.fn(),
  listRosterSourceOptions: vi.fn(),
  listRosterTemplates: vi.fn(),
  recordRosterOverride: vi.fn(),
  saveRosterMapping: vi.fn(),
}));

import {
  commitRosterExport,
  getIdempotentRosterExport,
  getRosterExportFile,
  getRosterSourceSnapshot,
  listRosterExportSnapshots,
  listRosterOverrides,
  recordRosterOverride,
} from "@/services/rosterEngineData";
import {
  handleRosterDownload,
  handleRosterExport,
  handleRosterHistory,
  handleRosterValidation,
  handleSaveRosterOverride,
} from "./rosterRoutes";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "44444444-4444-4444-8444-444444444444";
const MAPPING_ID = "55555555-5555-4555-8555-555555555555";
const PROVIDER_ID = "66666666-6666-4666-8666-666666666666";
const FINGERPRINT = "a".repeat(64);
const IDEMPOTENCY_KEY = "77777777-7777-4777-8777-777777777777";

const template = {
  id: TEMPLATE_ID,
  slug: "unit-test",
  payerName: "Test payer",
  name: "Test provider roster",
  schemaVersion: 1,
  verified: false,
  verificationStatus: "draft_pending_payer_spec" as const,
  grains: ["provider"] as Array<"provider">,
  columns: [
    { key: "first_name", header: "First name", required: true, targetType: "text" as const },
  ],
};

const mapping = {
  id: MAPPING_ID,
  orgId: ORG_ID,
  templateId: TEMPLATE_ID,
  name: "Test mapping",
  grain: "provider" as const,
  selectedProviderIds: [PROVIDER_ID],
  selectedFacilityIds: [],
  selectedGroupIds: [],
  columnAssignments: [
    { columnKey: "first_name", sourceField: "provider.first_name" as const, transform: null },
  ],
  revision: 2,
  updatedAt: "2026-09-25T12:00:00Z",
};

const sourceSnapshot = {
  source: {
    mapping,
    template,
    rows: [
      {
        rowKey: PROVIDER_ID,
        provider: { first_name: "Ada", last_name: "Lovelace", npi: "1234567890" },
        facility: null,
        licenses: [],
      },
    ],
    validation_date: "2026-09-25",
    validator_version: "roster-rules-v1",
  },
  input_fingerprint: FINGERPRINT,
};

const snapshot: RosterExportSnapshot = {
  id: "99999999-9999-4999-8999-999999999999",
  mappingId: MAPPING_ID,
  templateId: TEMPLATE_ID,
  templateName: template.name,
  mappingName: mapping.name,
  templateVerified: false,
  templateVerificationStatus: "draft_pending_payer_spec",
  format: "csv",
  exportedAt: "2026-09-25T12:30:00Z",
  exportedBy: USER_ID,
  totalRows: 1,
  checksum: "b".repeat(64),
  appliedOverrides: 1,
  fileName: "test-roster.csv",
  downloadPath: "/api/rosters/exports/99999999-9999-4999-8999-999999999999/download",
};

function ctx(role: AuthContext["role"] = "specialist", orgId = ORG_ID): AuthContext {
  return {
    userId: USER_ID,
    orgId,
    role,
    userName: "Test User",
    email: "test@example.test",
    userMetadata: {},
    db: {} as AuthContext["db"],
    writeAudit: vi.fn().mockResolvedValue(undefined),
  };
}

async function envelope(response: Response) {
  return (await response.json()) as { data: unknown; error: string | null };
}

const exportInput = {
  format: "csv" as const,
  expectedInputFingerprint: FINGERPRINT,
  idempotencyKey: IDEMPOTENCY_KEY,
};

const overrideInput = {
  expectedRevision: 2,
  inputFingerprint: FINGERPRINT,
  rowKey: PROVIDER_ID,
  ruleCode: "provider_npi_invalid",
  fieldKey: "provider.npi",
  reason: "Payer confirmed this provider exception for this specific roster.",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getIdempotentRosterExport).mockResolvedValue(null);
  vi.mocked(getRosterSourceSnapshot).mockResolvedValue(sourceSnapshot as never);
  vi.mocked(listRosterOverrides).mockResolvedValue([]);
  vi.mocked(listRosterExportSnapshots).mockResolvedValue([]);
  vi.mocked(commitRosterExport).mockResolvedValue({
    id: snapshot.id,
    exported_at: snapshot.exportedAt,
    file_name: snapshot.fileName,
    sha256: snapshot.checksum,
  });
});

describe("roster API route governance", () => {
  it("keeps history scoped to the authenticated organization and returns frozen template status", async () => {
    vi.mocked(listRosterExportSnapshots).mockResolvedValue([snapshot]);
    const response = await handleRosterHistory(ctx("billing", "org-caller"));
    const result = await envelope(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(listRosterExportSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-caller", actorId: USER_ID }),
    );
    expect(result.data).toEqual([snapshot]);
    expect((result.data as RosterExportSnapshot[])[0]?.templateVerified).toBe(false);
    expect((result.data as RosterExportSnapshot[])[0]?.templateVerificationStatus).toBe(
      "draft_pending_payer_spec",
    );
  });

  it("denies billing members override and export mutations before any data access", async () => {
    const billing = ctx("billing");
    const [overrideResponse, exportResponse] = await Promise.all([
      handleSaveRosterOverride(MAPPING_ID, overrideInput, billing),
      handleRosterExport(MAPPING_ID, exportInput, billing),
    ]);

    expect(overrideResponse.status).toBe(403);
    expect(exportResponse.status).toBe(403);
    expect(getRosterSourceSnapshot).not.toHaveBeenCalled();
    expect(getIdempotentRosterExport).not.toHaveBeenCalled();
    expect(recordRosterOverride).not.toHaveBeenCalled();
    expect(commitRosterExport).not.toHaveBeenCalled();
  });

  it("validates current source data under the caller organization", async () => {
    const response = await handleRosterValidation(MAPPING_ID, ctx("specialist", "org-current"));
    const result = await envelope(response);

    expect(response.status).toBe(200);
    expect(getRosterSourceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-current", actorId: USER_ID }),
      MAPPING_ID,
    );
    expect(listRosterOverrides).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-current" }),
      MAPPING_ID,
      mapping.revision,
      FINGERPRINT,
    );
    expect(result.data).toMatchObject({ hardErrorCount: 1, exportable: false });
  });

  it("rejects short override reasons before reading source data", async () => {
    const response = await handleSaveRosterOverride(
      MAPPING_ID,
      { ...overrideInput, reason: "too short" },
      ctx(),
    );
    expect(response.status).toBe(422);
    expect((await envelope(response)).error).toMatch(/20 characters/);
    expect(getRosterSourceSnapshot).not.toHaveBeenCalled();
    expect(recordRosterOverride).not.toHaveBeenCalled();
  });

  it("saves an override only for the current row, rule, and field tuple", async () => {
    const saved: RosterOverride = {
      id: "override-1",
      mappingId: MAPPING_ID,
      revision: mapping.revision,
      inputFingerprint: FINGERPRINT,
      rowKey: PROVIDER_ID,
      ruleCode: "provider_npi_invalid",
      fieldKey: "provider.npi",
      reason: overrideInput.reason,
      createdAt: "2026-09-25T12:31:00Z",
    };
    vi.mocked(recordRosterOverride).mockResolvedValue(saved);

    const mismatch = await handleSaveRosterOverride(
      MAPPING_ID,
      { ...overrideInput, fieldKey: "first_name" },
      ctx(),
    );
    expect(mismatch.status).toBe(422);
    expect(recordRosterOverride).not.toHaveBeenCalled();

    const response = await handleSaveRosterOverride(MAPPING_ID, overrideInput, ctx());
    expect(response.status).toBe(201);
    expect((await envelope(response)).data).toEqual(saved);
    expect(recordRosterOverride).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, actorId: USER_ID }),
      MAPPING_ID,
      overrideInput,
    );
  });

  it("returns stale conflict when freshly read source differs from the requested export fingerprint", async () => {
    vi.mocked(getRosterSourceSnapshot).mockResolvedValue({
      ...sourceSnapshot,
      input_fingerprint: "c".repeat(64),
    } as never);

    const response = await handleRosterExport(MAPPING_ID, exportInput, ctx());

    expect(response.status).toBe(409);
    expect(vi.mocked(getIdempotentRosterExport).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getRosterSourceSnapshot).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(commitRosterExport).not.toHaveBeenCalled();
  });

  it("revalidates current rows and blocks export when hard issues remain", async () => {
    const response = await handleRosterExport(MAPPING_ID, exportInput, ctx());

    expect(response.status).toBe(422);
    expect((await envelope(response)).error).toMatch(/invalid/i);
    expect(getRosterSourceSnapshot).toHaveBeenCalledTimes(1);
    expect(commitRosterExport).not.toHaveBeenCalled();
  });

  it("returns an idempotent replay before reading source rows and rejects conflicting reuse", async () => {
    vi.mocked(getIdempotentRosterExport).mockResolvedValue(snapshot);
    const replay = await handleRosterExport(MAPPING_ID, exportInput, ctx());
    expect(replay.status).toBe(200);
    expect((await envelope(replay)).data).toEqual(snapshot);
    expect(getIdempotentRosterExport).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, actorId: USER_ID }),
      MAPPING_ID,
      IDEMPOTENCY_KEY,
      FINGERPRINT,
      "csv",
    );
    expect(getRosterSourceSnapshot).not.toHaveBeenCalled();
    expect(commitRosterExport).not.toHaveBeenCalled();

    vi.mocked(getIdempotentRosterExport).mockRejectedValue(
      new Error("roster_idempotency_conflict"),
    );
    const conflict = await handleRosterExport(MAPPING_ID, exportInput, ctx());
    expect(conflict.status).toBe(409);
    expect(getRosterSourceSnapshot).not.toHaveBeenCalled();
  });

  it("streams the original export bytes with a safe download header and digest", async () => {
    const bytes = Uint8Array.from([0x41, 0x2c, 0x42, 0x0d, 0x0a, 0x30, 0x30, 0x31]);
    vi.mocked(getRosterExportFile).mockResolvedValue({
      fileName: 'roster"\r\n.csv',
      format: "csv",
      bytes,
      checksum: "d".repeat(64),
    });

    const response = await handleRosterDownload(snapshot.id, ctx("billing", "org-reader"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="roster___.csv"',
    );
    expect(response.headers.get("x-content-sha256")).toBe("d".repeat(64));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(getRosterExportFile).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-reader", actorId: USER_ID }),
      snapshot.id,
    );
  });
});
