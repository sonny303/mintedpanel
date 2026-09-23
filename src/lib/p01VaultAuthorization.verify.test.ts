import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const repair = readFileSync(
  join(ROOT, "supabase/migrations/20260918172142_p01_vault_authorization.sql"),
  "utf8",
);
const origStore = readFileSync(
  join(ROOT, "supabase/migrations/20260717120000_ssn_vault.sql"),
  "utf8",
);
const origIntake = readFileSync(
  join(ROOT, "supabase/migrations/20260717120100_ssn_intake_links.sql"),
  "utf8",
);

function extract(src: string, name: string): string {
  const m = src.match(
    new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${name}\b[\s\S]*?^\$\$;`, "m"),
  );
  if (!m) throw new Error(`missing ${name}`);
  return m[0];
}

// Risk 1: NULL-role bypass survives if predicates are still three-valued-unsafe.
describe("P01 risk1: NULL-safe operator predicates", () => {
  it("store/issue use IS NOT TRUE; reveal uses IS DISTINCT FROM; old forms absent", () => {
    const store = extract(repair, "store_ssn");
    const reveal = extract(repair, "reveal_ssn");
    const issue = extract(repair, "create_ssn_intake_link");
    expect(store).toMatch(
      /\(public\.user_role\(v_org\) IN \('admin', 'specialist'\)\) IS NOT TRUE/,
    );
    expect(issue).toMatch(
      /\(public\.user_role\(v_org\) IN \('admin', 'specialist'\)\) IS NOT TRUE/,
    );
    expect(reveal).toMatch(/public\.user_role\(v_org\) IS DISTINCT FROM 'admin'/);
    expect(store).not.toMatch(/user_role\(v_org\) NOT IN/);
    expect(issue).not.toMatch(/user_role\(v_org\) NOT IN/);
    expect(reveal).not.toMatch(/user_role\(v_org\) <> 'admin'/);
  });

  it("models PL/pgSQL IF: old NOT IN allows NULL; new IS NOT TRUE denies NULL", () => {
    // PL/pgSQL IF enters only when condition is TRUE (not NULL/FALSE).
    const plIf = (cond: boolean | null) => cond === true;
    const oldStoreDenies = (role: string | null) => {
      const notIn = role == null ? null : !["admin", "specialist"].includes(role);
      return plIf(notIn);
    };
    const newStoreDenies = (role: string | null) => {
      const inn = role == null ? null : ["admin", "specialist"].includes(role);
      return plIf(inn !== true);
    };
    expect(oldStoreDenies(null)).toBe(false);
    expect(newStoreDenies(null)).toBe(true);
    expect(newStoreDenies("admin")).toBe(false);
    expect(newStoreDenies("specialist")).toBe(false);
    expect(newStoreDenies("billing")).toBe(true);
  });
});

// Risk 2: CREATE OR REPLACE accidentally changes grants or non-auth body.
describe("P01 risk2: only auth predicates change vs originals", () => {
  it("bodies differ only at the three role checks; grants identical", () => {
    const norm = (s: string) =>
      s
        .replace(
          /\(public\.user_role\(v_org\) IN \('admin', 'specialist'\)\) IS NOT TRUE/g,
          "ROLE_CHECK_WRITER",
        )
        .replace(/public\.user_role\(v_org\) IS DISTINCT FROM 'admin'/g, "ROLE_CHECK_ADMIN")
        .replace(
          /public\.user_role\(v_org\) NOT IN \('admin', 'specialist'\)/g,
          "ROLE_CHECK_WRITER",
        )
        .replace(/public\.user_role\(v_org\) <> 'admin'/g, "ROLE_CHECK_ADMIN");
    expect(norm(extract(repair, "store_ssn"))).toBe(norm(extract(origStore, "store_ssn")));
    expect(norm(extract(repair, "reveal_ssn"))).toBe(norm(extract(origStore, "reveal_ssn")));
    expect(norm(extract(repair, "create_ssn_intake_link"))).toBe(
      norm(extract(origIntake, "create_ssn_intake_link")),
    );
    for (const name of ["store_ssn", "reveal_ssn", "create_ssn_intake_link"] as const) {
      const sig =
        name === "create_ssn_intake_link"
          ? "create_ssn_intake_link(uuid, text, text)"
          : `${name}(uuid, text)`;
      const grant = `REVOKE ALL ON FUNCTION public.${sig} FROM public, anon;\nGRANT EXECUTE ON FUNCTION public.${sig} TO authenticated;`;
      expect(repair).toContain(grant);
    }
  });
});

// Risk 3: auth check after revoke would mutate links on denied callers.
describe("P01 risk3: intake auth precedes revoke", () => {
  it("authorization RAISE appears before active-link UPDATE", () => {
    const body = extract(repair, "create_ssn_intake_link");
    const authAt = body.indexOf("IS NOT TRUE");
    const revokeAt = body.indexOf("SET state = 'revoked'");
    expect(authAt).toBeGreaterThan(0);
    expect(revokeAt).toBeGreaterThan(authAt);
  });
});
