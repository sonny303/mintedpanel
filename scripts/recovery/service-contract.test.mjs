import test from "node:test";
import assert from "node:assert/strict";
import { ADDITIONS, verifyFixtureDelta } from "./service-contract.mjs";
function fixture() {
  const tables = Object.fromEntries(Object.keys(ADDITIONS).map((k) => [k, ["original"]]));
  const manifest = Object.fromEntries(
    Object.entries(ADDITIONS).map(([k, n]) => [
      k,
      Array.from({ length: n }, (_, i) => `${k}-${i}`),
    ]),
  );
  return {
    before: { schema: { a: 1 }, ledger: [], tables },
    after: {
      schema: { a: 1 },
      ledger: [],
      tables: Object.fromEntries(
        Object.entries(tables).map(([k, v]) => [k, [...v, ...manifest[k]]]),
      ),
    },
    manifest,
  };
}
test("exact added-row multiset and originals pass", () => {
  const f = fixture();
  assert.equal(verifyFixtureDelta(f.before, f.after, f.manifest), true);
});
for (const [name, change] of Object.entries({
  original: (f) => (f.after.tables["auth.users"][0] = "changed"),
  extra: (f) => f.after.tables["public.notes"].push("extra"),
  schema: (f) => (f.after.schema.a = 2),
  ledger: (f) => f.after.ledger.push("new"),
  missingTable: (f) => delete f.after.tables["public.notes"],
  wrongManifest: (f) => (f.manifest["public.notes"] = ["wrong"]),
}))
  test(`reject ${name}`, () => {
    const f = fixture();
    change(f);
    assert.throws(() => verifyFixtureDelta(f.before, f.after, f.manifest));
  });
import { validateServiceTopology, SERVICE_IMAGES } from "./service-contract.mjs";
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
test("exact owned three-peer topology passes", () => {
  const t = topology();
  assert.equal(validateServiceTopology(t, t.containers[0].Id).runId, t.runId);
});
for (const [name, change] of Object.entries({
  image: (t) => (t.containers[1].Config.Image = "unreviewed"),
  port: (t) => (t.containers[1].HostConfig.PortBindings = { x: [{ HostPort: "9999" }] }),
  peer: (t) => (t.network.Containers.foreign = {}),
  network: (t) => (t.network.Internal = false),
  mount: (t) => t.containers[1].Mounts.push({ Type: "bind" }),
  foreign: (t) => (t.containers[1].Config.Labels = { "com.minted.recovery.run-id": "other" }),
}))
  test(`topology rejects ${name}`, () => {
    const t = topology();
    change(t);
    assert.throws(() => validateServiceTopology(t, t.containers[0].Id));
  });
