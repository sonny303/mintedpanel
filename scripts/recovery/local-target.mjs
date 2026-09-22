import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { canonicalDigest } from "../release/contract.mjs";
import {
  PROFILE,
  POSTGRES_IMAGE,
  STAGING,
  RecoveryError,
  validateLocalTarget,
} from "./contract.mjs";

export const LOCAL_SOCKET = "unix:///Users/ar/.colima/minted-staging-recovery/docker.sock";
const CONTEXT = `colima-${PROFILE}`;
const DOCKER = "/opt/homebrew/bin/docker";
const OWNER = "com.minted.recovery.owner";
const RUN = "com.minted.recovery.run-id";
const HASH = /^[a-f0-9]{64}$/;
const SQL =
  "SELECT pg_catalog.json_build_object('database', pg_catalog.current_database(), 'role', current_user, 'serverVersion', pg_catalog.current_setting('server_version'), 'cronJobs', pg_catalog.current_setting('cron.launch_active_jobs', true));\n";
const check = (value) => {
  if (!value) throw new RecoveryError("LOCAL_TARGET_REJECTED");
};
const object = (value) => {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return value;
};
const nullableList = (value) => {
  check(value === null || Array.isArray(value));
  return value ?? [];
};
const nullableMap = (value) => (value === null ? {} : object(value));
// Docker omits these optional empty structures from inspect JSON.
const optionalList = (value) => (value === undefined ? [] : nullableList(value));
const optionalMap = (value) => (value === undefined ? {} : nullableMap(value));
const emptyList = (value) => check(nullableList(value).length === 0);
const emptyMap = (value) => check(Object.keys(nullableMap(value)).length === 0);
function one(text) {
  const values = JSON.parse(text);
  check(Array.isArray(values) && values.length === 1);
  return object(values[0]);
}
function labels(value, runId) {
  check(object(value)[OWNER] === PROFILE && value[RUN] === runId);
}
function portCount(value) {
  return Object.values(nullableMap(value)).reduce(
    (count, bindings) => count + nullableList(bindings).length,
    0,
  );
}

