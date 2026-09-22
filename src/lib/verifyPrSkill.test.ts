import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(join(process.cwd(), ".cursor/skills/verify-pr/SKILL.md"), "utf8");

describe("verify-pr skill contract", () => {
  it("Step 1 prompt asks the agent to explain the code, not the request", () => {
    expect(skill).toMatch(/\*\*Step 1:\*\*.*as if I did not write the code/s);
  });

  it("documents how Step 3 works when the change has no executable product code", () => {
    expect(skill).toMatch(/no executable (product )?code/i);
  });

  it("does not auto-steal specialty review requests (Bugbot / security-review)", () => {
    expect(skill).toMatch(/Bugbot|security-review|specialty review/i);
  });
});
