import test from "node:test";
import assert from "node:assert/strict";
import { captureStagingExport } from "./export.mjs";
import { SOURCE_CA, STAGING } from "./contract.mjs";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  chmod,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  lstat,
  realpath,
  symlink,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { sealStream, verifySealed } from "./encrypted-stream.mjs";

const NOW = Date.parse("2026-09-08T22:00:00.000Z");
const iso = (value) => new Date(value).toISOString();
function options() {
  return {
    response: {
      role: "cli_login_synthetic",
      password: "synthetic-secret-canary",
      ttl_seconds: 900,
    },
    requestedAt: iso(NOW),
    receivedAt: iso(NOW),
    sourceObserved: {
      capturedAt: iso(NOW),
      source: { ...STAGING, schemaDigest: "a".repeat(64), lineageDigest: "b".repeat(64) },
    },
    workspace: "/private/tmp/synthetic-capture",
    recipient: `age1${"a".repeat(58)}`,
  };
}

const bin = process.platform === "darwin" ? "/opt/homebrew/bin" : "/usr/bin";
const ageBinary = join(bin, "age");
const keygen = join(bin, "age-keygen");
assert.equal(spawnSync(ageBinary, ["--version"]).status, 0, "Install age before recovery tests");
assert.equal(
  spawnSync(keygen, ["--version"]).status,
  0,
  "Install age-keygen before recovery tests",
);

async function setup(t) {
  const workspace = await mkdtemp(join(realpathSync(tmpdir()), "minted-export-synthetic-"));
  await chmod(workspace, 0o700);
  t.after(() => rm(workspace, { force: true, recursive: true }));
  const key = spawnSync(keygen, [], { encoding: "utf8" });
  assert.equal(key.status, 0);
  const identityPath = join(workspace, "identity.txt");
  await writeFile(identityPath, key.stdout, { mode: 0o600 });
  const recipient = spawnSync(keygen, ["-y", identityPath], { encoding: "utf8" }).stdout.trim();
  return { ...options(), workspace, recipient, identityPath };
}

function harness(settings = {}) {
  const calls = [],
    children = [],
    reaped = [],
    kills = [],
    attestations = [];
  // Trusted test adapters replace only executable attestation/launch. These
  // fixtures never invoke PostgreSQL or connect to any database.
  const dependencies = {
    clock: () => NOW,
    verifyClient: async (pin) => {
      attestations.push(pin);
    },
    spawn(path, args, configuration) {
      if (basename(path) === "age") return spawn(path, args, configuration);
      calls.push({ path, args, configuration });
      const isVersion = args[0] === "--version";
      const isRoles = basename(path) === "pg_dumpall";
      let program = isVersion
        ? `process.stdout.write(${JSON.stringify(`${basename(path)} (PostgreSQL) 17.10\n`)});`
        : `process.stdout.write(${JSON.stringify(isRoles ? 'CREATE ROLE "synthetic_role";\n' : "PGDMPsynthetic-archive-canary")});`;
      program = settings.program?.({ isVersion, isRoles, program }) ?? program;
      const child = spawn(process.execPath, ["-e", program], configuration);
      children.push(child);
      child.once("close", () => reaped.push(child.pid));
      settings.started?.({ child, isVersion, isRoles });
      return child;
    },
    killGroup(pid) {
      kills.push(pid);
      process.kill(-pid, "SIGKILL");
    },
  };
  return { dependencies, calls, children, reaped, kills, attestations };
}
function captureOptions(fixture) {
  const { identityPath, ...result } = fixture;
  return result;
}
const redacted = (error) => {
  assert.equal(error.code, "RECOVERY_EXPORT_REJECTED");
  assert.equal(error.message, "RECOVERY_EXPORT_REJECTED");
  assert.equal(error.cause, undefined);
  return true;
};

