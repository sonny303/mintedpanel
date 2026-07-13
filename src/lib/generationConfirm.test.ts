// E2.1 TE-9 — the batch skip/failure disposition module, plus the F2.1.5
// negative feature pinned at the code level: NO prerequisite-payer logic
// exists anywhere in the generation pipeline ([r4] Q3 — dropped by decision,
// not deferred; payers.prerequisite_payer_id stays dormant).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  planGenerationConfirm,
  summarizeGenerationOutcomes,
  type GenerationRowOutcome,
} from "./generationConfirm";
import type { GenerationPreviewRow } from "./generationPreview";

const row = (over: Partial<GenerationPreviewRow>): GenerationPreviewRow => ({
  providerId: "jane",
  groupId: "g1",
  payerId: "bcbs-nc",
  state: "NC",
  providerName: "Jane Seed",
  groupName: "Group 1",
  payerName: "BCBS-NC",
  disposition: "proposed",
  reason: "derived",
  existingCase: null,
  exclusion: null,
  ...over,
});

describe("planGenerationConfirm", () => {
  it("attempts exactly the proposed rows; existing and excluded are never attempted", () => {
    const rows = [
      row({ groupId: "g1" }),
      row({ groupId: "g2" }),
      row({ providerId: "amir", disposition: "existing" }),
      row({ providerId: "lena", disposition: "excluded" }),
    ];
    const plan = planGenerationConfirm(rows);
    expect(plan.toCreate.map((r) => r.groupId)).toEqual(["g1", "g2"]);
    expect(plan.skippedExisting).toHaveLength(1);
    expect(plan.excluded).toHaveLength(1);
  });

  it("stores the confirm-time plan on the immutable run row: created = proposed, failed = 0", () => {
    const plan = planGenerationConfirm([
      row({}),
      row({ groupId: "g2" }),
      row({ providerId: "amir", disposition: "existing" }),
      row({ providerId: "lena", disposition: "excluded" }),
    ]);
    expect(plan.plannedCounts).toEqual({
      proposedCount: 2,
      createdCount: 2,
      skippedExistingCount: 1,
      excludedCount: 1,
      failedCount: 0,
    });
  });

  it("an empty preview plans an empty run", () => {
    const plan = planGenerationConfirm([]);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.plannedCounts.proposedCount).toBe(0);
  });
});

describe("summarizeGenerationOutcomes", () => {
  it("partitions created / concurrent-skip / failed and lists failures", () => {
    const outcomes: GenerationRowOutcome[] = [
      { row: row({}), disposition: "created", caseId: "c1" },
      { row: row({ groupId: "g2" }), disposition: "skipped_existing" },
      { row: row({ providerId: "amir" }), disposition: "failed", message: "boom" },
    ];
    const summary = summarizeGenerationOutcomes(outcomes);
    expect(summary.created).toBe(1);
    expect(summary.skippedExisting).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0].message).toBe("boom");
    expect(summary.failures[0].row.providerId).toBe("amir");
  });

  it("a clean run has zero failures", () => {
    const summary = summarizeGenerationOutcomes([
      { row: row({}), disposition: "created", caseId: "c1" },
    ]);
    expect(summary.failed).toBe(0);
    expect(summary.failures).toHaveLength(0);
  });
});

describe("F2.1.5 — no prerequisite logic in the generation pipeline (code-level assertion)", () => {
  const pipelineModules = [
    "src/lib/generationPreview.ts",
    "src/lib/generationConfirm.ts",
    "src/services/generationPreview.ts",
    "src/services/generationConfirm.ts",
    "src/services/caseGenerationRuns.ts",
    "src/hooks/useGenerationPreview.ts",
  ];

  it("never references prerequisite_payer_id or any prerequisite branch", () => {
    for (const file of pipelineModules) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      // Strip comments — the negative decision may be DOCUMENTED, never coded.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, `${file} must not carry prerequisite-payer logic`).not.toMatch(/prerequisite/i);
    }
  });
});
