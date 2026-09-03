// One wiring for one job, pinned at the code level. Field maps are keyed by
// portal_key, so the SAME training and drift-repair job is reachable from two
// hosts — the Template Editor's Form setup step (authoring) and the payer
// Portals drawer (maintenance). Both must go through
// `useFieldRegistryEditor`: a second copy of the decision routing is how the
// two surfaces start disagreeing about what "approved" writes, and only one
// of them would then get a fix.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

// The ONE place the registry training mutations may be wired.
const WIRING = "src/hooks/useFieldRegistryEditor.ts";
const HOSTS = [
  "src/components/templates/FormStepPanel.tsx",
  "src/components/portals/PortalDrawer.tsx",
];

// Files allowed to wire the mutations outside the hook. This list may only
// ever SHRINK.
const ALLOWED_WIRING = new Set([
  WIRING,
  "src/hooks/useMappingReview.ts", // the definitions
  "src/hooks/useGlobalAuthoring.ts", // the definitions
  // KNOWN DUPLICATE, pre-dates the extraction: the E6.11 payer-PDF trainer
  // holds its own copy of the same decision routing, shared-tier only, keyed
  // on `payer-form:<familyId>`. It should move onto the hook — until it does,
  // a fix to the routing has to be made twice.
  "src/components/templates/PayerFormFieldPanel.tsx",
]);

// Training/repair mutation hooks. Registration (useCreatePortal /
// useUpsertGlobalPortal) is deliberately NOT here — registering a portal
// against a template step stays the editor's job.
const TRAINING_MUTATION_HOOKS = [
  "useApproveField",
  "useManualField",
  "useSetFieldMapHardcoded",
  "useSetFieldMapTransform",
  "useReproposeField",
  "useTrainGlobalFieldMap",
  "useUpdateSharedFieldRegistry",
  "useAddSharedRegistryField",
];

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

const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), "utf8"));

describe("portal field registry — one wiring, two hosts", () => {
  it("only useFieldRegistryEditor wires the training mutations", () => {
    const offenders: string[] = [];
    for (const full of walk(SRC)) {
      const rel = full.slice(process.cwd().length + 1).replaceAll("\\", "/");
      if (ALLOWED_WIRING.has(rel)) continue;
      const code = stripComments(readFileSync(full, "utf8"));
      for (const hook of TRAINING_MUTATION_HOOKS) {
        // Call sites only — `import type` cannot wire a mutation.
        if (new RegExp(`\\b${hook}\\(`).test(code)) offenders.push(`${rel} → ${hook}()`);
      }
    }
    expect(
      offenders,
      `training mutations must be wired only in ${WIRING}:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("both hosts mount the shared registry over the shared editor", () => {
    for (const host of HOSTS) {
      const code = read(host);
      expect(code, `${host} must use the shared editor`).toContain("useFieldRegistryEditor(");
      expect(code, `${host} must mount the shared registry block`).toContain(
        "<PortalFieldRegistry",
      );
    }
  });

  it("the shared registry block holds no writes of its own", () => {
    const code = read("src/components/portals/PortalFieldRegistry.tsx");
    expect(code).not.toContain("useMutation");
    expect(code).not.toContain("@/services/");
    // Every write arrives as a callback on the editor.
    expect(code).toContain("editor.decide");
    expect(code).toContain("editor.addField");
  });

  it("the editor hook needs no template context", () => {
    const code = read(WIRING);
    // Tier is read off the ROW (org_id IS NULL = shared). A template-tier flag
    // here would mean the same portal trains differently per host.
    expect(code).not.toContain("isGlobalAuthoring");
    expect(code).not.toContain("templateId");
    expect(code).not.toContain("sopTemplate");
  });
});