for (const [name, mutate] of [
  [
    "wrong source ref",
    (value) => {
      value.sourceObserved.source.ref = "fkvuhfsqcmujywzgczmc";
    },
  ],
  [
    "wrong pooler",
    (value) => {
      value.sourceObserved.source.host = "private-canary.example";
    },
  ],
  [
    "expired login",
    (value) => {
      value.requestedAt = iso(NOW - 900001);
    },
  ],
  [
    "future login receipt",
    (value) => {
      value.receivedAt = iso(NOW + 1);
    },
  ],
  [
    "stale metadata",
    (value) => {
      value.sourceObserved.capturedAt = iso(NOW - 300001);
    },
  ],
  [
    "insufficient shutdown margin",
    (value) => {
      value.response.ttl_seconds = 9;
    },
  ],
  [
    "invalid recipient",
    (value) => {
      value.recipient = "private-canary";
    },
  ],
  [
    "invalid abort signal",
    (value) => {
      value.signal = {};
    },
  ],
]) {
  test(`${name} rejects before subprocess launch`, async () => {
    const value = options();
    mutate(value);
    const h = harness();
    await assert.rejects(captureStagingExport(value, h.dependencies), redacted);
    assert.equal(h.calls.length, 0);
  });
}

test("captures both encrypted streams with exact targets, minimal environment, and capture-only evidence", async (t) => {
  const fixture = await setup(t);
  const h = harness();
  const result = await captureStagingExport(captureOptions(fixture), h.dependencies);
  assert.equal(result.status, "CAPTURED_ONLY");
  assert.equal(result.source.ref, STAGING.ref);
  assert.equal(result.sourceProcessStopDeadline, iso(NOW + 895000));
  assert.equal(result.conservativeCredentialExpiresAt, iso(NOW + 900000));
  assert.equal(result.artifacts.length, 2);
  assert.ok(result.remainingPrerequisites.includes("FULL_SCOPE_RECONCILIATION"));
  assert.ok(result.remainingPrerequisites.includes("CREDENTIAL_REVOCATION_VERIFICATION"));
  assert.ok(!JSON.stringify(result).includes("synthetic-secret-canary"));
  assert.ok(!JSON.stringify(result).includes("cli_login_synthetic"));
  assert.equal(h.attestations.length, 4);
  assert.deepEqual(
    h.calls.map((call) => call.args),
    [
      ["--version"],
      ["--version"],
      [
        "--format=custom",
        "--role=postgres",
        "--no-password",
        "--quote-all-identifiers",
        "--lock-wait-timeout=5s",
        "--dbname=postgres",
      ],
      [
        "--roles-only",
        "--no-role-passwords",
        "--role=postgres",
        "--no-password",
        "--quote-all-identifiers",
        "--database=postgres",
      ],
    ],
  );
  for (const call of h.calls) {
    assert.equal(call.configuration.shell, false);
    assert.equal(call.configuration.detached, true);
    assert.deepEqual(call.configuration.stdio, ["ignore", "pipe", "ignore"]);
    assert.ok(!JSON.stringify(call.args).includes("synthetic-secret-canary"));
    const env = call.configuration.env;
    if (call.args[0] === "--version") {
      assert.deepEqual(env, { PATH: "/usr/bin:/bin", LANG: "C" });
    } else {
      assert.deepEqual(
        Object.keys(env).sort(),
        [
          "LANG",
          "PATH",
          "PGAPPNAME",
          "PGCONNECT_TIMEOUT",
          "PGDATABASE",
          "PGHOST",
          "PGOPTIONS",
          "PGPASSWORD",
          "PGPORT",
          "PGSSLMODE",
          "PGSSLROOTCERT",
          "PGUSER",
        ].sort(),
      );
      assert.equal(env.PGHOST, STAGING.host);
      assert.equal(env.PGPORT, "5432");
      assert.equal(env.PGDATABASE, "postgres");
      assert.equal(env.PGUSER, `cli_login_synthetic.${STAGING.ref}`);
      assert.equal(env.PGPASSWORD, "synthetic-secret-canary");
      assert.equal(env.PGSSLMODE, "verify-full");
      assert.equal(env.PGSSLROOTCERT, SOURCE_CA.path);
      assert.match(env.PGOPTIONS, /default_transaction_read_only=on/);
    }
  }
  for (const artifact of result.artifacts) {
    const ciphertext = await readFile(join(fixture.workspace, `${artifact.name}.age`));
    assert.equal(artifact.sha256, createHash("sha256").update(ciphertext).digest("hex"));
    assert.ok(!ciphertext.includes(Buffer.from("synthetic-archive-canary")));
    assert.deepEqual(await verifySealed({ ...fixture, name: artifact.name, ageBinary }), artifact);
  }
  assert.equal(h.reaped.length, 4);
  assert.equal(h.kills.length, 0);
});

