import { beforeEach, describe, expect, it, vi } from "vitest";
import { camelizeRow } from "@/lib/case";
import type { StateLicense } from "@/services/lookups";

const transport = vi.hoisted(() => ({ fetch: vi.fn(), audit: vi.fn() }));
vi.mock("@/integrations/supabase/externalClient", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("http://127.0.0.1:1", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (...args) => transport.fetch(...args) },
    }),
  };
});
vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  writeAudit: (...args: unknown[]) => transport.audit(...args),
}));

import { updateProviderWithLicenses } from "./providers";

type Row = Record<string, unknown>;
const license = (id: string, state: string): Row => ({
  id,
  org_id: "org-1",
  provider_id: "p1",
  state,
  license_number: `${state}-123`,
  license_type: "full",
  issue_date: null,
  expiration_date: "2030-01-01",
  status: "active",
  created_at: "2026-01-01T00:00:00+00:00",
  verified_status: "unverified",
  verified_at: null,
  verified_by: null,
  verification_source_url: null,
});
const values = (row: Row) => {
  const l = camelizeRow<StateLicense>(row);
  return {
    state: l.state,
    licenseNumber: l.licenseNumber,
    licenseType: l.licenseType,
    issueDate: l.issueDate,
    expirationDate: l.expirationDate,
    verifiedStatus: l.verifiedStatus,
    verificationSourceUrl: l.verificationSourceUrl,
  };
};

