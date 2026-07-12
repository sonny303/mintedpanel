// E1.6 F1.6.2 — reference-dataset identity seed/sync pipeline (service-role
// tooling; never browser-callable, TE-5). Reads the in-repo dataset
// docs/redesign/data/payer-catalog/payers.csv (the PM-adopted replacement for
// the withdrawn Stedi API, [e1.6] 2026-07-12) and plans a sync against the
// current global catalog rows:
//   - NEW payers      -> direct idempotent INSERTs (ON CONFLICT global name)
//   - CHANGED payers  -> payer_catalog_changes diff rows for human review
//                        (never a silent overwrite, F1.6.3)
//   - MISSING payers  -> reported only (merged/retired is a manual curation
//                        decision, never automated row deletion)
// Identity fields only — curated credentialing fields are never touched.
//
// Runbook (quarterly manual refresh per the dataset README):
//   1. Export current global rows:
//        select coalesce(json_agg(t), '[]'::json) from (
//          select name, aliases, states, stedi_payer_id, status
//          from payers where org_id is null) t;
//      Save as existing.json ([] for the very first seed).
//   2. Plan:  node scripts/payer-catalog-sync.mjs plan --existing existing.json
//   3. Emit:  node scripts/payer-catalog-sync.mjs sql  --existing existing.json > seed.sql
//   4. Apply seed.sql under the service role (Supabase MCP execute_sql or psql).
//   5. Review any new diffs in the app's Payer Directory review queue.
//
// Dedupe (§5): match on stedi_payer_id when the ID is unique on BOTH sides
// (Centene consolidates many plans on 68069, so shared IDs never match-by-ID);
// otherwise match on the canonical lowercased name. An ID-match with a
// differing name is exactly the rename case TS-38 covers.
import { readFileSync } from "node:fs";

// --- CSV (RFC4180-ish: quoted fields, embedded commas/newlines, "" escape) ---
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

// The rankings-artifact row for Wyoming's FFS-only market — a note, not a
// payer entity; never seeded.
const SKIP_SLUGS = new Set(["original-medicare-and-wyoming-medicaid-direct-ffs-enrollment"]);

// Catalog kind = one value per entity. The dataset carries the pipe-joined
// union of per-state dominant lines; collapse deterministically: a diversified
// carrier defaults to commercial (dataset README seeding policy).
const KIND_PRIORITY = [
  "commercial",
  "medicaid_mco",
  "medicare_advantage",
  "tricare",
  "medicare",
  "medicaid",
];
export function collapseKind(kindField) {
  const kinds = new Set(
    String(kindField ?? "")
      .split("|")
      .map((k) => k.trim())
      .filter(Boolean),
  );
  for (const k of KIND_PRIORITY) if (kinds.has(k)) return k;
  return "commercial";
}

