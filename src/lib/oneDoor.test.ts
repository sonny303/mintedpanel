// E6.3 F6.3.5 — the one-door invariant pinned at the code level: cases are
// created ONLY through the generation confirm path, the manual one-off modals
// (the documented escape hatch — /cases "New case" and the provider-detail
// modal until E6.4 makes the record read-only), and the reapply APPEND (which
// re-opens the SAME case, never creates one). The two retired side-effect
// creators — starter cases on provider create and the launch dialog — must
// never come back: this suite greps the comment-stripped source tree for
// case-creating call sites and fails on any new door.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

// The ONLY files allowed to call createCase(...) / create_case_with_tasks.
const ALLOWED_CASE_WRITERS = new Set([
  "src/services/cases.ts", // the definition (createCase → the RPC)
  "src/services/generationConfirm.ts", // THE door — the confirm loop
  "src/hooks/useCases.ts", // useCreateCase wrapper + reapply append
  "src/components/cases/ManualCaseModal.tsx", // the documented escape hatch
  "src/components/cases/NewCaseModal.tsx", // provider-detail manual door (E6.4 retires)
  "src/integrations/supabase/types.ts", // generated RPC TYPES, not a call site
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("F6.3.5 — one door for case creation (code-level pin)", () => {
  const files = walk(SRC);

  it("no file outside the allowlist calls createCase or the create_case_with_tasks RPC", () => {
    const offenders: string[] = [];
    for (const full of files) {
      const rel = full.slice(process.cwd().length + 1).replaceAll("\\", "/");
      if (ALLOWED_CASE_WRITERS.has(rel)) continue;
      const code = stripComments(readFileSync(full, "utf8"));
      if (/\bcreateCase\s*\(/.test(code) || /create_case_with_tasks/.test(code)) {
        offenders.push(rel);
      }
      // useCreateCase (the mutation hook) is equally a door — no new consumer
      // may appear outside the allowlist either.
      if (/\buseCreateCase\s*\(/.test(code)) {
        offenders.push(`${rel} (useCreateCase)`);
      }
    }
    expect(offenders, "case creation has ONE door + the documented manual escape hatch").toEqual(
      [],
    );
  });

  it("the retired side-effect creators are gone: no starter-case derivation, no launch case dialog", () => {
    for (const full of files) {
      const rel = full.slice(process.cwd().length + 1).replaceAll("\\", "/");
      const code = stripComments(readFileSync(full, "utf8"));
      expect(code, `${rel} must not resurrect starter cases`).not.toMatch(
        /deriveStarterCases|starterCases/,
      );
      expect(code, `${rel} must not resurrect the launch case dialog`).not.toMatch(
        /CreateCasesDialog/,
      );
    }
  });
});
