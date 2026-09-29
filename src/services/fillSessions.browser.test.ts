import { beforeEach, describe, expect, it, vi } from "vitest";

const browserDeps = vi.hoisted(() => ({
  activeOrgId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  supabase: { from: vi.fn() },
  writeAudit: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: browserDeps.supabase }));
vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => browserDeps.activeOrgId,
  currentUserId: () => browserDeps.userId,
  writeAudit: browserDeps.writeAudit,
}));

import { recordPayerFormFill } from "./fillSessions";
import type { FillEventV2Metadata } from "@/types/fillEventV2";

const event: FillEventV2Metadata = {
  schemaVersion: 2,
  fieldsAttempted: 0,
  fieldsVerified: 0,
  fieldsRejected: 0,
  fieldOutcomes: [],
};

function fillInput(isCurrent?: () => boolean) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    orgId: browserDeps.activeOrgId,
    userId: browserDeps.userId,
    caseId: "44444444-4444-4444-8444-444444444444",
    providerId: null,
    portalKey: "payer-form:family",
    startedAt: "2026-09-25T12:00:00.000Z",
    completedAt: "2026-09-25T12:01:00.000Z",
    event,
    isCurrent,
  };
}

function existingRow() {
  return {
    id: fillInput().id,
    org_id: browserDeps.activeOrgId,
    case_id: fillInput().caseId,
    provider_id: null,
    portal_key: "payer-form:family",
    fill_mode: "pdf",
    started_at: "2026-09-25T12:00:00+00:00",
    completed_at: "2026-09-25T12:01:00+00:00",
    fields_filled: 0,
    fields_skipped: [],
    docs_attached: null,
    performed_by: browserDeps.userId,
    is_test: false,
    event_schema_version: 2,
    fields_attempted: 0,
    fields_verified: 0,
    fields_rejected: 0,
    field_outcomes: [],
  };
}

function setLookup(data: Record<string, unknown> | null | Promise<Record<string, unknown> | null>) {
  const insert = vi.fn(() => {
    throw new Error("unexpected insert");
  });
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: await data, error: null }),
    insert,
  };
  browserDeps.supabase.from.mockReturnValue(query);
  return { insert };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  browserDeps.activeOrgId = "11111111-1111-4111-8111-111111111111";
  browserDeps.userId = "22222222-2222-4222-8222-222222222222";
});

describe("browser PDF fill persistence", () => {
  it("accepts equivalent Postgres and ISO timestamp offsets on an immutable retry", async () => {
    const { insert } = setLookup(existingRow());

    const result = await recordPayerFormFill(fillInput());

    expect(result.id).toBe(fillInput().id);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not dispatch an insert when the run becomes stale during the lookup", async () => {
    const lookup = deferred<Record<string, unknown> | null>();
    const { insert } = setLookup(lookup.promise);
    let current = true;
    const operation = recordPayerFormFill(fillInput(() => current));
    await Promise.resolve();
    current = false;
    lookup.resolve(null);

    await expect(operation).rejects.toThrow(
      "fill context changed before its result could be recorded",
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
