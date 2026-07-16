// E4.2 payer governance — org_payer_settings service boundary: org_id always
// comes from the active org (never the caller), the upsert rides the
// (org_id, payer_id) unique key, and every write is audited (CREATE on first
// set, UPDATE thereafter, with the before row captured). Org isolation and the
// admin-only write rule are RLS properties verified live (rolled-back
// simulation on hosted — recorded in the PR); here we pin the service
// contract that rides them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, writeAuditMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  writeAuditMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  writeAudit: writeAuditMock,
}));

import { listOrgPayerSettings, upsertOrgPayerSetting } from "./orgPayerSettings";

interface Recorded {
  method: string;
  args: unknown[];
}

function chainFor(log: Recorded[], result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "upsert", "eq"]) {
    chain[method] = (...args: unknown[]) => {
      log.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return chain;
}

beforeEach(() => {
  fromMock.mockReset();
  writeAuditMock.mockReset();
});

describe("listOrgPayerSettings", () => {
  it("scopes the read to the active org", async () => {
    const log: Recorded[] = [];
    fromMock.mockReturnValue(chainFor(log, { data: [], error: null }));
    await listOrgPayerSettings();
    expect(log.filter((e) => e.method === "eq").map((e) => e.args)).toContainEqual([
      "org_id",
      "org-1",
    ]);
  });
});

describe("upsertOrgPayerSetting", () => {
  it("first set: org_id from the active org, (org_id, payer_id) conflict key, CREATE audit", async () => {
    const readLog: Recorded[] = [];
    const writeLog: Recorded[] = [];
    const stored = {
      id: "s-1",
      org_id: "org-1",
      payer_id: "payer-9",
      resolution_id_label: "Provider PIN",
      resolution_id_expected: true,
    };
    fromMock
      .mockReturnValueOnce(chainFor(readLog, { data: null, error: null }))
      .mockReturnValueOnce(chainFor(writeLog, { data: stored, error: null }));

    const after = await upsertOrgPayerSetting({
      payerId: "payer-9",
      resolutionIdLabel: "Provider PIN",
      resolutionIdExpected: true,
    });
    expect(after.orgId).toBe("org-1");

    const upsertCall = writeLog.find((e) => e.method === "upsert");
    expect(upsertCall).toBeDefined();
    const [payload, options] = upsertCall?.args as [
      Record<string, unknown>,
      { onConflict: string },
    ];
    expect(payload).toMatchObject({
      org_id: "org-1",
      payer_id: "payer-9",
      resolution_id_label: "Provider PIN",
      resolution_id_expected: true,
      updated_by: "user-1",
    });
    expect(options.onConflict).toBe("org_id,payer_id");

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock.mock.calls[0][0]).toMatchObject({
      actionType: "CREATE",
      entityType: "org_payer_setting",
      entityId: "s-1",
      before: null,
    });
  });

  it("re-set: audits UPDATE with the before row", async () => {
    const existing = {
      id: "s-1",
      org_id: "org-1",
      payer_id: "payer-9",
      resolution_id_label: "Old label",
      resolution_id_expected: true,
    };
    const readLog: Recorded[] = [];
    const writeLog: Recorded[] = [];
    fromMock
      .mockReturnValueOnce(chainFor(readLog, { data: existing, error: null }))
      .mockReturnValueOnce(
        chainFor(writeLog, {
          data: { ...existing, resolution_id_label: "New label" },
          error: null,
        }),
      );

    await upsertOrgPayerSetting({
      payerId: "payer-9",
      resolutionIdLabel: "New label",
      resolutionIdExpected: true,
    });
    expect(writeAuditMock.mock.calls[0][0]).toMatchObject({
      actionType: "UPDATE",
      entityType: "org_payer_setting",
      before: { resolutionIdLabel: "Old label" },
    });
  });
});
