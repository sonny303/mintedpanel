#!/usr/bin/env node
// Epic + scenario hygiene lint.
//
// These are the mechanical checks that used to be done by eye during an epic
// review — and were repeatedly missed, because reading for them is exactly the
// kind of work a human or an agent does badly. The TS-141/142/143 collision
// (E6.9 claimed three ids that e2e/people-contact-roles.spec.ts had already
// shipped) survived three review rounds; it is a set comparison.
//
// What this CANNOT do: decide that two workstreams mean different things by the
// same id. Detection there needs semantics. What prevents that collision is a
// single allocator — run `node scripts/check-epic-hygiene.mjs --next` and claim
// ids from there, never by eyeballing the end of the table.
//
// Usage:
//   node scripts/check-epic-hygiene.mjs          # lint; non-zero exit on error
//   node scripts/check-epic-hygiene.mjs --next   # print the next free TS id
//
// Plain JS + node builtins only, like the other scripts/*.mjs gate tooling.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const REDESIGN = join(ROOT, "docs/redesign");
const SEED_UNIVERSE = join(REDESIGN, "seed-universe.md");
const TABLE_REGISTER = join(ROOT, "docs/data-model/table-register.md");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const E2E = join(ROOT, "e2e");

const errors = [];
const notes = [];

const read = (path) => readFileSync(path, "utf8");
const tsIds = (text) => text.match(/TS-\d+/g) ?? [];
const idNumber = (id) => Number.parseInt(id.slice(3), 10);

// An epic file is EX.Y-slug.md. The template and the handoff docs are not epics.
const epicFiles = readdirSync(REDESIGN).filter((f) => /^E\d+\.\d+[a-z]?-.+\.md$/.test(f));

// ---------------------------------------------------------------------------
// 1. seed-universe is the scenario registry: one row per TS id, no duplicates.
// ---------------------------------------------------------------------------
const seedText = read(SEED_UNIVERSE);
const registered = new Map(); // id -> first row's purpose text
const seenTwice = new Set();
for (const line of seedText.split("\n")) {
  const match = /^\|\s*(TS-\d+)\s*\|([^|]*)\|/.exec(line);
  if (!match) continue;
  const [, id, purpose] = match;
  if (registered.has(id)) seenTwice.add(id);
  else registered.set(id, purpose.trim());
}
for (const id of [...seenTwice].sort()) {
  errors.push(`${id} has more than one row in seed-universe.md — one id, one owner.`);
}

// ---------------------------------------------------------------------------
// 2. Every TS id an epic cites must be registered.
//
// Deliberately NOT "one epic per id": epics legitimately cite a neighbour's
// scenarios (E2.4 builds on TS-48/50; E1.1 updates TS-27/28 fixtures). A
// cited-by-one-file rule fires on 28 healthy cross-references and would be
// turned off within a week.
// ---------------------------------------------------------------------------
for (const file of epicFiles) {
  const body = read(join(REDESIGN, file));
  for (const id of new Set(tsIds(body))) {
    if (!registered.has(id)) {
      errors.push(`${file} cites ${id}, which has no row in seed-universe.md.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Every TS id an e2e spec implements must be registered too — a spec that
//    invents an id is how two workstreams end up on the same number.
// ---------------------------------------------------------------------------
if (existsSync(E2E)) {
  for (const file of readdirSync(E2E).filter((f) => f.endsWith(".ts"))) {
    const body = read(join(E2E, file));
    for (const id of new Set(tsIds(body))) {
      if (!registered.has(id)) {
        errors.push(`e2e/${file} implements ${id}, which has no row in seed-universe.md.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Epic frontmatter shape. `reviewed` is retired as a build gate (a merged
//    epic is an approved epic), so it is no longer required — but a file that
//    still carries one must not contradict a built epic silently.
// ---------------------------------------------------------------------------
for (const file of epicFiles) {
  const body = read(join(REDESIGN, file));
  if (!body.startsWith("---")) {
    errors.push(`${file} has no frontmatter block.`);
    continue;
  }
  const frontmatter = body.slice(3, body.indexOf("\n---", 3));
  for (const key of ["epic", "title", "stage", "owner"]) {
    if (!new RegExp(`^${key}:`, "m").test(frontmatter)) {
      errors.push(`${file} frontmatter is missing \`${key}\`.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Every table a migration creates has a row in the table register
//    (the AGENTS.md rule, checked instead of remembered).
// ---------------------------------------------------------------------------
const registerText = read(TABLE_REGISTER);
const createdTables = new Set();
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
  const body = read(join(MIGRATIONS, file));
  for (const m of body.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)/gi)) {
    createdTables.add(m[1]);
  }
}
for (const table of [...createdTables].sort()) {
  if (!new RegExp(`^\\|\\s*${table}\\s*\\|`, "m").test(registerText)) {
    errors.push(
      `Table \`${table}\` is created by a migration but has no row in table-register.md.`,
    );
  }
}
notes.push(`${createdTables.size} tables created across migrations, all registered.`);

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------
const nextId = Math.max(0, ...[...registered.keys()].map(idNumber)) + 1;

if (process.argv.includes("--next")) {
  process.stdout.write(`TS-${nextId}\n`);
  process.exit(0);
}

if (errors.length > 0) {
  process.stdout.write(`Epic hygiene: ${errors.length} problem(s)\n\n`);
  for (const e of errors) process.stdout.write(`  ✗ ${e}\n`);
  process.stdout.write(`\nNext free scenario id: TS-${nextId}\n`);
  process.exit(1);
}

process.stdout.write("Epic hygiene: clean\n");
for (const n of notes) process.stdout.write(`  · ${n}\n`);
process.stdout.write(`  · ${registered.size} scenarios registered; next free id TS-${nextId}\n`);
