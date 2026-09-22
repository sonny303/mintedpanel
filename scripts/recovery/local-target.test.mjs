import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { collectLocalTarget, LOCAL_SOCKET } from "./local-target.mjs";
import { PROFILE, POSTGRES_IMAGE, validateLocalTarget } from "./contract.mjs";

const runId = "0123456789abcdef";
const name = `${PROFILE}-${runId}`;
const containerId = "a".repeat(64);
const imageId = `sha256:${"b".repeat(64)}`;
const networkId = "c".repeat(64);
const now = "2026-09-08T20:00:00.000Z";
const ownership = {
  "com.minted.recovery.owner": PROFILE,
  "com.minted.recovery.run-id": runId,
};
function fixture() {
  return {
    context: {
      Name: `colima-${PROFILE}`,
      Endpoints: { docker: { Host: LOCAL_SOCKET, SkipTLSVerify: false } },
    },
    container: {
      Id: containerId,
      Name: `/${name}`,
      Image: imageId,
      Config: {
        Image: POSTGRES_IMAGE,
        User: "",
        Labels: { ...ownership },
        Env: ["POSTGRES_PASSWORD=private-canary"],
      },
      State: { Running: true, Paused: false, Restarting: false, Dead: false },
      HostConfig: {
        NetworkMode: name,
        PidMode: "",
        IpcMode: "private",
        UTSMode: "",
        UsernsMode: "",
        CgroupnsMode: "private",
        Privileged: false,
        PublishAllPorts: false,
        CapAdd: null,
        Devices: [],
        DeviceRequests: null,
        DeviceCgroupRules: null,
        VolumesFrom: null,
        SecurityOpt: null,
        PortBindings: {},
        Binds: null,
      },
      NetworkSettings: {
        Ports: { "5432/tcp": null },
        Networks: { [name]: { NetworkID: networkId } },
      },
      Mounts: [
        {
          Type: "volume",
          Name: name,
          Driver: "local",
          RW: true,
          Destination: "/var/lib/postgresql/data",
          Source: `/var/lib/docker/volumes/${name}/_data`,
        },
      ],
    },
    image: {
      Id: imageId,
      RepoDigests: [POSTGRES_IMAGE],
      Architecture: "arm64",
      Os: "linux",
      Config: { Env: ["PRIVATE_IMAGE_VALUE=private-canary"] },
    },
    network: {
      Id: networkId,
      Name: name,
      Driver: "bridge",
      Scope: "local",
      Internal: true,
      Labels: { ...ownership },
      Containers: { [containerId]: { Name: name } },
    },
    volume: {
      Name: name,
      Driver: "local",
      Scope: "local",
      Options: null,
      Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
      Labels: { ...ownership },
    },
    sql: { database: "postgres", role: "supabase_admin", serverVersion: "17.6", cronJobs: "off" },
  };
}

