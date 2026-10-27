#!/usr/bin/env node
// Copies the shared catalog from PRODUCTION to STAGING. Additive only: rows
// missing on staging are inserted; nothing is updated or deleted. Dry run unless
// --apply. See docs/ops/catalog-sync-prod-to-staging.md.
//
//   SYNC_SOURCE_URL / SYNC_SOURCE_SERVICE_KEY   production project
//   SYNC_TARGET_URL / SYNC_TARGET_SERVICE_KEY   staging project
//
// Order matters: payers -> portals -> portal_field_maps -> sop_templates (+versions)
// -> payer_forms (+ Storage files). Portal field maps are copied only for portals
// this run adds, so a portal staging already has keeps its own maps.
import { createClient } from "@supabase/supabase-js";
import {
  assertDirection,
  chunk,
  planAdds,
  splitByOrg,
  splitForms,
  stripUserColumns,
} from "./catalog-sync.mjs";

const apply = process.argv.includes("--apply");
const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const srcUrl = env("SYNC_SOURCE_URL");
const dstUrl = env("SYNC_TARGET_URL");
assertDirection(srcUrl, dstUrl);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const src = createClient(srcUrl, env("SYNC_SOURCE_SERVICE_KEY"), opts);
const dst = createClient(dstUrl, env("SYNC_TARGET_SERVICE_KEY"), opts);

const report = [];
const note = (table, added, skipped = []) => {
  report.push({
    table,
    added,
    skipped: skipped.length,
    reasons: skipped.map((s) => `${s.id ?? "?"}: ${s.reason}`),
  });
};

async function all(client, table, select = "*") {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/** Insert rows that are missing, one at a time so a guard rejecting one row does not stop the rest. */
async function insertEach(table, rows) {
  const added = [];
  const skipped = [];
  for (const row of rows) {
    if (!apply) {
      added.push(row);
      continue;
    }
    const { error } = await dst.from(table).insert(row);
    if (error) skipped.push({ id: row.id, reason: error.message });
    else added.push(row);
  }
  return { added, skipped };
}

async function insertBatches(table, rows) {
  if (!apply) return { added: rows, skipped: [] };
  const added = [];
  const skipped = [];
  for (const batch of chunk(rows, 50)) {
    const { error } = await dst.from(table).insert(batch);
    if (!error) added.push(...batch);
    else {
      const each = await insertEach(table, batch);
      added.push(...each.added);
      skipped.push(...each.skipped);
    }
  }
  return { added, skipped };
}

const orgs = new Set((await all(dst, "organizations", "id")).map((o) => o.id));

// 1. payers (global catalog)
const payers = planAdds(await all(src, "payers"), await all(dst, "payers")).map(stripUserColumns);
const p = await insertBatches("payers", payers);
note("payers", p.added.length, p.skipped);

// 2. portals
const portalPlan = planAdds(await all(src, "portals"), await all(dst, "portals")).map(
  stripUserColumns,
);
const portalSplit = splitByOrg(portalPlan, orgs);
const portals = await insertBatches("portals", portalSplit.ok);
note("portals", portals.added.length, [
  ...portalSplit.skipped.map((s) => ({ id: s.row.portal_key, reason: s.reason })),
  ...portals.skipped,
]);

// 3. portal_field_maps, only for portals added now
const newKeys = new Set(portals.added.map((r) => r.portal_key));
const maps = (await all(src, "portal_field_maps"))
  .filter((m) => newKeys.has(m.portal_key))
  .map(stripUserColumns);
const m = await insertBatches("portal_field_maps", maps);
note("portal_field_maps", m.added.length, m.skipped);

// 4. sop_templates, then the versions of the templates added now
const tplPlan = planAdds(await all(src, "sop_templates"), await all(dst, "sop_templates")).map(
  stripUserColumns,
);
const tpl = await insertEach("sop_templates", tplPlan);
note("sop_templates", tpl.added.length, tpl.skipped);
const tplIds = new Set(tpl.added.map((t) => t.id));
const haveVersions = apply ? await all(dst, "sop_template_versions", "template_id,version") : [];
const versions = planAdds(
  (await all(src, "sop_template_versions")).filter((v) => tplIds.has(v.template_id)),
  haveVersions,
  (r) => `${r.template_id}:${r.version}`,
).map(stripUserColumns);
const v = await insertEach("sop_template_versions", versions);
note("sop_template_versions", v.added.length, v.skipped);

// 5. payer_forms and their Storage files
const targetPayers = new Set((await all(dst, "payers", "id")).map((r) => r.id));
const targetTemplates = new Set((await all(dst, "sop_templates", "id")).map((r) => r.id));
if (!apply) {
  for (const r of payers) targetPayers.add(r.id);
  for (const r of tplPlan) targetTemplates.add(r.id);
}
const formPlan = planAdds(await all(src, "payer_forms"), await all(dst, "payer_forms")).map(
  stripUserColumns,
);
const formSplit = splitForms(formPlan, { payers: targetPayers, templates: targetTemplates });
const formsAdded = [];
const formsSkipped = formSplit.skipped.map((s) => ({ id: s.row.id, reason: s.reason }));
for (const f of formSplit.ok) {
  if (!apply) {
    formsAdded.push(f);
    continue;
  }
  const file = await src.storage.from("payer-forms").download(f.storage_path);
  if (file.error) {
    formsSkipped.push({ id: f.id, reason: `download: ${file.error.message}` });
    continue;
  }
  const up = await dst.storage
    .from("payer-forms")
    .upload(f.storage_path, file.data, { contentType: f.mime_type ?? undefined, upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) {
    formsSkipped.push({ id: f.id, reason: `upload: ${up.error.message}` });
    continue;
  }
  const ins = await insertEach("payer_forms", [f]);
  if (ins.skipped.length) formsSkipped.push(...ins.skipped);
  else formsAdded.push(f);
}
note("payer_forms", formsAdded.length, formsSkipped);

console.log(apply ? "APPLIED" : "DRY RUN (pass --apply to write)");
for (const r of report) {
  console.log(`${r.table}: ${r.added} added, ${r.skipped} skipped`);
  for (const reason of r.reasons) console.log(`  - ${reason}`);
}
