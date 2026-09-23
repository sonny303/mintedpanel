import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkHistory,
  readInventory,
  requireMigration,
  MigrationError,
  hash,
} from "./inventory.mjs";
import { validatePlan } from "./runner.mjs";

function baseInventory(sha) {
  requireMigration(/^[a-f0-9]{40}$/.test(sha), "BASE_SHA_REQUIRED");
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const paths = git(["ls-tree", "-r", "--name-only", sha, "--", "supabase/migrations"])
    .trim()
    .split("\n")
    .filter((path) => path.endsWith(".sql"))
    .sort();
  return paths.map((path) => ({
    id: path.split("/").at(-1).slice(0, 14),
    path,
    sha256: hash(execFileSync("git", ["show", `${sha}:${path}`], { cwd: root })),
  }));
}

const root = fileURLToPath(new URL("../../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));

export async function runCommand(args, env = process.env) {
  const [command, target] = args;
  requireMigration(
    (command === "check" && args.length === 1) ||
      (command === "readiness" && args.length === 2 && ["staging", "production"].includes(target)),
    "COMMAND_REJECTED",
  );
  const inventory = await readInventory(root);
  checkHistory(inventory, await json("scripts/migrations/history-lock.json"));
  if (env.MINTED_MIGRATION_BASE_SHA)
    checkHistory(inventory, baseInventory(env.MINTED_MIGRATION_BASE_SHA));
  if (command === "check") return { status: "INVENTORY_VALID", count: inventory.length };
  const plan = await json(`scripts/migrations/plans/${target}.json`);
  validatePlan(plan, inventory);
  return { status: "PLAN_READY", target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runCommand(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ status: "BLOCKED", code: error instanceof MigrationError ? error.code : "MIGRATION_RELEASE_BLOCKED" })}\n`,
    );
    process.exitCode = 1;
  }
}
