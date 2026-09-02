#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migrationsDir = resolve(root, "supabase/migrations");
const expectedArg = process.argv.find((arg) => arg.startsWith("--expect="));
const expected = expectedArg ? Number(expectedArg.slice("--expect=".length)) : null;

const unquote = (identifier) => identifier.replace(/^"|"$/g, "");
const keyFor = (schema, table, policy) => `${schema}.${table}.${policy}`;

const createPattern =
  /\bCREATE\s+POLICY\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+(?:("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\.)?("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+([\s\S]*?);/gi;
const dropPattern =
  /\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+(?:("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\.)?("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*;/gi;

const policies = new Map();
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

for (const migration of migrations) {
  const sql = readFileSync(resolve(migrationsDir, migration), "utf8");
  const events = [];

  for (const match of sql.matchAll(createPattern)) {
    events.push({
      kind: "create",
      index: match.index,
      policy: unquote(match[1]),
      schema: unquote(match[2] ?? "public"),
      table: unquote(match[3]),
      expression: match[4].trim(),
      migration,
    });
  }
  for (const match of sql.matchAll(dropPattern)) {
    events.push({
      kind: "drop",
      index: match.index,
      policy: unquote(match[1]),
      schema: unquote(match[2] ?? "public"),
      table: unquote(match[3]),
    });
  }

  events.sort((a, b) => a.index - b.index);
  for (const event of events) {
    const key = keyFor(event.schema, event.table, event.policy);
    if (event.kind === "drop") {
      policies.delete(key);
    } else {
      policies.set(key, event);
    }
  }
}

const rows = [...policies.values()]
  .filter((policy) => policy.schema === "public")
  .map((policy) => {
    const expression = policy.expression.toLowerCase();
    const usesUserOrgIds = /\buser_org_ids\s*\(/.test(expression);
    const usesUserRole = /\buser_role\s*\(/.test(expression);
    const usesMembershipsDirectly = /\b(?:public\.)?memberships\b/.test(expression);
    const usesAdminAnywhere = /\buser_is_admin_anywhere\s*\(/.test(expression);
    const membershipDependent =
      usesUserOrgIds || usesUserRole || usesMembershipsDirectly || usesAdminAnywhere;
    const roleAware = usesUserRole || usesAdminAnywhere;
    const command =
      /\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i.exec(policy.expression)?.[1] ?? "ALL";
    return {
      table: policy.table,
      policy: policy.policy,
      command: command.toUpperCase(),
      membershipDependent,
      roleAware,
      usesUserOrgIds,
      usesUserRole,
      usesMembershipsDirectly,
      usesAdminAnywhere,
      migration: policy.migration,
    };
  })
  .sort((a, b) => a.table.localeCompare(b.table) || a.policy.localeCompare(b.policy));

const count = (predicate) => rows.filter(predicate).length;
const byCommand = Object.fromEntries(
  ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"].map((command) => [
    command,
    count((row) => row.command === command),
  ]),
);

const summary = {
  source: "lexicographic final-state replay of checked-in supabase/migrations/*.sql",
  publicPolicyCount: rows.length,
  membershipDependent: count((row) => row.membershipDependent),
  roleAware: count((row) => row.roleAware),
  directMembershipReference: count((row) => row.usesMembershipsDirectly),
  userOrgIdsReference: count((row) => row.usesUserOrgIds),
  userRoleReference: count((row) => row.usesUserRole),
  userIsAdminAnywhereReference: count((row) => row.usesAdminAnywhere),
  notMembershipDependent: count((row) => !row.membershipDependent),
  byCommand,
};

process.stdout.write(`${JSON.stringify({ summary, policies: rows }, null, 2)}\n`);

if (expected !== null && rows.length !== expected) {
  process.stderr.write(
    `Expected ${expected} public policies, but the checked-in migration replay produced ${rows.length}.\n`,
  );
  process.exitCode = 1;
}