function transport(value, afterQuery) {
  const calls = [];
  let queried = false;
  return {
    calls,
    clock: () => now,
    execute: async (args, input) => {
      calls.push({ args, input });
      if (args[0] === "context") {
        assert.deepEqual(args, ["context", "inspect", `colima-${PROFILE}`]);
        assert.equal(input, undefined);
        return JSON.stringify([value.context]);
      }
      assert.deepEqual(args.slice(0, 2), ["--host", LOCAL_SOCKET]);
      const kind = args[2];
      if (kind === "exec") {
        assert.equal(queried, false);
        assert.equal(args[3], "--interactive");
        assert.equal(args[4], containerId);
        assert.deepEqual(args.slice(5, 7), ["/usr/bin/env", "-i"]);
        assert.ok(args.includes("/nix/var/nix/profiles/default/bin/psql"));
        assert.ok(
          args.includes(
            "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
          ),
        );
        assert.deepEqual(args.slice(-14), [
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
        ]);
        assert.match(input, /^SELECT pg_catalog\.json_build_object\(/);
        assert.ok(input.includes("'cron.launch_active_jobs'"));
        assert.ok(!/\b(?:INSERT|UPDATE|DELETE|COPY|CREATE|DROP|ALTER)\b/.test(input));
        queried = true;
        afterQuery?.(value);
        return JSON.stringify(value.sql);
      }
      assert.equal(input, undefined);
      const expectedRef =
        kind === "image" ? POSTGRES_IMAGE : kind === "container" && queried ? containerId : name;
      assert.deepEqual(args.slice(2), [kind, "inspect", expectedRef]);
      assert.ok(["container", "image", "network", "volume"].includes(kind));
      return JSON.stringify([value[kind]]);
    },
  };
}

test("actual-shaped Docker inspection produces only normalized local target fields", async () => {
  const io = transport(fixture());
  const result = await collectLocalTarget(runId, io);
  assert.equal(result.containerId, containerId);
  assert.equal(result.image, POSTGRES_IMAGE);
  assert.equal(result.serverVersion, "17.6");
  assert.equal(result.transport, "docker-exec-stdin");
  assert.equal(result.configuredPortBindingCount, 0);
  assert.equal(result.publishedPortCount, 0);
  assert.equal(result.observedAt, now);
  assert.match(
    validateLocalTarget({
      target: result,
      expectedRunId: runId,
      expectedSocket: LOCAL_SOCKET,
      now,
    }),
    /^[a-f0-9]{64}$/,
  );
  assert.ok(!JSON.stringify(result).includes("private-canary"));
  assert.equal(io.calls.length, 11);
  assert.equal(io.calls.filter(({ args }) => args[2] === "exec").length, 1);
});

test("named-volume shorthand remains a volume, while an explicit mount has the same identity", async () => {
  const value = fixture();
  value.container.HostConfig.Binds = [`${name}:/var/lib/postgresql/data:rw`];
  const shorthand = await collectLocalTarget(runId, transport(value));
  value.container.HostConfig.Binds = null;
  value.container.HostConfig.Mounts = [
    { Type: "volume", Source: name, Target: "/var/lib/postgresql/data", ReadOnly: false },
  ];
  assert.deepEqual(await collectLocalTarget(runId, transport(value)), shorthand);
  value.container.HostConfig.PortBindings = null;
  value.container.NetworkSettings.Ports = null;
  assert.deepEqual(await collectLocalTarget(runId, transport(value)), shorthand);
});

for (const [label, mutate] of [
  [
    "remote context",
    (v) => {
      v.context.Endpoints.docker.Host = "tcp://private-canary:2375";
    },
  ],
  [
    "foreign container name",
    (v) => {
      v.container.Name = "/other-task";
    },
  ],
  [
    "foreign ownership",
    (v) => {
      v.container.Config.Labels["com.minted.recovery.run-id"] = "fedcba9876543210";
    },
  ],
  [
    "mutable image tag",
    (v) => {
      v.container.Config.Image = "supabase/postgres:17.6.1.147";
    },
  ],
  [
    "image identity mismatch",
    (v) => {
      v.container.Image = `sha256:${"d".repeat(64)}`;
    },
  ],
  [
    "wrong platform",
    (v) => {
      v.image.Architecture = "amd64";
    },
  ],
  [
    "unverified image digest",
    (v) => {
      v.image.RepoDigests = [];
    },
  ],
  [
    "unreviewed OS user",
    (v) => {
      v.container.Config.User = "other";
    },
  ],
  [
    "paused container",
    (v) => {
      v.container.State.Paused = true;
    },
  ],
  [
    "host PID namespace",
    (v) => {
      v.container.HostConfig.PidMode = "host";
    },
  ],
  [
    "shared container PID namespace",
    (v) => {
      v.container.HostConfig.PidMode = `container:${containerId}`;
    },
  ],
  [
    "host IPC namespace",
    (v) => {
      v.container.HostConfig.IpcMode = "host";
    },
  ],
  [
    "host UTS namespace",
    (v) => {
      v.container.HostConfig.UTSMode = "host";
    },
  ],
  [
    "host network",
    (v) => {
      v.container.HostConfig.NetworkMode = "host";
    },
  ],
  [
    "host user namespace",
    (v) => {
      v.container.HostConfig.UsernsMode = "host";
    },
  ],
  [
    "host cgroup namespace",
    (v) => {
      v.container.HostConfig.CgroupnsMode = "host";
    },
  ],
  [
    "privileged mode",
    (v) => {
      v.container.HostConfig.Privileged = true;
    },
  ],
  [
    "added capability",
    (v) => {
      v.container.HostConfig.CapAdd = ["NET_ADMIN"];
    },
  ],
  [
    "device",
    (v) => {
      v.container.HostConfig.Devices = [{ PathOnHost: "/dev/private-canary" }];
    },
  ],
  [
    "device request",
    (v) => {
      v.container.HostConfig.DeviceRequests = [{ Count: -1 }];
    },
  ],
  [
    "device rule",
    (v) => {
      v.container.HostConfig.DeviceCgroupRules = ["a *:* rwm"];
    },
  ],
  [
    "unconfined security option",
    (v) => {
      v.container.HostConfig.SecurityOpt = ["seccomp=unconfined"];
    },
  ],
  [
    "configured published port",
    (v) => {
      v.container.HostConfig.PortBindings = {
        "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }],
      };
    },
  ],
  [
    "effective published port",
    (v) => {
      v.container.NetworkSettings.Ports = {
        "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55432" }],
      };
    },
  ],
  [
    "automatic published ports",
    (v) => {
      v.container.HostConfig.PublishAllPorts = true;
    },
  ],
  [
    "missing port observations",
    (v) => {
      delete v.container.HostConfig.PortBindings;
    },
  ],
  [
    "host bind",
    (v) => {
      v.container.Mounts[0].Type = "bind";
    },
  ],
  [
    "configured host bind",
    (v) => {
      v.container.HostConfig.Binds = ["/private-canary:/var/lib/postgresql/data"];
    },
  ],
  [
    "mount over fixed executable",
    (v) => {
      v.container.Mounts[0].Destination = "/nix";
    },
  ],
  [
    "extra mount",
    (v) => {
      v.container.Mounts.push({ ...v.container.Mounts[0] });
    },
  ],
  [
    "unowned volume",
    (v) => {
      v.volume.Labels["com.minted.recovery.owner"] = "other";
    },
  ],
  [
    "hidden volume bind",
    (v) => {
      v.volume.Options = { type: "none", o: "bind", device: "/private-canary" };
    },
  ],
  [
    "remote volume driver",
    (v) => {
      v.volume.Driver = "remote";
    },
  ],
  [
    "volume source mismatch",
    (v) => {
      v.volume.Mountpoint = "/private-canary";
    },
  ],
  [
    "extra network",
    (v) => {
      v.container.NetworkSettings.Networks.other = { NetworkID: "d".repeat(64) };
    },
  ],
  [
    "wrong network identity",
    (v) => {
      v.network.Id = "d".repeat(64);
    },
  ],
  [
    "outbound network",
    (v) => {
      v.network.Internal = false;
    },
  ],
  [
    "unowned network",
    (v) => {
      v.network.Labels["com.minted.recovery.run-id"] = "fedcba9876543210";
    },
  ],
  [
    "another network member",
    (v) => {
      v.network.Containers["d".repeat(64)] = { Name: "other" };
    },
  ],
  [
    "wrong SQL database",
    (v) => {
      v.sql.database = "other";
    },
  ],
  [
    "wrong SQL role",
    (v) => {
      v.sql.role = "postgres";
    },
  ],
  [
    "wrong SQL version",
    (v) => {
      v.sql.serverVersion = "18.4";
    },
  ],
  [
    "enabled cron jobs",
    (v) => {
      v.sql.cronJobs = "on";
    },
  ],
  [
    "missing cron observation",
    (v) => {
      delete v.sql.cronJobs;
    },
  ],
])
  test(`rejects ${label} with a static error`, async () => {
    const value = fixture();
    mutate(value);
    const io = transport(value);
    await assert.rejects(collectLocalTarget(runId, io), {
      message: "LOCAL_TARGET_REJECTED",
    });
    if (!label.includes("SQL") && !label.includes("cron"))
      assert.equal(
        io.calls.some(({ args }) => args[2] === "exec"),
        false,
      );
  });