for (const kind of ["permission", "symlink", "git", "existing-backup", "existing-roles"]) {
  test(`rejects private workspace ${kind} before even version launch`, async (t) => {
    const fixture = await setup(t);
    const value = captureOptions(fixture);
    if (kind === "permission") await chmod(value.workspace, 0o755);
    if (kind === "symlink") {
      value.workspace = join(fixture.workspace, "alias");
      await symlink(fixture.workspace, value.workspace);
    }
    if (kind === "git") await mkdir(join(value.workspace, ".git"));
    if (kind.startsWith("existing-"))
      await writeFile(join(value.workspace, `${kind.slice(9)}.age`), "existing", { mode: 0o600 });
    const h = harness();
    await assert.rejects(captureStagingExport(value, h.dependencies), redacted);
    assert.equal(h.calls.length, 0);
  });
}

for (const kind of ["hash", "mode", "owner", "symlink", "size", "not-file"]) {
  test(`native client ${kind} mismatch rejects before launching a source process`, async (t) => {
    const fixture = await setup(t);
    const h = harness();
    delete h.dependencies.verifyClient;
    h.dependencies.files = {
      async realpath(path) {
        return path.includes("/libpq@17/")
          ? kind === "symlink"
            ? `${path}.other`
            : path
          : realpath(path);
      },
      async lstat(path) {
        if (!path.includes("/libpq@17/")) return lstat(path);
        return {
          uid: kind === "owner" ? 999999 : process.getuid(),
          mode: kind === "mode" ? 0o777 : 0o555,
          size: kind === "size" ? 0 : 16,
          isFile: () => kind !== "not-file",
        };
      },
      async readFile(path) {
        return path.includes("/libpq@17/") ? Buffer.from("changed-client-canary") : readFile(path);
      },
    };
    await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
    assert.equal(h.calls.length, 0);
  });
}

for (const program of [
  'process.stdout.write("pg_dump (PostgreSQL) 18.4\\n");',
  'process.stderr.write("private-canary"); process.exit(3);',
  'process.stdout.write("private-canary".repeat(1000));',
]) {
  test("bad version output or exit fails without connecting or leaking diagnostics", async (t) => {
    const fixture = await setup(t);
    const h = harness({
      program: ({ isVersion, program: normal }) => (isVersion ? program : normal),
    });
    await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
    assert.equal(h.calls.length, 1);
    assert.equal(h.reaped.length, 1);
  });
}

test("late producer nonzero exit after EOF never publishes the archive", async (t) => {
  const fixture = await setup(t);
  const h = harness({
    program: ({ isVersion, program }) =>
      isVersion
        ? program
        : 'process.stdout.end("PGDMPsynthetic"); process.stderr.write(process.env.PGPASSWORD); setTimeout(() => process.exit(4), 75);',
  });
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.equal(h.calls.length, 3);
  assert.equal(h.reaped.length, 3);
  assert.deepEqual(await readdir(fixture.workspace), ["identity.txt"]);
});

test("failed role capture preserves an already encrypted archive but returns no success record", async (t) => {
  const fixture = await setup(t);
  const h = harness({
    program: ({ isRoles, isVersion, program }) =>
      isRoles && !isVersion ? "process.exit(5);" : program,
  });
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.deepEqual((await readdir(fixture.workspace)).sort(), ["backup.age", "identity.txt"]);
  assert.equal(h.reaped.length, 4);
});

for (const boundary of ["abort", "wall-deadline", "monotonic-deadline", "nonfinite-clock"]) {
  test(`${boundary} kills the dedicated source group and awaits close after stdout EOF`, async (t) => {
    const fixture = await setup(t);
    const controller = new AbortController();
    let now = NOW,
      elapsed = 0;
    const h = harness({
      program: ({ isVersion, program }) =>
        isVersion ? program : 'process.stdout.end("PGDMPsynthetic"); setInterval(() => {}, 1000);',
      started({ isVersion }) {
        if (!isVersion)
          setTimeout(() => {
            if (boundary === "abort") controller.abort();
            if (boundary === "wall-deadline") now += 895001;
            if (boundary === "monotonic-deadline") {
              now -= 5000;
              elapsed = 895001;
            }
            if (boundary === "nonfinite-clock") now = Number.NaN;
          }, 50);
      },
    });
    h.dependencies.clock = () => now;
    h.dependencies.monotonic = () => elapsed;
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    await assert.rejects(
      captureStagingExport(
        { ...captureOptions(fixture), signal: controller.signal },
        h.dependencies,
      ),
      redacted,
    );
    assert.ok(h.kills.includes(h.children[2].pid));
    assert.equal(h.reaped.length, 3);
    assert.deepEqual(await readdir(fixture.workspace), ["identity.txt"]);
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before);
  });
}

