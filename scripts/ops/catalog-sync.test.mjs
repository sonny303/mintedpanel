import assert from "node:assert/strict";
import test from "node:test";
import {
  PROD_REF,
  STAGING_REF,
  assertDirection,
  chunk,
  planAdds,
  projectRef,
  splitByOrg,
  splitForms,
  stripUserColumns,
} from "./catalog-sync.mjs";

const url = (ref) => `https://${ref}.supabase.co`;

test("only prod -> staging is allowed", () => {
  assert.doesNotThrow(() => assertDirection(url(PROD_REF), url(STAGING_REF)));
  assert.throws(() => assertDirection(url(STAGING_REF), url(PROD_REF)));
  assert.throws(() => assertDirection(url(PROD_REF), url(PROD_REF)));
  assert.throws(() => assertDirection("", url(STAGING_REF)));
  assert.equal(projectRef("https://evil.example.com"), null);
});

test("planAdds returns missing rows only", () => {
  const src = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const dst = [{ id: "b" }, { id: "z" }];
  assert.deepEqual(planAdds(src, dst), [{ id: "a" }, { id: "c" }]);
  assert.deepEqual(planAdds(src, src), []);
});

test("planAdds takes a composite key", () => {
  const key = (r) => `${r.template_id}:${r.version}`;
  const src = [
    { template_id: "t", version: 1 },
    { template_id: "t", version: 2 },
  ];
  assert.deepEqual(planAdds(src, [{ template_id: "t", version: 1 }], key), [
    { template_id: "t", version: 2 },
  ]);
});

test("user columns are dropped", () => {
  assert.deepEqual(
    stripUserColumns({ id: 1, created_by: "u", published_by: "u", retired_by: "u" }),
    { id: 1 },
  );
});

test("org rows need their org on the target", () => {
  const rows = [
    { id: 1, org_id: null },
    { id: 2, org_id: "o1" },
    { id: 3, org_id: "o2" },
  ];
  const { ok, skipped } = splitByOrg(rows, new Set(["o1"]));
  assert.deepEqual(
    ok.map((r) => r.id),
    [1, 2],
  );
  assert.deepEqual(
    skipped.map((s) => s.row.id),
    [3],
  );
});

test("forms need payer and template on the target", () => {
  const have = { payers: new Set(["p"]), templates: new Set(["t"]) };
  const forms = [
    { id: 1, payer_id: "p", template_id: "t" },
    { id: 2, payer_id: "x", template_id: "t" },
    { id: 3, payer_id: "p", template_id: "x" },
  ];
  const { ok, skipped } = splitForms(forms, have);
  assert.deepEqual(
    ok.map((f) => f.id),
    [1],
  );
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ["payer not on target", "template not on target"],
  );
});

test("chunk splits evenly", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
