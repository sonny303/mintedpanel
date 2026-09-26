import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  getIdempotentRosterExport,
  getRosterExportFile,
  getRosterMappingRecord,
  listRosterExportSnapshots,
  listRosterOverrides,
  type RosterEngineDataCtx,
} from "./rosterEngineData";

interface QueryCapture {
  table: string;
  select?: string;
  filters: Array<[string, unknown]>;
  orders: Array<[string, { ascending?: boolean } | undefined]>;
  range?: [number, number];
}

function fakeDb(
  respond: (capture: QueryCapture) => { data: unknown; error?: { message: string } | null },
) {
  const captures: QueryCapture[] = [];
  const db = {
    from(table: string) {
      const capture: QueryCapture = { table, filters: [], orders: [] };
      captures.push(capture);
      const builder: Record<string, unknown> = {
        select(columns: string) {
          capture.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          capture.filters.push([column, value]);
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          capture.orders.push([column, options]);
          return builder;
        },
        range(from: number, to: number) {
          capture.range = [from, to];
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(respond(capture));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(respond(capture)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, captures };
}

function ctx(db: SupabaseClient<Database>, orgId = "org-1"): RosterEngineDataCtx {
  return { db, orgId, actorId: "user-1" };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const ownedBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ownedBytes).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", ownedBytes);
  return hex(new Uint8Array(digest));
}

describe("roster engine data access", () => {
  it("scopes mapping reads by both mapping ID and the caller organization", async () => {
    const { db, captures } = fakeDb(() => ({ data: null }));
    const result = await getRosterMappingRecord(ctx(db, "org-caller"), "mapping-other-org");
    expect(result).toBeNull();
    expect(captures[0]?.table).toBe("roster_mappings");
    expect(captures[0]?.filters).toContainEqual(["org_id", "org-caller"]);
    expect(captures[0]?.filters).toContainEqual(["id", "mapping-other-org"]);
  });

  it("reads overrides in bounded pages with organization, mapping, revision, and fingerprint filters", async () => {
    const dbRows = (start: number, count: number) =>
      Array.from({ length: count }, (_, offset) => {
        const index = start + offset;
        return {
          id: `override-${index}`,
          mapping_id: "mapping-1",
          mapping_revision: 7,
          input_fingerprint: "f".repeat(64),
          row_key: `provider-${index}:facility-1`,
          rule_code: "provider_npi_invalid",
          field_key: "provider.npi",
          reason: `Approved exception reason number ${index} for audit review.`,
          created_at: "2026-09-25T12:00:00Z",
        };
      });
    const { db, captures } = fakeDb((capture) => ({
      data: capture.range?.[0] === 0 ? dbRows(0, 500) : dbRows(500, 1),
    }));

    const rows = await listRosterOverrides(ctx(db, "org-1"), "mapping-1", 7, "f".repeat(64));

    expect(rows).toHaveLength(501);
    expect(rows[0]).toMatchObject({ id: "override-0", revision: 7, fieldKey: "provider.npi" });
    expect(rows.at(-1)?.id).toBe("override-500");
    expect(captures.map((capture) => capture.range)).toEqual([
      [0, 499],
      [500, 999],
    ]);
    for (const capture of captures) {
      expect(capture.table).toBe("roster_export_overrides");
      expect(capture.filters).toContainEqual(["org_id", "org-1"]);
      expect(capture.filters).toContainEqual(["mapping_id", "mapping-1"]);
      expect(capture.filters).toContainEqual(["mapping_revision", 7]);
      expect(capture.filters).toContainEqual(["input_fingerprint", "f".repeat(64)]);
    }
  });

  it("preserves frozen template verification and export metadata in history", async () => {
    const row = {
      id: "snapshot-1",
      mapping_id: "mapping-1",
      template_id: "template-1",
      mapping_name: "Frozen mapping label",
      template_name: "Frozen payer schema name",
      template_is_verified: false,
      template_verification_status: "draft_pending_payer_spec",
      exported_by: "user-1",
      exported_at: "2026-09-25T12:00:00Z",
      format: "csv",
      file_name: "roster.csv",
      total_rows: 42,
      sha256: "a".repeat(64),
      applied_overrides: [{ id: "override-1" }],
    };
    const { db, captures } = fakeDb(() => ({ data: [row] }));

    const history = await listRosterExportSnapshots(ctx(db, "org-1"));

    expect(history[0]).toMatchObject({
      id: "snapshot-1",
      mappingName: "Frozen mapping label",
      templateName: "Frozen payer schema name",
      templateVerified: false,
      templateVerificationStatus: "draft_pending_payer_spec",
      exportedBy: "user-1",
      appliedOverrides: 1,
    });
    expect(captures[0]?.filters).toContainEqual(["org_id", "org-1"]);
    expect(captures[0]?.select).toContain("mapping_name");
    expect(captures[0]?.select).toContain("template_is_verified");
  });

  it("returns the original stored bytes only after validating their checksum", async () => {
    const bytes = new TextEncoder().encode("A,B\r\n001,Example\r\n");
    const stored = `\\x${hex(bytes)}`;
    const checksum = await sha256(bytes);
    const { db, captures } = fakeDb(() => ({
      data: { file_name: "frozen.csv", format: "csv", file_bytes: stored, sha256: checksum },
    }));

    const file = await getRosterExportFile(ctx(db, "org-download"), "snapshot-1");

    expect(file?.bytes).toEqual(bytes);
    expect(file?.fileName).toBe("frozen.csv");
    expect(file?.checksum).toBe(checksum);
    expect(captures[0]?.filters).toContainEqual(["org_id", "org-download"]);
    expect(captures[0]?.filters).toContainEqual(["id", "snapshot-1"]);
  });

  it("rejects an export-history artifact if stored bytes no longer match its digest", async () => {
    const bytes = new TextEncoder().encode("tampered bytes");
    const { db } = fakeDb(() => ({
      data: {
        file_name: "frozen.csv",
        format: "csv",
        file_bytes: `\\x${hex(bytes)}`,
        sha256: "0".repeat(64),
      },
    }));

    await expect(getRosterExportFile(ctx(db), "snapshot-1")).rejects.toThrow(
      "Stored roster artifact checksum does not match",
    );
  });

  it("loads an existing idempotency key with its full actor and content binding", async () => {
    const { db, captures } = fakeDb(() => ({
      data: {
        id: "snapshot-1",
        mapping_id: "mapping-1",
        template_id: "template-1",
        mapping_name: "Frozen mapping",
        template_name: "Frozen template",
        template_is_verified: false,
        template_verification_status: "draft_pending_payer_spec",
        exported_by: "user-1",
        exported_at: "2026-09-25T12:00:00Z",
        format: "xlsx",
        file_name: "roster.xlsx",
        total_rows: 3,
        sha256: "b".repeat(64),
        applied_overrides: [],
        expected_input_fingerprint: "c".repeat(64),
      },
    }));

    const existing = await getIdempotentRosterExport(
      ctx(db, "org-1"),
      "mapping-1",
      "33333333-3333-4333-8333-333333333333",
      "c".repeat(64),
      "xlsx",
    );

    expect(existing).toMatchObject({
      id: "snapshot-1",
      format: "xlsx",
      mappingName: "Frozen mapping",
      templateVerified: false,
    });
    expect(captures[0]?.filters).toContainEqual(["org_id", "org-1"]);
    expect(captures[0]?.filters).toContainEqual([
      "idempotency_key",
      "33333333-3333-4333-8333-333333333333",
    ]);
  });

  it.each([
    {
      mappingId: "mapping-other",
      actorId: "user-1",
      fingerprint: "c".repeat(64),
      format: "xlsx" as const,
    },
    {
      mappingId: "mapping-1",
      actorId: "user-other",
      fingerprint: "c".repeat(64),
      format: "xlsx" as const,
    },
    {
      mappingId: "mapping-1",
      actorId: "user-1",
      fingerprint: "d".repeat(64),
      format: "xlsx" as const,
    },
    {
      mappingId: "mapping-1",
      actorId: "user-1",
      fingerprint: "c".repeat(64),
      format: "csv" as const,
    },
  ])(
    "rejects an idempotency replay with a mismatched mapping, actor, fingerprint, or format",
    async (binding) => {
      const { db } = fakeDb(() => ({
        data: {
          id: "snapshot-1",
          mapping_id: "mapping-1",
          template_id: "template-1",
          mapping_name: "Frozen mapping",
          template_name: "Frozen template",
          template_is_verified: false,
          template_verification_status: "draft_pending_payer_spec",
          exported_by: "user-1",
          exported_at: "2026-09-25T12:00:00Z",
          format: "xlsx",
          file_name: "roster.xlsx",
          total_rows: 3,
          sha256: "b".repeat(64),
          applied_overrides: [],
          expected_input_fingerprint: "c".repeat(64),
        },
      }));

      await expect(
        getIdempotentRosterExport(
          { ...ctx(db), actorId: binding.actorId },
          binding.mappingId,
          "33333333-3333-4333-8333-333333333333",
          binding.fingerprint,
          binding.format,
        ),
      ).rejects.toThrow("roster_idempotency_conflict");
    },
  );
});