// Fixed executable, endpoint and minimal environment. No shell or inherited Docker/PG overrides.
// Docker JSON/stderr may contain secrets; only the sanitizer's closed output may be emitted.
function docker(args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      DOCKER,
      args,
      {
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: "/Users/ar",
          DOCKER_CONFIG: "/Users/ar/.docker",
          LANG: "C",
        },
      },
      (error, stdout) => {
        if (error) reject(new RecoveryError("LOCAL_TARGET_REJECTED"));
        else resolvePromise(stdout);
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function contextIdentity(context) {
  check(context.Name === CONTEXT);
  check(object(object(context.Endpoints).docker).Host === LOCAL_SOCKET);
  return { context: context.Name, engineEndpoint: context.Endpoints.docker.Host };
}

function normalizeInspection({ context, container, image, network, volume }, runId) {
  const name = `${PROFILE}-${runId}`;
  const identity = contextIdentity(context);
  const config = object(container.Config);
  const host = object(container.HostConfig);
  const state = object(container.State);
  const networkSettings = object(container.NetworkSettings);
  check(HASH.test(container.Id) && container.Name === `/${name}`);
  check(
    state.Running === true &&
      state.Paused === false &&
      state.Restarting === false &&
      state.Dead === false,
  );
  check(config.Image === POSTGRES_IMAGE && image.Os === "linux" && image.Architecture === "arm64");
  check(config.User === "" && [undefined, ""].includes(object(image.Config).User));
  check(/^sha256:[a-f0-9]{64}$/.test(image.Id) && container.Image === image.Id);
  check(Array.isArray(image.RepoDigests) && image.RepoDigests.includes(POSTGRES_IMAGE));
  labels(config.Labels, runId);
  labels(network.Labels, runId);
  labels(volume.Labels, runId);

  const namespaceModes = [
    host.PidMode,
    host.IpcMode,
    host.UTSMode,
    host.UsernsMode,
    host.CgroupnsMode,
  ];
  check(namespaceModes.every((value) => typeof value === "string"));
  check(["", "private"].includes(host.PidMode) && ["", "private"].includes(host.IpcMode));
  check(
    host.UTSMode === "" && host.UsernsMode === "" && ["", "private"].includes(host.CgroupnsMode),
  );
  check(host.NetworkMode === name && host.Privileged === false && host.PublishAllPorts === false);
  emptyList(host.CapAdd);
  emptyList(host.Devices);
  emptyList(host.DeviceRequests);
  emptyList(host.DeviceCgroupRules);
  emptyList(host.VolumesFrom);
  check(Object.keys(optionalMap(host.Tmpfs)).length === 0);
  check(
    nullableList(host.SecurityOpt).every(
      (value) => value === "no-new-privileges" || value === "no-new-privileges:true",
    ),
  );
  const configuredPortBindingCount = portCount(host.PortBindings);
  const publishedPortCount = portCount(networkSettings.Ports);
  check(configuredPortBindingCount === 0 && publishedPortCount === 0);

  check(Array.isArray(container.Mounts) && container.Mounts.length === 1);
  const mount = object(container.Mounts[0]);
  check(
    mount.Type === "volume" && mount.Name === name && mount.Driver === "local" && mount.RW === true,
  );
  check(mount.Destination === "/var/lib/postgresql/data");
  check(volume.Name === name && volume.Driver === "local" && volume.Scope === "local");
  emptyMap(volume.Options); // Named volumes can otherwise conceal host binds or remote mounts.
  check(typeof volume.Mountpoint === "string" && volume.Mountpoint === mount.Source);
  check(
    nullableList(host.Binds).every((value) =>
      [`${name}:${mount.Destination}`, `${name}:${mount.Destination}:rw`].includes(value),
    ),
  );
  check(
    optionalList(host.Mounts).every((value) => {
      object(value);
      return (
        value.Type === "volume" &&
        value.Source === name &&
        value.Target === mount.Destination &&
        value.ReadOnly !== true
      );
    }),
  );

  const attached = object(networkSettings.Networks);
  check(Object.keys(attached).length === 1 && Object.hasOwn(attached, name));
  check(HASH.test(network.Id) && attached[name].NetworkID === network.Id && network.Name === name);
  check(network.Driver === "bridge" && network.Scope === "local" && network.Internal === true);
  const members = Object.keys(object(network.Containers));
  check(members.length === 1 && members[0] === container.Id);

  return {
    ...identity,
    runId,
    name: container.Name.slice(1),
    ownerLabel: config.Labels[OWNER],
    runLabel: config.Labels[RUN],
    containerId: container.Id,
    image: config.Image,
    imageArchitecture: image.Architecture,
    transport: "docker-exec-stdin",
    publishedPortCount,
    configuredPortBindingCount,
    networkName: network.Name,
    networkId: network.Id,
    networkInternal: network.Internal,
    networkOwnerLabel: network.Labels[OWNER],
    networkRunLabel: network.Labels[RUN],
    networkContainerIds: members,
    networkCount: Object.keys(attached).length,
    hostBindCount: container.Mounts.filter((value) => value.Type === "bind").length,
    volumeCount: container.Mounts.filter((value) => value.Type === "volume").length,
    addedCapabilityCount: nullableList(host.CapAdd).length,
    deviceCount: nullableList(host.Devices).length + nullableList(host.DeviceRequests).length,
    privileged: host.Privileged,
    hostNamespaces: namespaceModes.includes("host") || host.NetworkMode === "host",
    volumeName: volume.Name,
    volumeOwnerLabel: volume.Labels[OWNER],
    volumeRunLabel: volume.Labels[RUN],
  };
}

// execute/clock are test seams; the CLI exposes neither. Reads only this Mac's fixed local engine.
export async function collectLocalTarget(
  runId,
  { execute = docker, clock = () => new Date().toISOString() } = {},
) {
  try {
    check(typeof runId === "string" && /^[a-f0-9]{16}$/.test(runId));
    const observedAt = clock();
    const context = one(await execute(["context", "inspect", CONTEXT]));
    contextIdentity(context); // Reject a foreign context before making any daemon call.
    const name = `${PROFILE}-${runId}`;
    const pinned = ["--host", LOCAL_SOCKET];
    async function snapshot(containerRef) {
      const container = one(await execute([...pinned, "container", "inspect", containerRef]));
      check(HASH.test(container.Id) && container.Name === `/${name}`);
      // Inspect the immutable expected image; never pass an untrusted image/network/volume name.
      const image = one(await execute([...pinned, "image", "inspect", POSTGRES_IMAGE]));
      const network = one(await execute([...pinned, "network", "inspect", name]));
      const volume = one(await execute([...pinned, "volume", "inspect", name]));
      return normalizeInspection({ context, container, image, network, volume }, runId);
    }
    const before = await snapshot(name);
    const sql = JSON.parse(
      await execute(
        [
          ...pinned,
          "exec",
          "--interactive",
          before.containerId,
          "/usr/bin/env",
          "-i",
          "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
          "/nix/var/nix/profiles/default/bin/psql",
          "-X",
          "-w",
          "-A",
          "-t",
          "-h",
          "/var/run/postgresql",
          "-p",
          "5432",
          "-U",
          "supabase_admin",
          "-d",
          "postgres",
          "--set",
          "ON_ERROR_STOP=1",
        ],
        SQL,
      ),
    );
    check(
      object(sql).database === "postgres" &&
        sql.role === "supabase_admin" &&
        sql.serverVersion === STAGING.serverVersion &&
        sql.cronJobs === "off",
    );
    const after = await snapshot(before.containerId);
    check(canonicalDigest(before) === canonicalDigest(after));
    contextIdentity(one(await execute(["context", "inspect", CONTEXT])));
    const target = {
      observedAt,
      ...after,
      serverVersion: sql.serverVersion,
      database: sql.database,
    };
    validateLocalTarget({
      target,
      expectedRunId: runId,
      expectedSocket: LOCAL_SOCKET,
      now: clock(),
    });
    return target;
  } catch {
    throw new RecoveryError("LOCAL_TARGET_REJECTED");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [operation, flag, runId, ...extra] = process.argv.slice(2);
    check(operation === "inspect" && flag === "--run-id" && extra.length === 0);
    process.stdout.write(`${JSON.stringify(await collectLocalTarget(runId))}\n`);
  } catch {
    process.stderr.write('{"ok":false,"code":"LOCAL_TARGET_REJECTED"}\n');
    process.exitCode = 2;
  }
}
