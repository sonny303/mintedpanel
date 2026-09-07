#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const expectedArg = process.argv.find((argument) => argument.startsWith("--expect="));
const expected = expectedArg ? Number.parseInt(expectedArg.slice("--expect=".length), 10) : null;
const hookNames = new Set(["useCanWrite", "useIsAdmin", "useRole"]);
const roleValues = new Set(["admin", "specialist", "billing"]);
const comparisonKinds = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function sourceFiles(directory) {
  return readdirSync(directory, { recursive: true })
    .filter((path) => typeof path === "string" && path.endsWith(".tsx"))
    .map((path) => resolve(directory, path))
    .sort();
}

function isRoleIdentifier(node) {
  return ts.isIdentifier(node) && node.text === "role";
}

function roleLiteral(node) {
  return ts.isStringLiteral(node) && roleValues.has(node.text);
}

const sites = [];
const counts = {
  useCanWrite: 0,
  useIsAdmin: 0,
  useRole: 0,
  directComparison: 0,
};

for (const directory of [resolve(root, "src/routes"), resolve(root, "src/components")]) {
  for (const file of sourceFiles(directory)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const relativeFile = file.slice(root.length + 1);

    function record(kind, node) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      counts[kind] += 1;
      sites.push({ file: relativeFile, line, kind });
    }

    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        hookNames.has(node.expression.text)
      ) {
        record(node.expression.text, node);
      }
      if (
        ts.isBinaryExpression(node) &&
        comparisonKinds.has(node.operatorToken.kind) &&
        ((isRoleIdentifier(node.left) && roleLiteral(node.right)) ||
          (roleLiteral(node.left) && isRoleIdentifier(node.right)))
      ) {
        record("directComparison", node);
      }
      ts.forEachChild(node, visit);
    }

    visit(source);
  }
}

const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
const files = new Set(sites.map((site) => site.file));
const output = {
  source: "TypeScript AST scan of production src/routes/**/*.tsx and src/components/**/*.tsx",
  total,
  fileCount: files.size,
  counts,
  sites,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

if (expected !== null && total !== expected) {
  process.stderr.write(`Expected ${expected} frontend role decisions, found ${total}.\n`);
  process.exitCode = 1;
}
