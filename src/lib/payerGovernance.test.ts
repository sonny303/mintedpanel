// Payer governance — machine-checked posture, not review memory. E6.7
// (manual payer setup, PM decisions 2026-07-26) re-anchored the write rules:
//   1. The org application never touches the catalog diff queue: no src file
//      reads payer_catalog_changes or calls review_payer_catalog_change.
//   2. The revoke migration actually revokes authenticated SELECT/EXECUTE and
//      keeps the service_role (platform) path, by grant definition.
//   3. Payer writes are RPC-ONLY at the service boundary: payers.ts calls
//      create_payer/update_payer and never issues a direct payers
//      INSERT/UPDATE — the 20260718120000 table lockdown still stands, and
//      the E6.7 enabler migration never re-grants table DML or recreates the
//      dropped write policies.
//   4. The org_payer_settings migration carries the locked shape: unique
//      (org_id, payer_id), admin-only INSERT/UPDATE policies, no DELETE grant
//      for authenticated. (Dormant since 2026-07-20; the shape still binds.)
//   5. The payers write-lockdown migration mirrors the same posture at the DB:
//      the org INSERT/UPDATE policies are dropped and the grants revoked, so
//      an org-scoped (legacy) payer row can never be minted again — while
//      member SELECT stays intact.
//   6. payer_contacts (E6.7 F6.7.2a) is SELECT-only for clients — writes go
//      through the audited upsert/delete RPCs, anon rejected by grant floor.
// (The live grant/RLS state was additionally verified on hosted via
// rolled-back simulations — recorded in the PR descriptions.)
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