const splitList = (v) =>
  String(v ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();

/** payers.csv -> normalized catalog rows. */
export function datasetFromCsv(csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iSlug = idx("payer_slug");
  const iName = idx("name");
  const iKind = idx("payer_kind");
  const iStates = idx("states");
  const iAliases = idx("aliases");
  const iId = idx("clearinghouse_payer_id");
  if ([iSlug, iName, iKind, iStates, iAliases, iId].includes(-1)) {
    throw new Error("payers.csv header is missing an expected column");
  }
  return rows
    .slice(1)
    .filter((r) => !SKIP_SLUGS.has(r[iSlug]))
    .map((r) => ({
      slug: r[iSlug],
      name: r[iName].trim(),
      payerKind: collapseKind(r[iKind]),
      states: splitList(r[iStates]),
      aliases: splitList(r[iAliases]),
      stediPayerId: (r[iId] ?? "").trim() || null,
    }));
}

const nameKey = (n) => n.trim().toLowerCase();
const listKey = (l) => [...l].sort().join("|");

function uniqueIdMap(rows, getId) {
  const counts = new Map();
  for (const r of rows) {
    const id = getId(r);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const map = new Map();
  for (const r of rows) {
    const id = getId(r);
    if (id && counts.get(id) === 1) map.set(id, r);
  }
  return map;
}

/**
 * Plan the sync. existingRows: current global catalog rows
 * ({name, aliases, states, stedi_payer_id, status}). Returns
 * {inserts, diffs, unchanged, missing} — diffs reference the payer by its
 * CURRENT (old) name so the emitted SQL locates the row under the
 * global-name unique index.
 */
export function planCatalogSync(datasetRows, existingRows) {
  const existingByName = new Map(existingRows.map((r) => [nameKey(r.name), r]));
  const existingById = uniqueIdMap(existingRows, (r) => r.stedi_payer_id ?? null);
  const datasetIdUnique = uniqueIdMap(datasetRows, (r) => r.stediPayerId);

  const inserts = [];
  const diffs = [];
  let unchanged = 0;
  const matchedExisting = new Set();

  for (const row of datasetRows) {
    // ID-match only when the ID is unique on both sides (shared clearinghouse
    // IDs like Centene's 68069 must not cross-match plans).
    const byId =
      row.stediPayerId && datasetIdUnique.get(row.stediPayerId) === row
        ? existingById.get(row.stediPayerId)
        : undefined;
    const match = byId ?? existingByName.get(nameKey(row.name));
    if (!match) {
      inserts.push(row);
      continue;
    }
    matchedExisting.add(match);

    const rowDiffs = [];
    if (nameKey(match.name) !== nameKey(row.name)) {
      rowDiffs.push({ field: "name", oldValue: match.name, newValue: row.name });
    }
    if (listKey(match.aliases ?? []) !== listKey(row.aliases)) {
      rowDiffs.push({
        field: "aliases",
        oldValue: listKey(match.aliases ?? []),
        newValue: listKey(row.aliases),
      });
    }
    if (listKey(match.states ?? []) !== listKey(row.states)) {
      rowDiffs.push({
        field: "states",
        oldValue: listKey(match.states ?? []),
        newValue: listKey(row.states),
      });
    }
    // A blank dataset ID never clears a verified one.
    if (row.stediPayerId && (match.stedi_payer_id ?? null) !== row.stediPayerId) {
      rowDiffs.push({
        field: "stedi_payer_id",
        oldValue: match.stedi_payer_id ?? "",
        newValue: row.stediPayerId,
      });
    }
    if (rowDiffs.length === 0) unchanged++;
    else diffs.push(...rowDiffs.map((d) => ({ payerName: match.name, ...d })));
  }

  const missing = existingRows
    .filter((r) => !matchedExisting.has(r) && (r.status ?? "active") === "active")
    .map((r) => r.name);

  return { inserts, diffs, unchanged, missing };
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sqlArray = (list) => (list.length === 0 ? "NULL" : `ARRAY[${list.map(q).join(", ")}]`);

/** Idempotent SQL for a plan: inserts (ON CONFLICT global name) + review-queue
 * diff rows (guarded so re-applying stale SQL never duplicates a pending diff). */
export function emitSeedSql(plan) {
  const lines = [
    "-- Generated by scripts/payer-catalog-sync.mjs (E1.6 F1.6.2).",
    "-- Apply under the service role only. Identity fields only; curated",
    "-- credentialing fields are never written here.",
  ];
  for (const row of plan.inserts) {
    lines.push(
      `INSERT INTO public.payers (org_id, name, payer_kind, aliases, states, stedi_payer_id, status, last_synced_at)\n` +
        `VALUES (NULL, ${q(row.name)}, ${q(row.payerKind)}, ${sqlArray(row.aliases)}, ${sqlArray(row.states)}, ` +
        `${row.stediPayerId ? q(row.stediPayerId) : "NULL"}, 'active', now())\n` +
        `ON CONFLICT (lower(name)) WHERE org_id IS NULL DO NOTHING;`,
    );
  }
  for (const d of plan.diffs) {
    lines.push(
      `INSERT INTO public.payer_catalog_changes (payer_id, field, old_value, new_value, source)\n` +
        `SELECT p.id, ${q(d.field)}, ${q(d.oldValue)}, ${q(d.newValue)}, 'sync'\n` +
        `FROM public.payers p\n` +
        `WHERE lower(p.name) = lower(${q(d.payerName)}) AND p.org_id IS NULL\n` +
        `  AND NOT EXISTS (\n` +
        `    SELECT 1 FROM public.payer_catalog_changes c\n` +
        `    WHERE c.payer_id = p.id AND c.field = ${q(d.field)}\n` +
        `      AND c.new_value = ${q(d.newValue)} AND c.review_state = 'unreviewed');`,
    );
  }
  return lines.join("\n\n") + "\n";
}

// --- CLI ---
const isMain = process.argv[1] && process.argv[1].endsWith("payer-catalog-sync.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  const mode = args[0];
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const csvPath = flag("--csv", "docs/redesign/data/payer-catalog/payers.csv");
  const existingPath = flag("--existing", null);
  if (!mode || !["plan", "sql"].includes(mode) || !existingPath) {
    console.error(
      "Usage: node scripts/payer-catalog-sync.mjs <plan|sql> --existing existing.json [--csv payers.csv]",
    );
    process.exit(2);
  }
  const dataset = datasetFromCsv(readFileSync(csvPath, "utf8"));
  const existing = JSON.parse(readFileSync(existingPath, "utf8"));
  const plan = planCatalogSync(dataset, existing);
  if (mode === "plan") {
    console.log(
      JSON.stringify(
        {
          dataset_rows: dataset.length,
          inserts: plan.inserts.length,
          diffs: plan.diffs.length,
          unchanged: plan.unchanged,
          missing_candidates: plan.missing,
        },
        null,
        2,
      ),
    );
  } else {
    process.stdout.write(emitSeedSql(plan));
  }
}
