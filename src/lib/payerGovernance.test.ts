// E4.2 payer governance — machine-checked posture, not review memory:
//   1. The org application never touches the catalog diff queue: no src file
//      reads payer_catalog_changes or calls review_payer_catalog_change.
//   2. The revoke migration actually revokes authenticated SELECT/EXECUTE and
//      keeps the service_role (platform) path, by grant definition.
//   3. The payers service has no INSERT and (since the 2026-07-18 close-out)
//      no UPDATE — payer writes are gone at the service boundary, not just
//      hidden in the UI.
//   4. The org_payer_settings migration carries the locked shape: unique
//      (org_id, payer_id), admin-only INSERT/UPDATE policies, no DELETE grant
//      for authenticated.
//   5. The payers write-lockdown migration mirrors the same posture at the DB:
//      the org INSERT/UPDATE policies are dropped and the grants revoked, so
//      an org-scoped (legacy) payer row can never be minted again — while
//      member SELECT stays intact.
// (The live grant/RLS state was additionally verified on hosted via
// rolled-back simulations — recorded in the PR description.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Strip comments — the governance decisions are DOCUMENTED in comments; the
// assertions are about live code paths (the generationConfirm.test.ts idiom).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const settingsMigration = readFileSync(
  join(ROOT, "supabase/migrations/20260716190000_org_payer_settings.sql"),
  "utf8",
);
const revokeMigration = readFileSync(
  join(ROOT, "supabase/migrations/20260716191000_catalog_review_platform_only.sql"),
  "utf8",
);
const lockdownMigration = readFileSync(
  join(ROOT, "supabase/migrations/20260718120000_payers_org_write_lockdown.sql"),
  "utf8",
);

