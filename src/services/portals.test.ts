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

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (table: string) => holder.from(table) },
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: writeAuditMock,
  requireActiveOrg: () => "org-1",
}));

import { createPortal } from "./portals";

interface Captured {
  table: string;
  op?: "insert";
  payload?: Record<string, unknown>;
}

// Minimal chainable fake for createPortal's one shape:
// from("portals").insert(payload).select(cols).single().
function installDb(created: Record<string, unknown>): Captured[] {
  const captures: Captured[] = [];
  holder.from = (table: string) => {
    const cap: Captured = { table };
    captures.push(cap);
    const builder: Record<string, unknown> = {
      insert(payload: Record<string, unknown>) {
        cap.op = "insert";
        cap.payload = payload;
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
});
