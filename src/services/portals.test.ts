import { describe, it, expect, vi, beforeEach } from "vitest";

// createPortal is a browser-path service (it imports the anon client + audit
// helpers directly, no injected ctx). Mock both so this suite observes the exact
// insert payload — specifically that a hand-typed portal_key is folded (trim +
// lowercase) at the write boundary, matching how SOP `online_form` steps
// normalize their portalKey so the step ↔ portal join is a literal string
// compare (and the extension can close the right task on submit).
const holder = vi.hoisted(() => ({
  from: (_table: string): unknown => {
    throw new Error("no fake db installed");
  },
}));
const writeAuditMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (table: string) => holder.from(table), rpc: rpcMock },
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: writeAuditMock,
  requireActiveOrg: () => "org-1",
}));

import { createPortal, updatePortalName, updatePortalPayer, upsertGlobalPortal } from "./portals";

interface Captured {
  table: string;
  op?: "insert" | "update";
  payload?: Record<string, unknown>;
  eqs?: Array<[string, unknown]>;
}

// Minimal chainable fake for createPortal's one shape:
// from("portals").insert(payload).select(cols).single().
function installDb(created: Record<string, unknown>): Captured[] {
  const captures: Captured[] = [];
  holder.from = (table: string) => {
    const cap: Captured = { table, eqs: [] };
    captures.push(cap);
    const builder: Record<string, unknown> = {
      insert(payload: Record<string, unknown>) {
        cap.op = "insert";
        cap.payload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        cap.op = "update";
        cap.payload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        cap.eqs?.push([col, val]);
        return builder;
      },
      select() {
        return builder;
      },
      single: () => Promise.resolve({ data: created, error: null }),
    };
    return builder;
  };
  return captures;
}

const CREATED_ROW = {
  id: "portal-1",
  org_id: "org-1",
  portal_key: "bcbs_ks_enrollment",
  name: "BCBS KS Enrollment",
  payer_id: null,
  form_url: null,
  is_verified: false,
  last_verified_at: null,
  url_changed_at: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  writeAuditMock.mockClear();
  rpcMock.mockReset();
});

describe("createPortal", () => {
  it("folds a hand-typed portal_key (trim + lowercase) at the write boundary", async () => {
    const captures = installDb(CREATED_ROW);

    await createPortal({ name: "  BCBS KS Enrollment  ", portalKey: "  BCBS_KS_Enrollment  " });

    expect(captures[0].op).toBe("insert");
    expect(captures[0].payload).toMatchObject({
      org_id: "org-1",
      name: "BCBS KS Enrollment",
      portal_key: "bcbs_ks_enrollment",
    });
  });

  it("stores a blank/whitespace-only portal_key as an empty string, never null", async () => {
    const captures = installDb({ ...CREATED_ROW, portal_key: "" });

    await createPortal({ name: "Placeholder", portalKey: "   " });

    // normalizePortalKey collapses blank to null; the write boundary coalesces
    // to "" so the NOT NULL portal_key column always gets a string.
    expect(captures[0].payload?.portal_key).toBe("");
  });

  it("persists typed configurations empty, unverified, and explicit-only", async () => {
    const captures = installDb({
      ...CREATED_ROW,
      case_type: "enrollment",
      requires_explicit_selection: true,
      proven_at: null,
      mapping_generation: 1,
    });

    await createPortal({
      name: "BCBS KS Enrollment",
      portalKey: "bcbs-ks-enrollment-enrollment-a1b2c3d4",
      payerId: "payer-1",
      formUrl: "https://payer.example/form",
      caseType: "enrollment",
    });

    expect(captures[0].payload).toMatchObject({
      case_type: "enrollment",
      requires_explicit_selection: true,
      payer_id: "payer-1",
      form_url: "https://payer.example/form",
      is_verified: false,
      last_verified_at: null,
      proven_at: null,
    });
  });
});

describe("configuration rename and global creation", () => {
  const typedPortal = {
    id: "portal-1",
    orgId: "org-1",
    portalKey: "bcbs_ks_enrollment_enrollment_a1b2c3d4",
    name: "Old display name",
    payerId: "payer-1",
    formUrl: "https://payer.example/form",
    caseType: "enrollment" as const,
    requiresExplicitSelection: true,
    mappingGeneration: 1,
    isVerified: false,
    lastVerifiedAt: null,
    provenAt: null,
    urlChangedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };

  it("renames an org config by updating only its name, preserving the bound key", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...CREATED_ROW,
        portal_key: typedPortal.portalKey,
        name: "New display name",
        case_type: "enrollment",
        requires_explicit_selection: true,
        mapping_generation: 1,
      },
      error: null,
    });

    const renamed = await updatePortalName(typedPortal, " New display name ");

    expect(rpcMock).toHaveBeenCalledWith(
      "update_org_portal_configuration",
      expect.objectContaining({
        p_org_id: "org-1",
        p_id: "portal-1",
        p_expected_mapping_generation: 1,
        p_patch: { name: "New display name" },
      }),
    );
    expect(renamed.portalKey).toBe(typedPortal.portalKey);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        after: { name: "New display name", portalKey: typedPortal.portalKey },
      }),
    );
  });

  it("creates a global config with its selected case type", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...CREATED_ROW,
        org_id: null,
        portal_key: typedPortal.portalKey,
        case_type: "enrollment",
        requires_explicit_selection: true,
      },
      error: null,
    });

    await upsertGlobalPortal({
      name: "BCBS KS Enrollment",
      portalKey: typedPortal.portalKey,
      payerId: "payer-1",
      formUrl: "https://payer.example/form",
      caseType: "enrollment",
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "upsert_global_portal",
      expect.objectContaining({ p_case_type: "enrollment", p_portal_key: typedPortal.portalKey }),
    );
  });

  it("renames a global config through its stable key and case type", async () => {
    rpcMock.mockResolvedValue({
      data: { ...CREATED_ROW, org_id: null, name: "New display name" },
      error: null,
    });

    const renamed = await updatePortalName({ ...typedPortal, orgId: null }, "New display name");

    expect(renamed.name).toBe("New display name");
    expect(rpcMock).toHaveBeenCalledWith(
      "upsert_global_portal",
      expect.objectContaining({
        p_id: "portal-1",
        p_portal_key: typedPortal.portalKey,
        p_case_type: "enrollment",
      }),
    );
  });
});

