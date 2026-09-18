import { createHash } from "node:crypto";
import { lstat, realpath, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { canonicalDigest } from "../release/contract.mjs";
import { RecoveryError, SOURCE_CA, STAGING, stagingExportEnvironment } from "./contract.mjs";
import { sealStream } from "./encrypted-stream.mjs";
import { createSnapshotSession, SNAPSHOT_CATALOG_SQL } from "./snapshot.mjs";

const CLIENTS = Object.freeze([
  Object.freeze({
    name: "backup",
    path: "/opt/homebrew/Cellar/libpq@17/17.10/bin/pg_dump",
    version: "pg_dump (PostgreSQL) 17.10",
    sha256: "ee6b774f6918a2bfbd1bf145c44564f1074c69710db452e3c6c93d9f7991607f",
    args: Object.freeze([
      "--format=custom",
      "--role=postgres",
      "--no-password",
      "--quote-all-identifiers",
      "--lock-wait-timeout=5s",
      "--dbname=postgres",
    ]),
  }),
  Object.freeze({
    name: "roles",
    path: "/opt/homebrew/Cellar/libpq@17/17.10/bin/pg_dumpall",
    version: "pg_dumpall (PostgreSQL) 17.10",
    sha256: "33606f38193a9770a9fa61c246d871a307705110fe84fa26a73dc548ed5f1278",
    args: Object.freeze([
      "--roles-only",
      "--no-role-passwords",
      "--role=postgres",
      "--no-password",
      "--quote-all-identifiers",
      "--database=postgres",
    ]),
  }),
]);
const PSQL = Object.freeze({
  path: "/opt/homebrew/Cellar/libpq@17/17.10/bin/psql",
  version: "psql (PostgreSQL) 17.10",
  sha256: "295ea30b96e216e4341a0cf3505c27af278295ce9f5ac1725b300ef34ed1f0e3",
  args: Object.freeze([
    "-X",
    "--no-password",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set=ON_ERROR_STOP=1",
    "--dbname=postgres",
  ]),
});
const AGE = process.platform === "darwin" ? "/opt/homebrew/bin/age" : "/usr/bin/age";
const BASE_ENV = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C" });
const SHUTDOWN_MARGIN_MS = 5000;
const VERSION_TIMEOUT_MS = 5000;
const rejected = () => new RecoveryError("RECOVERY_EXPORT_REJECTED");
const requireExport = (value) => {
  if (!value) throw rejected();
};
const iso = (value) => new Date(value).toISOString();

async function privateWorkspace(path, files) {
  requireExport(typeof path === "string" && isAbsolute(path));
  requireExport((await files.realpath(path)) === path);
  let current = path;
  while (current !== parse(current).root) {
    requireExport(!(await files.lstat(current)).isSymbolicLink());
    try {
      await files.lstat(join(current, ".git"));
      throw rejected();
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
    current = dirname(current);
  }
  const stat = await files.lstat(path);
  requireExport(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
  for (const name of ["backup.age", "roles.age"]) {
    try {
      await files.lstat(join(path, name));
      throw rejected();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function executable(path, files, pin) {
  const canonical = await files.realpath(path);
  if (pin) requireExport(canonical === path);
  const stat = await files.lstat(canonical);
  requireExport(
    stat.isFile() &&
      (stat.uid === 0 || stat.uid === process.getuid()) &&
      (stat.mode & 0o022) === 0 &&
      (stat.mode & 0o111) !== 0,
  );
  if (pin) {
    requireExport(stat.size > 0 && stat.size <= 10 * 1024 * 1024);
    const bytes = await files.readFile(canonical);
    requireExport(createHash("sha256").update(bytes).digest("hex") === pin.sha256);
  }
  return canonical;
}

async function certificate(files) {
  requireExport((await files.realpath(SOURCE_CA.path)) === SOURCE_CA.path);
  const stat = await files.lstat(SOURCE_CA.path);
  requireExport(
    stat.isFile() &&
      (stat.uid === 0 || stat.uid === process.getuid()) &&
      (stat.mode & 0o022) === 0 &&
      stat.size > 0 &&
      stat.size <= 64 * 1024,
  );
  const bytes = await files.readFile(SOURCE_CA.path);
  requireExport(createHash("sha256").update(bytes).digest("hex") === SOURCE_CA.sha256);
}

// Capture-only, in-memory entry point. Dependencies are trusted test seams, never
// input/configuration from a release record or CLI. No credential acquisition,
// source SQL identity query, restore, credential revocation, or PASS attestation.
// The watchdog reserves five seconds to stop local clients and waits for close.
// It cannot revoke server roles/backends or guarantee progress during OS/process
// failure or suspension. An unclosed process prevents this API from returning.
export async function captureStagingExport(options, dependencies = {}) {
  return capture(options, dependencies, false);
}

// The owned collector establishes actual catalog/ledger digests. The supplied
// observation remains explicitly declared input, not a proved schema match.
export async function captureStagingSnapshot(options, dependencies = {}) {
  return capture(options, dependencies, true);
}

async function capture(options, dependencies, withSnapshot) {
  const files = dependencies.files ?? { lstat, realpath, readFile };
  const launch = dependencies.spawn ?? spawn;
  const seal = dependencies.seal ?? sealStream;
  const clock = dependencies.clock ?? Date.now;
  const monotonic = dependencies.monotonic ?? (() => performance.now());
  const verifyClient = dependencies.verifyClient ?? ((pin) => executable(pin.path, files, pin));
  const killGroup = dependencies.killGroup ?? ((pid) => process.kill(-pid, "SIGKILL"));
  const active = new Set();
  const sealingJobs = [];
  const cancellation = new AbortController();
  let timer, watchdog, abortSignal, stopReason, deadlineAt, monotonicDeadline;
  let rejectStopped;
  const stopped = new Promise((_, reject) => {
    rejectStopped = reject;
  });
  stopped.catch(() => {});

  function kill(state) {
    if (!state.closed && Number.isSafeInteger(state.child.pid) && state.child.pid > 1) {
      try {
        killGroup(state.child.pid);
      } catch {
        /* Still await close; never claim reaped. */
      }
    }
  }
  function stop() {
    if (!stopReason) {
      stopReason = rejected();
      rejectStopped(stopReason);
    }
    cancellation.abort();
    for (const state of active) kill(state);
  }
  function checkTime() {
    const now = clock();
    const elapsed = monotonic();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(elapsed) ||
      now >= deadlineAt ||
      elapsed >= monotonicDeadline
    )
      stop();
    if (stopReason) throw stopReason;
    return now;
  }
  function start(path, args, environment, input, interactive = false) {
    checkTime();
    const child = launch(path, [...args], {
      shell: false,
      detached: true,
      stdio: [input === undefined && !interactive ? "ignore" : "pipe", "pipe", "ignore"],
      env: { ...environment },
    });
    const state = { child, closed: false };
    active.add(state);
    state.reaped = new Promise((resolveClose) => {
      child.once("close", (code, signal) => {
        state.closed = true;
        active.delete(state);
        resolveClose({ code, signal });
      });
    });
    state.completion = new Promise((resolveExit, rejectExit) => {
      child.once("error", () => rejectExit(rejected()));
      state.reaped.then(({ code, signal }) => {
        if (code === 0 && !signal && !stopReason) resolveExit();
        else rejectExit(rejected());
      });
    });
    state.completion.catch(() => {});
    requireExport(child.stdout && typeof child.stdout.pipe === "function");
    if (input !== undefined) {
      child.stdin.on("error", stop);
      child.stdin.end(input);
    }
    return state;
  }
  async function recipientProbe(age, recipient) {
    // Validate age's recipient parser before any database client can start.
    // This encrypts only a fixed public probe, discarding its ciphertext.
    const state = start(
      age,
      ["--encrypt", "--recipient", recipient],
      BASE_ENV,
      "minted-recovery-recipient-probe\n",
    );
    state.child.stdout.resume();
    state.child.stdout.on("error", stop);
    const timeout = setTimeout(stop, VERSION_TIMEOUT_MS);
    try {
      await Promise.race([state.completion, stopped]);
    } finally {
      clearTimeout(timeout);
    }
  }
  async function version(pin) {
    const state = start(pin.path, ["--version"], BASE_ENV);
    let output = Buffer.alloc(0);
    let overflow = false;
    state.child.stdout.on("data", (chunk) => {
      if (output.length + chunk.length > 256) {
        overflow = true;
        kill(state);
      } else output = Buffer.concat([output, chunk]);
    });
    state.child.stdout.on("error", stop);
    const timeout = setTimeout(() => {
      stop();
    }, VERSION_TIMEOUT_MS);
    try {
      await Promise.race([state.completion, stopped]);
      requireExport(!overflow && output.toString("utf8") === `${pin.version}\n`);
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const required = [
      "response",
      "requestedAt",
      "receivedAt",
      "sourceObserved",
      "workspace",
      "recipient",
    ];
    requireExport(
      options &&
        Object.getPrototypeOf(options) === Object.prototype &&
        required.every((key) => Object.hasOwn(options, key)) &&
        Object.keys(options).every((key) => required.includes(key) || key === "signal"),
    );
    const { workspace, recipient } = options;
    const expectedRole = options.response.role;
    requireExport(options.signal === undefined || options.signal instanceof AbortSignal);
    abortSignal = options.signal;
    requireExport(!abortSignal?.aborted);
    requireExport(
      typeof recipient === "string" &&
        /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient),
    );
    const beganAt = clock();
    const beganMonotonic = monotonic();
    requireExport(Number.isFinite(beganAt) && Number.isFinite(beganMonotonic));
    const login = stagingExportEnvironment({
      response: options.response,
      requestedAt: options.requestedAt,
      receivedAt: options.receivedAt,
      now: iso(beganAt),
      sourceObserved: options.sourceObserved,
    });
    requireExport(login.environment.PGSSLROOTCERT === SOURCE_CA.path);
    // Copy evidence before any await. This digest binds supplied observations;
    // it does not authenticate them or prove a consistent catalog snapshot.
    const sourceObservedDigest = canonicalDigest(options.sourceObserved);
    const source = {
      ...STAGING,
      schemaDigest: options.sourceObserved.source.schemaDigest,
      lineageDigest: options.sourceObserved.source.lineageDigest,
    };
    deadlineAt = Date.parse(login.expiresAt) - SHUTDOWN_MARGIN_MS;
    requireExport(deadlineAt - beganAt >= SHUTDOWN_MARGIN_MS);
    monotonicDeadline = beganMonotonic + deadlineAt - beganAt;
    timer = setTimeout(stop, deadlineAt - beganAt);
    watchdog = setInterval(() => {
      try {
        checkTime();
      } catch {
        stop();
      }
    }, 250);
    abortSignal?.addEventListener("abort", stop, { once: true });
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await privateWorkspace(workspace, files);
    await certificate(files);
    const age = await executable(AGE, files);
    await recipientProbe(age, recipient);
    const clients = withSnapshot ? [...CLIENTS, PSQL] : CLIENTS;
    for (const pin of clients) {
      await verifyClient(pin);
      await version(pin);
    }
    let snapshot, holder, token, catalogBefore, catalogAfter, integrity, lineage, temporaryRole;
    if (withSnapshot) {
      await verifyClient(PSQL);
      await certificate(files);
      holder = start(PSQL.path, PSQL.args, { ...BASE_ENV, ...login.environment }, undefined, true);
      holder.completion.catch(stop);
      snapshot = createSnapshotSession({
        child: holder.child,
        completion: holder.completion,
        checkTime,
        expectedRole,
      });
      token = await snapshot.open();
      catalogBefore = await snapshot.catalog();
      const temporaryRoles = catalogBefore.roles.filter((role) => role?.rolname === expectedRole);
      requireExport(temporaryRoles.length === 1);
      temporaryRole = temporaryRoles[0];
      lineage = await snapshot.lineage(catalogBefore);
      integrity = await snapshot.integrity(catalogBefore);
      for (const ledger of lineage.filter((ledger) => ledger.present)) {
        const table = integrity.tables.find(
          (table) => table.schema === ledger.schema && table.name === ledger.name,
        );
        requireExport(table?.rows === ledger.rows.length);
      }
      source.schemaDigest = canonicalDigest(catalogBefore);
      source.lineageDigest = canonicalDigest(lineage);
    }
    const artifacts = [];
    for (const pin of CLIENTS) {
      // Recheck the pinned file immediately before launching each exporter.
      await verifyClient(pin);
      await certificate(files);
      const args =
        withSnapshot && pin.name === "backup" ? [...pin.args, `--snapshot=${token}`] : pin.args;
      const state = start(pin.path, args, { ...BASE_ENV, ...login.environment });
      const sealing = seal({
        input: state.child.stdout,
        workspace,
        name: pin.name,
        recipient,
        ageBinary: age,
        producerCompletion: state.completion,
        signal: cancellation.signal,
      });
      sealingJobs.push(sealing);
      // A sealer rejection must stop and reap the producer, even after stdout EOF.
      sealing.catch(stop);
      artifacts.push(await Promise.race([sealing, stopped]));
      await state.completion;
      checkTime();
    }
    let snapshotEvidence;
    if (withSnapshot) {
      catalogAfter = await snapshot.afterCatalog();
      requireExport(canonicalDigest(catalogAfter) === canonicalDigest(catalogBefore));
      await snapshot.close();
      snapshotEvidence = {
        method: "single-data-snapshot-catalog-bracketed",
        catalogQueryDigest: canonicalDigest(SNAPSHOT_CATALOG_SQL),
        tokenDigest: canonicalDigest(token),
        catalogBeforeDigest: canonicalDigest(catalogBefore),
        catalogAfterDigest: canonicalDigest(catalogAfter),
        integrityDigest: canonicalDigest(integrity),
        lineageDigest: canonicalDigest(lineage),
        physicalTableCount: integrity.tables.length,
        rowCount: integrity.tables.reduce((sum, t) => sum + t.rows, 0),
        sequenceCount: integrity.sequences.length,
        sequenceTreatment: "NON_MVCC_OBSERVATION",
        sourceEvidence: "OWNED_SNAPSHOT_COLLECTOR",
        declaredSchemaMatch: "NOT_CLAIMED",
        lineageMeaning: "OBSERVED_DATABASE_LEDGERS_ONLY",
        temporaryLoginRolePresence: "PRESENT",
        temporaryLoginRoleDigest: canonicalDigest(temporaryRole),
        temporaryLoginRoleDependencyReview: "PENDING",
      };
      for (const [name, value] of [
        ["schema", { before: catalogBefore, after: catalogAfter }],
        ["integrity", integrity],
        ["migration-lineage", lineage],
      ]) {
        checkTime();
        const sealing = seal({
          input: Readable.from([JSON.stringify(value)]),
          workspace,
          name,
          recipient,
          ageBinary: age,
          producerCompletion: holder.completion,
          signal: cancellation.signal,
        });
        sealingJobs.push(sealing);
        sealing.catch(stop);
        artifacts.push(await Promise.race([sealing, stopped]));
        checkTime();
      }
    }
    const capturedAt = checkTime();
    requireExport(capturedAt >= beganAt);
    return {
      version: 1,
      status: "CAPTURED_ONLY",
      source,
      ...(withSnapshot
        ? { declaredInputObservationDigest: sourceObservedDigest }
        : { sourceObservedDigest }),
      sourceCa: { ...SOURCE_CA },
      startedAt: iso(beganAt),
      capturedAt: iso(capturedAt),
      conservativeCredentialExpiresAt: login.expiresAt,
      sourceProcessStopDeadline: iso(deadlineAt),
      clientIdentities: clients.map(({ path, version, sha256 }) => ({ path, version, sha256 })),
      fixedCommandsDigest: canonicalDigest(
        clients.map(({ name, path, args }) => ({
          ...(name ? { name } : {}),
          path,
          args: withSnapshot && name === "backup" ? [...args, `--snapshot=${token}`] : args,
        })),
      ),
      artifacts,
      ...(withSnapshot ? { snapshot: snapshotEvidence } : {}),
      remainingPrerequisites: [
        "CATALOG_AND_SCHEMA_SNAPSHOT_BINDING",
        "FULL_SCOPE_RECONCILIATION",
        "GLOBALS_AND_ARCHIVE_COMPATIBILITY",
        "CREDENTIAL_REVOCATION_VERIFICATION",
        "DECRYPTION_AND_RESTORE_REHEARSAL",
        "AUTH_REST_AND_DATA_INTEGRITY_VERIFICATION",
        ...(withSnapshot
          ? [
              "SOURCE_LOCAL_CATALOG_NORMALIZATION",
              "REPOSITORY_MIGRATION_INVENTORY",
              "EXTENSION_AND_UNSUPPORTED_OBJECT_COVERAGE",
              "SEQUENCE_ARCHIVE_RECONCILIATION",
              "LIVE_SQL_AND_POOLER_SNAPSHOT_VERIFICATION",
            ]
          : []),
      ],
    };
  } catch {
    stop();
    throw rejected();
  } finally {
    clearTimeout(timer);
    clearInterval(watchdog);
    abortSignal?.removeEventListener("abort", stop);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    // close, not stdout EOF/exit, is the reaping boundary. SIGKILL is issued to
    // each dedicated process group; no retry or replacement login is attempted.
    for (const state of active) kill(state);
    await Promise.all([...active].map((state) => state.reaped));
    await Promise.allSettled(sealingJobs);
  }
}

// Credential transport is deliberately not a CLI feature. A later reviewed
// coordinator may call the in-memory API with an approved fresh login response.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write('{"ok":false,"code":"RECOVERY_EXPORT_REJECTED"}\n');
  process.exitCode = 2;
}
