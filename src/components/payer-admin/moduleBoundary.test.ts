// E4.2 TE-15 — the module import boundary is MACHINE-ENFORCED, bidirectionally,
// so the SOP rule engine can evolve without regressing the daily execution
// queue and vice-versa. This test walks the import graph and fails CI (in the
// normal test gate) on a violation — not review memory.
//
// The admin module = `src/components/payer-admin/*` + `src/routes/admin*`.
//   Rule A (inbound protection): no specialist workflow module (anything
//     outside the admin module) may import from `@/components/payer-admin`.
//   Rule B (outbound discipline): the admin module imports specialist code ONLY
//     via shared `@/lib` / `@/services` / `@/hooks` / `@/types` / design-system
//     primitives — never a specialist FEATURE component directory.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // src/

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return relative(SRC_ROOT, file).split("\\").join("/");
}

function isAdminModule(relPath: string): boolean {
  return (
    relPath.startsWith("components/payer-admin/") ||
    relPath.startsWith("routes/admin.") ||
    relPath === "routes/admin.tsx"
  );
}

function importSpecifiers(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

// Specialist FEATURE component directories the admin module must not import.
// Shared surfaces (ui, layout, root-level shared components, lib/services/
// hooks/types) are allowed.
const FORBIDDEN_FOR_MODULE = [
  "@/components/cases",
  "@/components/work",
  "@/components/generation",
  "@/components/home",
  "@/components/triage",
  "@/components/launches",
  "@/components/providers",
  "@/components/client-progress",
  "@/components/import",
  "@/components/portals",
  "@/components/onboarding",
  "@/components/reporting",
  "@/components/portfolio",
];

describe("payer-admin module boundary (TE-15)", () => {
  const files = walk(SRC_ROOT).filter((f) => !f.endsWith("moduleBoundary.test.ts"));

  it("Rule A: no non-admin code imports from @/components/payer-admin", () => {
    const violations: string[] = [];
    for (const file of files) {
      const relPath = rel(file);
      if (isAdminModule(relPath)) continue;
      for (const spec of importSpecifiers(file)) {
        if (spec.startsWith("@/components/payer-admin")) {
          violations.push(`${relPath} → ${spec}`);
        }
      }
    }
    expect(
      violations,
      `specialist code must not import the admin module:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("Rule B: the admin module imports no specialist feature component", () => {
    const violations: string[] = [];
    for (const file of files) {
      const relPath = rel(file);
      if (!relPath.startsWith("components/payer-admin/")) continue;
      for (const spec of importSpecifiers(file)) {
        if (FORBIDDEN_FOR_MODULE.some((p) => spec === p || spec.startsWith(`${p}/`))) {
          violations.push(`${relPath} → ${spec}`);
        }
      }
    }
    expect(
      violations,
      `admin module must reach specialist code only via lib/services/hooks/types:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