describe("payer writes are RPC-only at the service boundary (E6.7)", () => {
  const payersService = stripComments(readFileSync(join(SRC, "services/payers.ts"), "utf8"));

  it("the payers service never issues a direct payers INSERT/UPDATE — writes ride the RPCs", () => {
    expect(payersService).not.toContain(".insert(");
    expect(payersService).not.toContain(".update(");
    expect(payersService).toContain('rpc("create_payer"');
    expect(payersService).toContain('rpc("update_payer"');
  });

  it("the payer-contacts service is the same shape: RLS reads, RPC writes", () => {
    const contacts = stripComments(readFileSync(join(SRC, "services/payerContacts.ts"), "utf8"));
    expect(contacts).not.toContain(".insert(");
    expect(contacts).not.toContain(".update(");
    expect(contacts).not.toContain(".delete(");
    expect(contacts).toContain('rpc("upsert_payer_contact"');
    expect(contacts).toContain('rpc("delete_payer_contact"');
  });

  it("the admin payers route has no Add-payer affordance (zero rendered UI in E6.7)", () => {
    // E4.2 unified payer setup: /admin/payers is a redirect shell into the
    // Payer Setup workspace; the future add-payer dialog is a separate track.
    const route = stripComments(readFileSync(join(SRC, "routes/admin.payers.tsx"), "utf8"));
    expect(route).not.toContain("Add payer");
    expect(route).not.toContain("useCreatePayer");
    expect(route).toContain("/admin/payer-admin");
  });

  it("the Slice B payer form writes ONLY through the hooks (never Supabase directly)", () => {
    // Payer create/edit UI now EXISTS (payer-and-cases screen 2) — its posture
    // is the layering rule: components → hooks → the RPC-bound service. No
    // component may import the Supabase client or name a payers table write.
    const surfaces = [
      "components/payer-admin/PayerDetailsForm.tsx",
      "components/payer-admin/PayerNameStep.tsx",
      "components/payer-admin/PayerStatesField.tsx",
      "routes/admin.payers_.new.tsx",
      "routes/admin.payers_.$id.edit.tsx",
    ];
    for (const file of surfaces) {
      const src = stripComments(readFileSync(join(SRC, file), "utf8"));
      expect(src, `${file} must not import the Supabase client`).not.toContain(
        "integrations/supabase",
      );
      expect(src, `${file} must not query the payers table`).not.toContain('from("payers")');
    }
  });

  it("the Payer Setup list never mutates a payer identity (writes live off the list)", () => {
    // Slice G re-anchor. E6.5's read-only PayerReadinessFunnel WAS the module
    // head and is now deleted (render-orphaned by Slice A); the head is the
    // Slice A PayerSetupPage. Its governance posture is no longer "no
    // creation" — Slice B shipped a real "+ Set up payer" door — but the LIST
    // still never mutates identity itself: creating is a LINK out to
    // /admin/payers/new and editing lives on the payer detail, so no payer
    // create/update mutation may be wired into this surface, and it may never
    // reach past the hook layer to the client or the payers table.
    const page = stripComments(
      readFileSync(join(SRC, "components/payer-admin/PayerSetupPage.tsx"), "utf8"),
    );
    expect(page).not.toContain("integrations/supabase");
    expect(page).not.toContain('from("payers")');
    expect(page).not.toContain("useCreatePayer");
    expect(page).not.toContain("useUpdatePayer");
    expect(page).toContain("/admin/payers/new");
  });

  it("delegation_note is written ONLY through the payers RPC seam", () => {
    // E6.7 supersedes the F6.5.5 no-app-writer pin: delegation is now a
    // user-entered payer fact, but its ONLY writer is services/payers.ts
    // (the create_payer/update_payer RPC params). No other service may
    // name the column in a write position.
    const services = readdirSync(join(SRC, "services")).filter(
      (f) => f.endsWith(".ts") && !/\.test\.ts$/.test(f) && f !== "payers.ts",
    );
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

describe("the E6.7 enabler migrations — grant definitions", () => {
  const enablerMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260727120000_e67_payer_manual_setup.sql"),
    "utf8",
  ).toLowerCase();
  const contactsMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260727120200_e67_payer_contacts.sql"),
    "utf8",
  ).toLowerCase();

  it("never re-grants payers table DML or recreates the dropped write policies", () => {
    expect(enablerMigration).not.toMatch(
      /grant\s+[a-z, ]*insert[a-z, ]*on\s+(table\s+)?public\.payers/,
    );
    expect(enablerMigration).not.toMatch(
      /grant\s+[a-z, ]*update[a-z, ]*on\s+(table\s+)?public\.payers/,
    );
    expect(enablerMigration).not.toMatch(/create policy payers_(insert|update)/);
  });

  it("the payer RPCs revoke anon and grant EXECUTE to authenticated", () => {
    for (const fn of ["create_payer", "update_payer"]) {
      expect(enablerMigration).toContain(`revoke all on function public.${fn}`);
      expect(enablerMigration).toMatch(
        new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated`),
      );
    }
  });

  it("payer_contacts is SELECT-only for clients; contact writes are RPC-only", () => {
    expect(contactsMigration).toContain("revoke all on public.payer_contacts from authenticated");
    expect(contactsMigration).toContain("grant select on public.payer_contacts to authenticated");
    expect(contactsMigration).not.toMatch(
      /grant\s+[a-z, ]*(insert|update|delete)[a-z, ]*on\s+public\.payer_contacts\s+to\s+authenticated/,
    );
    expect(contactsMigration).not.toMatch(
      /create policy [a-z_]* on public\.payer_contacts\s*for (insert|update|delete)/,
    );
    for (const fn of ["upsert_payer_contact", "delete_payer_contact"]) {
      expect(contactsMigration).toContain(`revoke all on function public.${fn}`);
    }
  });
});

describe("the E6.8 lifecycle migrations — grant definitions", () => {
  const archiveMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260727150000_e68_payer_archive.sql"),
    "utf8",
  ).toLowerCase();
  const mergeMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260727150100_e68_merge_payer.sql"),
    "utf8",
  ).toLowerCase();
  const ackMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260727150200_e68_case_status_missing_ack.sql"),
    "utf8",
  ).toLowerCase();

  it("never re-grants payers table DML or recreates the dropped write policies", () => {
    for (const sql of [archiveMigration, mergeMigration, ackMigration]) {
      expect(sql).not.toMatch(/grant\s+[a-z, ]*insert[a-z, ]*on\s+(table\s+)?public\.payers/);
      expect(sql).not.toMatch(/grant\s+[a-z, ]*update[a-z, ]*on\s+(table\s+)?public\.payers/);
      expect(sql).not.toMatch(/create policy payers_(insert|update)/);
    }
  });

  it("the lifecycle RPCs revoke anon and grant EXECUTE to authenticated", () => {
    for (const [sql, fn] of [
      [archiveMigration, "archive_payer"],
      [archiveMigration, "reactivate_payer"],
      [mergeMigration, "merge_payer"],
    ] as const) {
      expect(sql).toContain(`revoke all on function public.${fn}`);
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated`),
      );
    }
  });

  it("the set_case_status reissue drops the old 11-param signature (no PostgREST overload) and re-grants only authenticated", () => {
    expect(ackMigration).toMatch(
      /drop function if exists public\.set_case_status\(\s*uuid, text, text, uuid, text, boolean, date, text, text, date, uuid\s*\)/,
    );
    expect(ackMigration).toContain("p_provider_id_missing_ack boolean default false");
    expect(ackMigration).toContain("p_group_id_missing_ack boolean default false");
    expect(ackMigration).toMatch(
      /revoke all on function public\.set_case_status\([\s\S]*?\) from anon/,
    );
    expect(ackMigration).toMatch(
      /grant execute on function public\.set_case_status\([\s\S]*?\) to authenticated/,
    );
    expect(ackMigration).not.toContain("security definer");
  });

  it("the merge stays inside the epic's table trace — no payer_contacts/contracts/exclusions writes", () => {
    for (const table of ["payer_contacts", "contracts", "case_generation_exclusions"]) {
      expect(mergeMigration).not.toMatch(
        new RegExp(`(update|delete from|insert into) public\\.${table}`),
      );
    }
  });
});

// 3M Slice 6 — platform authoring vs org adoption. Softening "creating =
// adding" must not soften anything else: the payers table stays write-locked,
// the RPC stays the only door, and the read widening stays a READ widening.
describe("the Slice 6 migrations — grant + policy shape", () => {
  const assignFlagMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260809120000_slice6_create_payer_assign_flag.sql"),
    "utf8",
  ).toLowerCase();
  const sopReadMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260809120100_slice6_global_sop_read_without_assignment.sql"),
    "utf8",
  ).toLowerCase();
  // The prose explains what the assignment gate USED to do, so shape checks
  // read the statements only.
  const sopReadStatements = sopReadMigration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("never re-grants payers table DML or recreates the dropped write policies", () => {
    for (const sql of [assignFlagMigration, sopReadMigration]) {
      expect(sql).not.toMatch(/grant\s+[a-z, ]*insert[a-z, ]*on\s+(table\s+)?public\.payers/);
      expect(sql).not.toMatch(/grant\s+[a-z, ]*update[a-z, ]*on\s+(table\s+)?public\.payers/);
      expect(sql).not.toMatch(/create policy payers_(insert|update)/);
    }
  });

  it("the create_payer reissue drops the old 10-param signature (no PostgREST overload)", () => {
    expect(assignFlagMigration).toMatch(
      /drop function if exists public\.create_payer\(\s*uuid, text, text, text\[\], text\[\], text, boolean, text, boolean, text\s*\)/,
    );
    expect(assignFlagMigration).toContain("p_assign_to_org boolean default true");
  });

  it("keeps the RPC grant floor: anon revoked, EXECUTE only to authenticated/service_role", () => {
    expect(assignFlagMigration).toMatch(
      /revoke all on function public\.create_payer\([\s\S]*?\) from anon/,
    );
    expect(assignFlagMigration).toMatch(
      /grant execute on function public\.create_payer\([\s\S]*?\) to authenticated, service_role/,
    );
  });

  it("the assignment upsert is CONDITIONAL — the whole point of the flag", () => {
    // The upsert must sit inside the guard, or `false` would still adopt.
    expect(assignFlagMigration).toMatch(
      /if v_assign then[\s\S]*?insert into public\.org_payer_assignments[\s\S]*?end if;/,
    );
    // And an omitted param must still mean "assign" (the E6.7 default).
    expect(assignFlagMigration).toContain("coalesce(p_assign_to_org, true)");
  });

  it("the D6.5 widening is SELECT-only — no write policy, no new table grant", () => {
    expect(sopReadStatements).toMatch(/create policy sop_templates_select[\s\S]*?for select/);
    expect(sopReadStatements).not.toMatch(
      /create policy [a-z_]+ on public\.sop_templates?\w*\s*for (insert|update|delete)/,
    );
    expect(sopReadStatements).not.toMatch(/^\s*grant /m);
    // The global disjunct is now unconditional (the portals_select_org shape),
    // which is what makes an unadopted payer's SOP readable by its author —
    // no assignment subquery survives in either policy body.
    expect(sopReadStatements).toContain("or (org_id is null)");
    expect(sopReadStatements).not.toContain("org_payer_assignments");
  });

  it("widens the version policy in lockstep with its parent", () => {
    expect(sopReadStatements).toContain("drop policy if exists sop_template_versions_select");
    expect(sopReadStatements).toContain("or (t.org_id is null)");
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