function fixture() {
  const rows: Record<string, Row[]> = {
    providers: [
      {
        id: "p1",
        org_id: "org-1",
        first_name: "Synthetic",
        last_name: "Provider",
        npi: "1234567893",
      },
    ],
    state_licenses: [license("l1", "CO"), license("l2", "TX")],
    provider_group_assignments: [1, 2, 3].map((n) => ({
      id: `a${n}`,
      org_id: "org-1",
      provider_id: "p1",
      group_id: `g${n}`,
      is_primary: n === 1,
    })),
  };
  const requests: Array<{ table: string; method: string; url: URL; body: unknown }> = [];
  let before: ((table: string, method: string) => Response | undefined) | undefined;
  transport.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").at(-1)!;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ table, method, url, body });
    const intercepted = before?.(table, method);
    if (intercepted) return intercepted;
    const matches = (r: Row) =>
      [...url.searchParams].every(([key, raw]) => {
        if (["select", "order", "limit", "offset"].includes(key)) return true;
        if (!(key in r)) throw new Error(`Missing fixture column ${key}`);
        if (raw.startsWith("eq.")) return r[key] !== null && String(r[key]) === raw.slice(3);
        if (raw === "is.null") return r[key] === null;
        if (raw.startsWith("in.(")) return raw.slice(4, -1).split(",").includes(String(r[key]));
        throw new Error(`Unsupported fixture filter ${raw}`);
      });
    let result = (rows[table] ?? []).filter(matches);
    if (method === "POST") {
      result = (Array.isArray(body) ? body : [body]).map((r: Row, i: number) => ({
        ...(table === "state_licenses"
          ? license(`new-${rows[table].length + i}`, String(r.state))
          : {}),
        ...r,
      }));
      rows[table].push(...result);
    } else if (method === "PATCH") {
      result.forEach((r) => Object.assign(r, body));
    } else if (method === "DELETE") {
      rows[table] = rows[table].filter((r) => !result.includes(r));
    }
    const single = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object");
    return new Response(JSON.stringify(single ? (result[0] ?? null) : result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  transport.audit.mockResolvedValue(undefined);
  return {
    rows,
    requests,
    intercept(fn: typeof before) {
      before = fn;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("P03 license preservation", () => {
  it("preserves two stored licenses when an unavailable UI supplies only the intended third add", async () => {
    const f = fixture();
    const original = structuredClone(f.rows.state_licenses);
    await updateProviderWithLicenses("p1", {
      patch: {},
      licenseCommands: [{ type: "add", values: values(license("l3", "CA")) }],
    });
    expect(f.rows.state_licenses).toHaveLength(3);
    expect(f.rows.state_licenses).toEqual(expect.arrayContaining(original));
  });
});

const expected = (row: Row) => camelizeRow<StateLicense>(structuredClone(row));
const updateCommand = (row: Row, patch: Partial<ReturnType<typeof values>> = {}) => ({
  type: "update" as const,
  id: String(row.id),
  expected: expected(row),
  values: { ...values(row), ...patch },
});
const removeCommand = (row: Row) => ({
  type: "remove" as const,
  id: String(row.id),
  expected: expected(row),
});
const rejected = (message = "Synthetic write failure") =>
  new Response(JSON.stringify({ code: "P0001", message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
const save = (
  licenseCommands: Parameters<typeof updateProviderWithLicenses>[1]["licenseCommands"],
) => updateProviderWithLicenses("p1", { patch: {}, licenseCommands });

describe("P03 explicit commands and persisted outcomes", () => {
  it("adds to a successfully empty list", async () => {
    const f = fixture();
    f.rows.state_licenses = [];
    await save([{ type: "add", values: values(license("new", "AZ")) }]);
    expect(f.rows.state_licenses).toHaveLength(1);
    expect(f.rows.state_licenses[0]).toMatchObject({
      state: "AZ",
      org_id: "org-1",
      provider_id: "p1",
    });
  });

  it("edits only the target while preserving every unrelated value and all relationships", async () => {
    const f = fixture();
    const unrelated = structuredClone(f.rows.state_licenses[1]);
    const provider = structuredClone(f.rows.providers);
    const assignments = structuredClone(f.rows.provider_group_assignments);
    await save([updateCommand(f.rows.state_licenses[0], { licenseNumber: "CO-456" })]);
    expect(f.rows.state_licenses[0].license_number).toBe("CO-456");
    expect(f.rows.state_licenses[1]).toEqual(unrelated);
    expect(f.rows.providers).toEqual(provider);
    expect(f.rows.provider_group_assignments).toEqual(assignments);
  });

  it("unchanged licenses generate no updates and omission generates no removals", async () => {
    const f = fixture();
    const original = structuredClone(f.rows);
    await save([updateCommand(f.rows.state_licenses[0])]);
    await save([]);
    expect(f.rows).toEqual(original);
    expect(f.requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(transport.audit).not.toHaveBeenCalled();
  });

  it("explicit single-ID removal preserves another provider, organization, and unrelated license", async () => {
    const f = fixture();
    f.rows.state_licenses.push(
      { ...license("other-provider", "CA"), provider_id: "p2" },
      { ...license("other-org", "NV"), org_id: "org-2" },
    );
    const unrelated = structuredClone(f.rows.state_licenses.slice(1));
    await save([removeCommand(f.rows.state_licenses[0])]);
    expect(f.rows.state_licenses).toEqual(unrelated);
    expect(transport.audit.mock.calls[0][0].after.diff).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 1,
    });
  });

  it.each(["missing", "wrong-provider", "wrong-org", "incomplete"])(
    "rejects %s snapshots before any mutation",
    async (mode) => {
      const f = fixture();
      const original = structuredClone(f.rows);
      const command = updateCommand(f.rows.state_licenses[0], { licenseNumber: "EDIT" });
      if (mode === "missing") {
        command.id = "missing";
        command.expected.id = "missing";
      }
      if (mode === "wrong-provider") command.expected.providerId = "p2";
      if (mode === "wrong-org") command.expected.orgId = "org-2";
      if (mode === "incomplete") delete (command.expected as Partial<StateLicense>).verifiedAt;
      await expect(save([command])).rejects.toMatchObject({ requiresReload: true });
      expect(f.rows).toEqual(original);
      expect(f.requests.filter((r) => r.method !== "GET")).toEqual([]);
      expect(transport.audit).not.toHaveBeenCalled();
    },
  );

  it.each([
    "state",
    "licenseNumber",
    "licenseType",
    "issueDate",
    "expirationDate",
    "status",
    "createdAt",
    "verifiedStatus",
    "verifiedAt",
    "verifiedBy",
    "verificationSourceUrl",
  ] as const)(
    "rejects a stale %s baseline including nullable verification fields",
    async (field) => {
      const f = fixture();
      const original = structuredClone(f.rows);
      const command = updateCommand(f.rows.state_licenses[0], { licenseNumber: "EDIT" });
      Object.assign(command.expected, { [field]: "changed-after-edit-start" });
      await expect(save([command])).rejects.toMatchObject({ requiresReload: true });
      expect(f.rows).toEqual(original);
      expect(f.requests.filter((r) => r.method !== "GET")).toEqual([]);
    },
  );

  it.each(["add", "edit"])(
    "preserves an unrelated concurrent %s after service preflight",
    async (mode) => {
      const f = fixture();
      const command = updateCommand(f.rows.state_licenses[0], { licenseNumber: "NEW" });
      let injected = false;
      f.intercept((table, method) => {
        if (table === "state_licenses" && method === "PATCH" && !injected) {
          injected = true;
          if (mode === "add") f.rows.state_licenses.push(license("concurrent", "AZ"));
          else f.rows.state_licenses[1].license_number = "CONCURRENT-EDIT";
        }
        return undefined;
      });
      await save([command]);
      expect(f.rows.state_licenses[0].license_number).toBe("NEW");
      if (mode === "add") expect(f.rows.state_licenses.map((r) => r.id)).toContain("concurrent");
      else expect(f.rows.state_licenses[1].license_number).toBe("CONCURRENT-EDIT");
    },
  );

  it.each(["changed", "deleted", "null-changed"])(
    "rejects a target %s after service read before update",
    async (mode) => {
      const f = fixture();
      const command = updateCommand(f.rows.state_licenses[0], { licenseNumber: "STALE" });
      const unrelated = structuredClone(f.rows.state_licenses[1]);
      f.intercept((table, method) => {
        if (table === "state_licenses" && method === "PATCH") {
          if (mode === "deleted")
            f.rows.state_licenses = f.rows.state_licenses.filter((r) => r.id !== "l1");
          else if (mode === "null-changed")
            f.rows.state_licenses[0].verified_by = "concurrent-verifier";
          else f.rows.state_licenses[0].license_number = "CONCURRENT";
        }
        return undefined;
      });
      await expect(save([command])).rejects.toMatchObject({ requiresReload: true });
      expect(f.rows.state_licenses).toContainEqual(unrelated);
      expect(f.rows.state_licenses.some((r) => r.license_number === "STALE")).toBe(false);
      if (mode === "deleted") expect(f.rows.state_licenses.some((r) => r.id === "l1")).toBe(false);
    },
  );

  it("rejects a stale removal after the service read", async () => {
    const f = fixture();
    const command = removeCommand(f.rows.state_licenses[0]);
    f.intercept((table, method) => {
      if (table === "state_licenses" && method === "DELETE")
        f.rows.state_licenses[0].issue_date = "2026-02-01";
      return undefined;
    });
    await expect(save([command])).rejects.toMatchObject({ requiresReload: true });
    expect(f.rows.state_licenses).toHaveLength(2);
    expect(f.rows.state_licenses[0].issue_date).toBe("2026-02-01");
  });

  it.each(["providers", "state_licenses", "provider_group_assignments"])(
    "failed required %s read causes zero writes",
    async (table) => {
      const f = fixture();
      const original = structuredClone(f.rows);
      f.intercept((name, method) =>
        name === table && method === "GET" ? rejected("Read failed") : undefined,
      );
      await expect(
        updateProviderWithLicenses("p1", {
          patch: { firstName: "Changed" },
          licenseCommands: [{ type: "add", values: values(license("l3", "CA")) }],
          groupAssignments: [{ groupId: "g1", isPrimary: true }],
        }),
      ).rejects.toBeDefined();
      expect(f.rows).toEqual(original);
      expect(f.requests.filter((r) => r.method !== "GET")).toEqual([]);
      expect(transport.audit).not.toHaveBeenCalled();
    },
  );

  it.each(["insert", "update", "delete"])(
    "propagates failed %s without reporting success",
    async (operation) => {
      const f = fixture();
      const original = structuredClone(f.rows);
      const command =
        operation === "insert"
          ? { type: "add" as const, values: values(license("l3", "CA")) }
          : operation === "update"
            ? updateCommand(f.rows.state_licenses[0], { licenseNumber: "NEW" })
            : removeCommand(f.rows.state_licenses[0]);
      f.intercept((table, method) =>
        table === "state_licenses" && method !== "GET" ? rejected() : undefined,
      );
      await expect(save([command])).rejects.toMatchObject({ requiresReload: true });
      expect(f.rows).toEqual(original);
      expect(transport.audit.mock.calls[0][0].after).toMatchObject({
        outcome: "incomplete",
        applied: [],
        diff: { inserted: 0, updated: 0, deleted: 0 },
      });
    },
  );

  it("later write failure audits only confirmed effects and preserves unrelated rows", async () => {
    const f = fixture();
    const original = structuredClone(f.rows.state_licenses);
    f.intercept((table, method) =>
      table === "state_licenses" && method === "PATCH" ? rejected() : undefined,
    );
    await expect(
      save([
        { type: "add", values: values(license("l3", "CA")) },
        updateCommand(f.rows.state_licenses[0], { licenseNumber: "UNSAVED" }),
      ]),
    ).rejects.toMatchObject({
      requiresReload: true,
      outcome: { failedStage: "license:update", auditStatus: "recorded" },
    });
    expect(f.rows.state_licenses).toHaveLength(3);
    expect(f.rows.state_licenses).toEqual(expect.arrayContaining(original));
    const audit = transport.audit.mock.calls[0][0];
    expect(audit.after.diff).toEqual({ inserted: 1, updated: 0, deleted: 0 });
    expect(audit.after.applied).toHaveLength(1);
    expect(audit.after.applied[0].after[0]).toMatchObject({ state: "CA" });
    expect(JSON.stringify(audit)).not.toContain("UNSAVED");
  });

  it("reports audit failure after successful persistence and blocks blind retry", async () => {
    const f = fixture();
    transport.audit.mockRejectedValue(new Error("Audit failed"));
    await expect(
      save([{ type: "add", values: values(license("l3", "CA")) }]),
    ).rejects.toMatchObject({
      requiresReload: true,
      outcome: { failedStage: "audit", auditStatus: "failed" },
    });
    expect(f.rows.state_licenses).toHaveLength(3);
  });

  it("preserves both later-write and audit failure evidence", async () => {
    const f = fixture();
    transport.audit.mockRejectedValue(new Error("Audit failed"));
    f.intercept((table, method) =>
      table === "state_licenses" && method === "PATCH" ? rejected("License failed") : undefined,
    );
    await expect(
      save([
        { type: "add", values: values(license("l3", "CA")) },
        updateCommand(f.rows.state_licenses[0], { licenseNumber: "UNSAVED" }),
      ]),
    ).rejects.toMatchObject({
      message: expect.stringContaining("audit record could not be saved"),
      outcome: { failedStage: "license:update", auditStatus: "failed" },
    });
    expect(f.rows.state_licenses).toHaveLength(3);
  });

  it("retains PSV stamps on ordinary edits and resets verification only on renewal", async () => {
    const f = fixture();
    Object.assign(f.rows.state_licenses[0], {
      verified_status: "verified",
      verified_at: "2026-01-02T00:00:00+00:00",
      verified_by: "original-verifier",
    });
    await save([updateCommand(f.rows.state_licenses[0], { licenseNumber: "CO-NEW" })]);
    expect(f.rows.state_licenses[0]).toMatchObject({
      verified_status: "verified",
      verified_at: "2026-01-02T00:00:00+00:00",
      verified_by: "original-verifier",
    });
    await save([updateCommand(f.rows.state_licenses[0], { expirationDate: "2031-01-01" })]);
    expect(f.rows.state_licenses[0]).toMatchObject({
      verified_status: "unverified",
      verified_at: null,
      verified_by: null,
    });
  });

  it("rejects the obsolete replacement-list contract without any writes", async () => {
    const f = fixture();
    const original = structuredClone(f.rows);
    await expect(
      updateProviderWithLicenses("p1", { patch: {}, licenses: [] } as unknown as Parameters<
        typeof updateProviderWithLicenses
      >[1]),
    ).rejects.toThrow("Explicit license changes");
    expect(f.rows).toEqual(original);
    expect(f.requests).toEqual([]);
  });
});
