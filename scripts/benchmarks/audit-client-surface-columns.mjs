#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const typesPath = resolve(root, "src/integrations/supabase/types.ts");
const documentPath = resolve(root, "docs/spikes/S2-client-safe-data-surface.md");

const sourceTables = [
  "providers",
  "credential_cases",
  "contracts",
  "provider_groups",
  "facilities",
  "launches",
  "tasks",
  "touches",
  "status_configs",
  "status_history",
  "provider_documents",
  "payers",
  "msos",
  "audit_log",
  "provider_group_assignments",
  "provider_facility_assignments",
  "case_facilities",
  "payer_network_targets",
  "enrollment_facts",
  "state_licenses",
  "organizations",
  "case_status_history",
  "case_generation_exclusions",
];

function generatedColumns(source, table) {
  const lines = source.split("\n");
  const tableStart = lines.findIndex((line) => line === `      ${table}: {`);
  if (tableStart < 0) throw new Error(`Generated types are missing table ${table}`);
  const rowStart = lines.findIndex(
    (line, index) => index > tableStart && line === "        Row: {",
  );
  if (rowStart < 0) throw new Error(`Generated types are missing ${table}.Row`);

  const columns = [];
  for (let index = rowStart + 1; index < lines.length; index += 1) {
    if (lines[index] === "        };") return columns;
    const match = /^          ([A-Za-z0-9_]+): /.exec(lines[index]);
    if (match) columns.push(match[1]);
  }
  throw new Error(`Generated types have an unterminated ${table}.Row`);
}

const generated = new Map(
  sourceTables.map((table) => [
    table,
    new Set(generatedColumns(readFileSync(typesPath, "utf8"), table)),
  ]),
);
const classified = new Map(sourceTables.map((table) => [table, new Map()]));
const headingCounts = new Map();
const extras = [];
const duplicates = [];
let activeTable = null;

for (const line of readFileSync(documentPath, "utf8").split("\n")) {
  const heading = /^### `([^`]+)` \((\d+)\)$/.exec(line);
  if (heading) {
    activeTable = sourceTables.includes(heading[1]) ? heading[1] : null;
    if (activeTable) headingCounts.set(activeTable, Number.parseInt(heading[2], 10));
    continue;
  }
  if (!activeTable) continue;

  const row = /^\| ((?:`[^`]+`(?:, )?)+) \| \*\*(Visible|Masked|Never)\*\* \|/.exec(line);
  if (!row) continue;
  const verdict = row[2].toLowerCase();
  for (const token of row[1].matchAll(/`([^`]+)`/g)) {
    const column = token[1];
    const tableClassifications = classified.get(activeTable);
    if (!tableClassifications || !generated.get(activeTable)?.has(column)) {
      extras.push(`${activeTable}.${column}`);
      continue;
    }
    if (tableClassifications.has(column)) duplicates.push(`${activeTable}.${column}`);
    tableClassifications.set(column, verdict);
  }
}

const missing = [];
const countMismatches = [];
const verdictCounts = { visible: 0, masked: 0, never: 0 };
for (const table of sourceTables) {
  const expected = generated.get(table) ?? new Set();
  const actual = classified.get(table) ?? new Map();
  for (const column of expected) {
    if (!actual.has(column)) missing.push(`${table}.${column}`);
  }
  const headingCount = headingCounts.get(table);
  if (headingCount !== expected.size) {
    countMismatches.push(
      `${table}: heading=${headingCount ?? "missing"}, generated=${expected.size}`,
    );
  }
  for (const verdict of actual.values()) verdictCounts[verdict] += 1;
}

const generatedColumnCount = [...generated.values()].reduce(
  (total, columns) => total + columns.size,
  0,
);
const classifiedColumnCount = Object.values(verdictCounts).reduce(
  (total, count) => total + count,
  0,
);

const result = {
  source: "src/integrations/supabase/types.ts Row definitions",
  document: "docs/spikes/S2-client-safe-data-surface.md",
  tableCount: sourceTables.length,
  generatedColumnCount,
  classifiedColumnCount,
  verdictCounts,
  missing,
  extras,
  duplicates,
  countMismatches,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (
  generatedColumnCount !== classifiedColumnCount ||
  missing.length > 0 ||
  extras.length > 0 ||
  duplicates.length > 0 ||
  countMismatches.length > 0
) {
  process.exitCode = 1;
}
