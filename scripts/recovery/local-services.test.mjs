import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalCredentials, serviceEnvironment } from "./local-services.mjs";
const target = { runId: "1234567890abcdef" };
test("closed settings and generated credentials", () => {
  const c = generateLocalCredentials(),
    e = serviceEnvironment(target.runId, c);
  assert.equal(e.rest.PGRST_DB_CONFIG, "false");
  assert.equal(e.auth.GOTRUE_DB_CLEANUP_ENABLED, "false");
  assert.notEqual(c.authPassword, c.restPassword);
  assert.match(e.rest.PGRST_DB_URI, /authenticator:/);
});
import { stopServices } from "./local-services.mjs";
test("stop failure on first peer still attempts second owned peer", async () => {
  const stopped = [];
  const execute = async (args) => {
    if (args[0] === "ps") return args.at(-1).includes("-auth") ? "a".repeat(64) : "b".repeat(64);
    if (args[0] === "container") {
      const kind = args.at(-1).startsWith("a") ? "auth" : "rest";
      return JSON.stringify([
        {
          Id: args.at(-1),
          Name: `/minted-staging-recovery-${target.runId}-${kind}`,
          Config: {
            Image: SERVICE_IMAGES[kind],
            Labels: {
              "com.minted.recovery.owner": "minted-staging-recovery",
              "com.minted.recovery.run-id": target.runId,
            },
          },
          State: { Running: !stopped.includes(args.at(-1)) },
        },
      ]);
    }
    if (args[0] === "stop") {
      stopped.push(args.at(-1));
      if (args.at(-1).startsWith("a")) throw Error("transport");
    }
  };
  await assert.rejects(stopServices(target, execute));
  assert.equal(stopped.length, 2);
});
import { SERVICE_IMAGES } from "./service-contract.mjs";

function topology() {
  const runId = "1234567890abcdef",
    name = `minted-staging-recovery-${runId}`,
    labels = {
      "com.minted.recovery.owner": "minted-staging-recovery",
      "com.minted.recovery.run-id": runId,
    };
  const containers = ["db", "auth", "rest"].map((kind, i) => ({
    Id: String(i + 1).repeat(64),
    Name: `/${name}${kind === "db" ? "" : `-${kind}`}`,
    Config: { Image: SERVICE_IMAGES[kind], Labels: labels },
    Image: `sha256:${String(i + 1).repeat(64)}`,
    State: { Running: true, Paused: false, Restarting: false, Dead: false },
    HostConfig: {
      NetworkMode: name,
      Privileged: false,
      PublishAllPorts: false,
      PidMode: "",
      IpcMode: "private",
      CgroupnsMode: "private",
      UTSMode: "",
      UsernsMode: "",
      ReadonlyRootfs: true,
      LogConfig: { Type: "none" },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
    },
    NetworkSettings: { Networks: { [name]: { NetworkID: "net" } } },
    Mounts: kind === "db" ? [{ Type: "volume", Name: name }] : [],
  }));
  return {
    runId,
    containers,
    images: Object.fromEntries(
      ["db", "auth", "rest"].map((k, i) => [
        k,
        {
          Id: containers[i].Image,
          Architecture: "arm64",
          Os: "linux",
          RepoDigests: [SERVICE_IMAGES[k]],
        },
      ]),
    ),
    network: {
      Name: name,
      Id: "net",
      Internal: true,
      Driver: "bridge",
      Labels: labels,
      Containers: Object.fromEntries(containers.map((c) => [c.Id, {}])),
    },
  };
}

import { inspectServices } from "./local-services.mjs";
function inspectionFixture() {
  const t = topology(),
    env = serviceEnvironment(t.runId, generateLocalCredentials());
  for (const kind of ["db", "auth", "rest"]) {
    t.images[kind].Config = { Env: ["PATH=/usr/bin"], Cmd: kind === "rest" ? ["postgrest"] : [] };
    const c = t.containers[["db", "auth", "rest"].indexOf(kind)];
    c.Config.Env = [
      "PATH=/usr/bin",
      ...Object.entries(env[kind] ?? {}).map(([k, v]) => `${k}=${v}`),
    ];
    c.Config.Cmd = kind === "auth" ? ["auth", "serve"] : t.images[kind].Config.Cmd;
  }
  const execute = async (args) => {
    if (args[0] === "network") return JSON.stringify([t.network]);
    if (args[0] === "image")
      return JSON.stringify([
        t.images[Object.keys(SERVICE_IMAGES).find((k) => SERVICE_IMAGES[k] === args[2])],
      ]);
    return JSON.stringify([t.containers.find((c) => c.Id === args[2] || c.Name === `/${args[2]}`)]);
  };
  return {
    t,
    env,
    execute,
    target: { runId: t.runId, containerId: t.containers[0].Id, networkId: t.network.Id },
  };
}
test("actual service inspection accepts exact closed environment", async () => {
  const f = inspectionFixture();
  await inspectServices(f.target, f.execute, f.env);
});
for (const [kind, key] of [
  ["auth", "GOTRUE_DB_CLEANUP_ENABLED"],
  ["rest", "PGRST_DB_CONFIG"],
])
  test(`actual service inspection rejects duplicate key replacing ${key}`, async () => {
    const f = inspectionFixture(),
      c = f.t.containers[kind === "auth" ? 1 : 2],
      i = c.Config.Env.findIndex((v) => v.startsWith(key + "="));
    assert.ok(i >= 0);
    c.Config.Env[i] = c.Config.Env[0];
    await assert.rejects(inspectServices(f.target, f.execute, f.env));
  });