test("rejects target drift during the fixed identity query", async () => {
  const io = transport(fixture(), (value) => {
    value.container.Id = "d".repeat(64);
  });
  await assert.rejects(collectLocalTarget(runId, io), { message: "LOCAL_TARGET_REJECTED" });
});
test("malformed JSON and command failures do not echo Docker environments or stderr", async () => {
  for (const execute of [
    async () => "private-canary",
    async () => {
      throw new Error("private-canary");
    },
  ])
    await assert.rejects(collectLocalTarget(runId, { execute }), {
      message: "LOCAL_TARGET_REJECTED",
    });
});
test("invalid run IDs fail before any command; remote context fails before daemon access", async () => {
  const io = transport(fixture());
  await assert.rejects(collectLocalTarget("--private-canary", io));
  assert.equal(io.calls.length, 0);
  const value = fixture();
  value.context.Endpoints.docker.Host = "ssh://private-canary";
  const remote = transport(value);
  await assert.rejects(collectLocalTarget(runId, remote));
  assert.equal(remote.calls.length, 1);
});
test("an inspection older than five minutes is rejected", async () => {
  const io = transport(fixture());
  let tick = 0;
  io.clock = () => (tick++ ? "2026-09-08T20:05:00.001Z" : now);
  await assert.rejects(collectLocalTarget(runId, io), { message: "LOCAL_TARGET_REJECTED" });
});
test("CLI exposes no arbitrary endpoint, SQL, executable or restore operation", () => {
  for (const args of [
    [],
    ["restore", "--run-id", runId],
    ["inspect", "--run-id", runId, "--host", "private-canary"],
    ["inspect", "--sql", "private-canary"],
  ]) {
    const result = spawnSync(process.execPath, ["scripts/recovery/local-target.mjs", ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, '{"ok":false,"code":"LOCAL_TARGET_REJECTED"}\n');
  }
});
