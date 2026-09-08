import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("source configuration disables Vercel Git deployments for every branch", () => {
  const config = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));
  assert.equal(
    config.git?.deploymentEnabled,
    false,
    "Use the all-branch false setting; a branch map can leave other refs enabled",
  );
});

test("the ungated hosted org-isolation workflow remains retired", () => {
  assert.equal(
    existsSync(new URL(".github/workflows/verify-org-isolation.yml", root)),
    false,
    "Hosted isolation belongs inside the approved production job, not a deployment event or arbitrary-URL dispatch",
  );
});