describe("catalog review is not reachable from the org application", () => {
  const sources = walk(SRC).map((f) => ({
    file: f,
    code: stripComments(readFileSync(f, "utf8")),
  }));

  it("no non-test src file queries payer_catalog_changes", () => {
    const offenders = sources
      .filter((s) => s.code.includes('from("payer_catalog_changes")'))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("no non-test src file calls the review_payer_catalog_change RPC", () => {
    // The generated types file legitimately NAMES the function (it exists in
    // the schema); the assertion is that nothing CALLS it.
    const offenders = sources
      .filter((s) => s.code.includes('rpc("review_payer_catalog_change"'))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe("the revoke migration (20260716191000) — grant definitions", () => {
  const sql = revokeMigration.toLowerCase();

  it("revokes authenticated access to payer_catalog_changes and drops its org-user policy", () => {
    expect(sql).toContain("revoke all on public.payer_catalog_changes from authenticated");
    expect(sql).toContain(
      "drop policy if exists payer_catalog_changes_select on public.payer_catalog_changes",
    );
  });

  it("revokes authenticated/anon/public EXECUTE on the review RPC", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(
        `revoke all on function public.review_payer_catalog_change(uuid, boolean) from ${role}`,
      );
    }
  });

  it("keeps the service_role (platform) path by explicit grant", () => {
    expect(sql).toContain(
      "grant execute on function public.review_payer_catalog_change(uuid, boolean) to service_role",
    );
  });

  it("the reissued body rejects org-user JWTs inside the function (defense in depth)", () => {
    expect(sql).toContain("catalog_review_platform_only");
  });

  it("never re-grants table access to authenticated", () => {
    expect(sql).not.toMatch(
      /grant\s+[a-z, ]*on\s+public\.payer_catalog_changes\s+to\s+authenticated/,
    );
  });
});

describe("payer writes are gone at the service boundary", () => {
  const payersService = stripComments(readFileSync(join(SRC, "services/payers.ts"), "utf8"));

  it("the payers service performs no INSERT or UPDATE and exports no createPayer/updatePayer", () => {
    expect(payersService).not.toContain(".insert(");
    expect(payersService).not.toContain(".update(");
    expect(payersService).not.toContain("createPayer");
    expect(payersService).not.toContain("updatePayer");
  });

  it("the admin payers route has no Add-payer affordance", () => {
    // E4.2 unified payer setup: /admin/payers is a redirect shell into the
    // Payer Setup workspace, whose Catalog tab is the canonical add path.
    const route = stripComments(readFileSync(join(SRC, "routes/admin.payers.tsx"), "utf8"));
    expect(route).not.toContain("Add payer");
    expect(route).not.toContain("useCreatePayer");
    expect(route).toContain("/admin/payer-admin");
  });

  it("the Payer Setup funnel keeps the read-only posture (no free-text creation, no identity edit)", () => {
    // E6.5: PayerSetupList retired; the module head is PayerReadinessFunnel.
    const funnel = stripComments(
      readFileSync(join(SRC, "components/payer-admin/PayerReadinessFunnel.tsx"), "utf8"),
    );
    expect(funnel).not.toContain("Add payer");
    expect(funnel).not.toContain("useCreatePayer");
    expect(funnel).not.toContain("updatePayer");
  });

  it("delegation_note has NO app writer (curated platform fact)", () => {
    // F6.5.5 — delegation is a Minted-curated catalog fact; only the migration
    // and generated types may name the column, and no snake/camel write path
    // exists in services.
    const services = readdirSync(join(SRC, "services")).filter((f) => f.endsWith(".ts"));
    for (const file of services) {
      const src = stripComments(readFileSync(join(SRC, "services", file), "utf8"));
      expect(src, `services/${file} must not write delegation_note`).not.toMatch(
        /delegation_note\s*:/,
      );
      expect(src, `services/${file} must not write delegationNote`).not.toMatch(
        /delegationNote\s*:/,
      );
    }
  });
});

describe("the payers write-lockdown migration (20260718120000) — grant definitions", () => {
  const sql = lockdownMigration.toLowerCase();

  it("drops both org write policies on payers", () => {
    expect(sql).toContain("drop policy if exists payers_insert on public.payers");
    expect(sql).toContain("drop policy if exists payers_update on public.payers");
  });

  it("revokes INSERT/UPDATE from authenticated and anon", () => {
    expect(sql).toContain("revoke insert, update on table public.payers from authenticated");
    expect(sql).toContain("revoke insert, update on table public.payers from anon");
  });

  it("leaves member reads intact (no SELECT revoke, payers_select untouched)", () => {
    expect(sql).not.toMatch(/revoke[^;]*select[^;]*on table public\.payers/);
    expect(sql).not.toContain("drop policy if exists payers_select");
  });
});

describe("the org_payer_settings migration (20260716190000) — locked shape", () => {
  const sql = settingsMigration.toLowerCase();

  it("keys the setting by org × payer with a unique constraint", () => {
    expect(sql).toContain("unique (org_id, payer_id)");
  });

  it("admin-only INSERT/UPDATE policies; member SELECT", () => {
    expect(sql).toMatch(
      /for insert with check \(org_id in \(select user_org_ids\(\)\) and user_role\(org_id\) = 'admin'\)/,
    );
    expect(sql).toMatch(
      /for update using \(org_id in \(select user_org_ids\(\)\) and user_role\(org_id\) = 'admin'\)/,
    );
    expect(sql).toContain("for select using (org_id in (select user_org_ids()))");
  });

  it("no DELETE grant or policy for authenticated (revoke-then-grant floor)", () => {
    expect(sql).toContain("revoke all on public.org_payer_settings from authenticated");
    expect(sql).toContain(
      "grant select, insert, update on public.org_payer_settings to authenticated",
    );
    expect(sql).not.toMatch(/create policy [a-z_]* on public\.org_payer_settings\s*for delete/);
  });

  it("carries only the resolution-identifier fields (nothing else moved here)", () => {
    const columnLines = sql
      .split("\n")
      .filter((l) => l.trim().startsWith("resolution_id_") || l.includes("payer_billing_id"));
    expect(columnLines.some((l) => l.includes("resolution_id_label"))).toBe(true);
    expect(columnLines.some((l) => l.includes("resolution_id_expected"))).toBe(true);
    expect(sql).not.toContain("payer_billing_id");
    expect(sql).not.toContain("portal_url");
    expect(sql).not.toContain("avg_decision_days");
  });
});