describe("updatePortalPayer", () => {
  const globalPortal = {
    id: "portal-1",
    orgId: null,
    portalKey: "bcbs_ks_enrollment",
    name: "BCBS KS Enrollment",
    payerId: "payer-1",
    mappingGeneration: 1,
    formUrl: null,
    isVerified: false,
    lastVerifiedAt: null,
    urlChangedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };

  it("refuses to detach a global portal before any write", async () => {
    rpcMock.mockResolvedValue({ data: { ...CREATED_ROW, org_id: null }, error: null });
    const captures = installDb(CREATED_ROW);

    await expect(updatePortalPayer(globalPortal, null)).rejects.toThrow(
      "Global portals must have an attached payer",
    );

    expect(rpcMock).not.toHaveBeenCalled();
    expect(captures).toHaveLength(0);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("audits a successful global portal payer reassignment", async () => {
    rpcMock.mockResolvedValue({
      data: { ...CREATED_ROW, org_id: null, payer_id: "payer-2" },
      error: null,
    });

    const updated = await updatePortalPayer(globalPortal, "payer-2");

    expect(updated.payerId).toBe("payer-2");
    expect(rpcMock).toHaveBeenCalledWith(
      "upsert_global_portal",
      expect.objectContaining({ p_id: "portal-1", p_payer_id: "payer-2" }),
    );
    expect(writeAuditMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "portal",
        entityId: "portal-1",
        before: { payerId: "payer-1" },
        after: { payerId: "payer-2" },
      }),
    );
  });

  it("does not reassign an explicit configuration to another payer", async () => {
    const captures = installDb(CREATED_ROW);
    const explicitPortal = {
      ...globalPortal,
      orgId: "org-1",
      caseType: "enrollment" as const,
      requiresExplicitSelection: true,
    };

    await expect(updatePortalPayer(explicitPortal, "payer-2")).rejects.toThrow(
      "The payer is fixed for this independent form configuration.",
    );

    expect(captures).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("treats keeping an explicit configuration's payer as a no-op", async () => {
    const captures = installDb(CREATED_ROW);
    const explicitPortal = {
      ...globalPortal,
      caseType: "enrollment" as const,
      requiresExplicitSelection: true,
    };

    await expect(updatePortalPayer(explicitPortal, "payer-1")).resolves.toEqual(explicitPortal);
    expect(captures).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not audit a rejected global payer reassignment", async () => {
    const error = new Error("permission denied");
    rpcMock.mockResolvedValue({ data: null, error });

    await expect(updatePortalPayer(globalPortal, "payer-2")).rejects.toThrow(error);

    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("still allows detaching an organization portal", async () => {
    rpcMock.mockResolvedValue({ data: { ...CREATED_ROW, payer_id: null }, error: null });

    const updated = await updatePortalPayer({ ...globalPortal, orgId: "org-1" }, null);

    expect(updated.payerId).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith(
      "update_org_portal_configuration",
      expect.objectContaining({
        p_org_id: "org-1",
        p_id: "portal-1",
        p_expected_mapping_generation: 1,
        p_patch: { payer_id: null },
      }),
    );
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ before: { payerId: "payer-1" }, after: { payerId: null } }),
    );
  });

  it("updates payer_id for an org portal and audits the change", async () => {
    const updatedRow = { ...CREATED_ROW, payer_id: "payer-123" };
    rpcMock.mockResolvedValue({ data: updatedRow, error: null });

    const portal = {
      id: "portal-1",
      orgId: "org-1",
      portalKey: "bcbs_ks_enrollment",
      name: "BCBS KS Enrollment",
      payerId: null,
      formUrl: null,
      isVerified: false,
      mappingGeneration: 1,
      lastVerifiedAt: null,
      urlChangedAt: null,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    };

    const res = await updatePortalPayer(portal, "payer-123");

    expect(rpcMock).toHaveBeenCalledWith(
      "update_org_portal_configuration",
      expect.objectContaining({
        p_org_id: "org-1",
        p_id: "portal-1",
        p_expected_mapping_generation: 1,
        p_patch: { payer_id: "payer-123" },
      }),
    );
    expect(res.payerId).toBe("payer-123");
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "portal",
        entityId: "portal-1",
        before: { payerId: null },
        after: { payerId: "payer-123" },
      }),
    );
  });
});