test("pre-aborted capture launches nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const h = harness();
  await assert.rejects(
    captureStagingExport({ ...options(), signal: controller.signal }, h.dependencies),
    redacted,
  );
  assert.equal(h.calls.length, 0);
});

test("encryption failure kills and reaps the exporter", async (t) => {
  const fixture = await setup(t);
  const h = harness({
    program: ({ isVersion, program }) => (isVersion ? program : "setInterval(() => {}, 1000);"),
  });
  h.dependencies.seal = async () => {
    throw new Error("private-canary");
  };
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.equal(h.reaped.length, 3);
  assert.ok(h.kills.includes(h.children[2].pid));
});

test("spawn failure is redacted and does not retry", async (t) => {
  const fixture = await setup(t);
  const h = harness();
  let launches = 0;
  h.dependencies.spawn = () => {
    launches += 1;
    throw new Error("private-canary");
  };
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.equal(launches, 1);
});

test("tamper after a successful version check is rejected before the source launch", async (t) => {
  const fixture = await setup(t);
  const h = harness();
  let attestations = 0;
  h.dependencies.verifyClient = async () => {
    if (++attestations === 3) throw new Error("private-canary");
  };
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.equal(h.calls.length, 2);
});

test("direct CLI refuses capture and does not echo args, stdin, or inherited credentials", () => {
  const cli = spawnSync(
    process.execPath,
    [new URL("./export.mjs", import.meta.url).pathname, "--password=private-canary"],
    {
      input: "private-canary",
      encoding: "utf8",
      timeout: 5000,
      env: { PATH: "/usr/bin:/bin", PGPASSWORD: "private-canary" },
    },
  );
  assert.equal(cli.status, 2);
  assert.equal(cli.stdout, '{"ok":false,"code":"RECOVERY_EXPORT_REJECTED"}\n');
  assert.equal(cli.stderr, "");
});

test("age checksum rejection happens before any PostgreSQL version or source launch", async (t) => {
  const fixture = await setup(t);
  const h = harness();
  await assert.rejects(
    captureStagingExport(
      { ...captureOptions(fixture), recipient: `age1${"a".repeat(58)}` },
      h.dependencies,
    ),
    redacted,
  );
  assert.equal(h.calls.length, 0);
  assert.deepEqual(await readdir(fixture.workspace), ["identity.txt"]);
});

test("asynchronous spawn error is redacted and reaped", async (t) => {
  const fixture = await setup(t);
  const h = harness();
  const usual = h.dependencies.spawn;
  let reaped = false;
  h.dependencies.spawn = (path, args, configuration) => {
    if (basename(path) === "age") return usual(path, args, configuration);
    const child = spawn("/private/tmp/no-such-minted-export-test-client", args, configuration);
    child.once("close", () => {
      reaped = true;
    });
    return child;
  };
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.equal(reaped, true);
});

test("version probe timeout kills and reaps a hung probe", async (t) => {
  const fixture = await setup(t);
  const h = harness({ program: () => "setInterval(() => {}, 1000);" });
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.equal(h.calls.length, 1);
  assert.equal(h.reaped.length, 1);
  assert.ok(h.kills.includes(h.children[0].pid));
});

test("SIGTERM requests shutdown and restores the caller's signal listeners", async (t) => {
  const fixture = await setup(t);
  const before = process.listenerCount("SIGTERM");
  const h = harness({
    program: ({ isVersion, program }) => (isVersion ? program : "setInterval(() => {}, 1000);"),
    started: ({ isVersion }) => {
      if (!isVersion) setTimeout(() => process.emit("SIGTERM"), 30);
    },
  });
  await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
  assert.equal(h.reaped.length, 3);
  assert.ok(h.kills.includes(h.children[2].pid));
  assert.equal(process.listenerCount("SIGTERM"), before);
});

for (const clock of [() => Number.NaN, () => Infinity]) {
  test("invalid initial clock rejects before subprocess launch", async () => {
    const h = harness();
    h.dependencies.clock = clock;
    await assert.rejects(captureStagingExport(options(), h.dependencies), redacted);
    assert.equal(h.calls.length, 0);
  });
}

for (const key of [
  "host",
  "target",
  "binary",
  "args",
  "sql",
  "ageBinary",
  "caPath",
  "sslRootCert",
]) {
  test(`rejects caller-supplied ${key} before any subprocess`, async () => {
    let launches = 0;
    await assert.rejects(
      captureStagingExport(
        { ...options(), [key]: "private-canary" },
        {
          clock: () => NOW,
          spawn: () => {
            launches += 1;
            throw new Error("private-canary");
          },
        },
      ),
      (error) => error.code === "RECOVERY_EXPORT_REJECTED" && !error.message.includes("canary"),
    );
    assert.equal(launches, 0);
  });
}

for (const kind of ["hash", "mode", "owner", "symlink", "size", "not-file", "missing"]) {
  test(`source CA ${kind} mismatch rejects before any database client launch`, async (t) => {
    const fixture = await setup(t);
    const h = harness();
    h.dependencies.files = {
      async realpath(path) {
        if (path !== SOURCE_CA.path) return realpath(path);
        if (kind === "missing") throw new Error("private-canary");
        return kind === "symlink" ? `${path}.other` : path;
      },
      async lstat(path) {
        if (path !== SOURCE_CA.path) return lstat(path);
        return {
          uid: kind === "owner" ? 999999 : process.getuid(),
          mode: kind === "mode" ? 0o666 : 0o644,
          size: kind === "size" ? 0 : 1024,
          isFile: () => kind !== "not-file",
        };
      },
      async readFile(path) {
        return path === SOURCE_CA.path ? Buffer.from("changed-ca-canary") : readFile(path);
      },
    };
    await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
    assert.equal(h.calls.length, 0);
  });
}

for (const failingCheck of [2, 3]) {
  test(`CA tamper before source launch ${failingCheck - 1} prevents that launch`, async (t) => {
    const fixture = await setup(t);
    const h = harness();
    let reads = 0;
    h.dependencies.files = {
      realpath,
      lstat,
      async readFile(path) {
        if (path === SOURCE_CA.path && ++reads === failingCheck)
          return Buffer.from("changed-ca-canary");
        return readFile(path);
      },
    };
    await assert.rejects(captureStagingExport(captureOptions(fixture), h.dependencies), redacted);
    assert.equal(h.calls.length, failingCheck);
  });
}

for (const boundary of ["abort", "deadline"]) {
  test(`${boundary} reaps suspended encryption after the successful exporter has already closed`, async (t) => {
    const fixture = await setup(t);
    const controller = new AbortController();
    let encryption,
      encryptionClosed = false,
      forcedCleanup = false,
      now = NOW;
    let notifyAgeStarted, notifyProducerClosed;
    const ageStarted = new Promise((resolve) => {
      notifyAgeStarted = resolve;
    });
    const producerClosed = new Promise((resolve) => {
      notifyProducerClosed = resolve;
    });
    const h = harness({
      started({ child, isVersion }) {
        if (!isVersion) child.once("close", notifyProducerClosed);
      },
    });
    h.dependencies.clock = () => now;
    h.dependencies.seal = (value) =>
      sealStream(value, {
        spawn(path, args, configuration) {
          encryption = spawn(path, args, configuration);
          encryption.kill("SIGSTOP");
          encryption.once("close", () => {
            encryptionClosed = true;
          });
          notifyAgeStarted();
          return encryption;
        },
      });
    const result = captureStagingExport(
      { ...captureOptions(fixture), signal: controller.signal },
      h.dependencies,
    );
    result.catch(() => {});
    const timer = setTimeout(() => {
      forcedCleanup = true;
      encryption?.kill("SIGKILL");
    }, 1500);
    t.after(() => {
      clearTimeout(timer);
      encryption?.kill("SIGKILL");
    });
    await Promise.all([ageStarted, producerClosed]);
    if (boundary === "abort") controller.abort();
    else now += 895001;
    await assert.rejects(result, redacted);
    assert.equal(forcedCleanup, false);
    assert.equal(encryptionClosed, true);
    assert.equal(h.reaped.length, 3);
    assert.deepEqual(await readdir(fixture.workspace), ["identity.txt"]);
  });
}
