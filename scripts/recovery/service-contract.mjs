import { canonicalDigest } from "../release/contract.mjs";
import { PROFILE, POSTGRES_IMAGE, RecoveryError } from "./contract.mjs";
export const SERVICE_IMAGES = Object.freeze({
  db: POSTGRES_IMAGE,
  auth: "supabase/gotrue@sha256:3439d5affb9e96395d1348521f4c675eea7096d8d76d18d4e31fcc08df802116",
  rest: "postgrest/postgrest@sha256:ba586907588f4c03fc1d7e5c57732cec80c396a164199ceeddfc8a89b24412f0",
});
export const AUTH_SETTINGS = Object.freeze({
  GOTRUE_INDEX_WORKER_ENSURE_USER_SEARCH_INDEXES_EXIST: "false",
  GOTRUE_INDEX_WORKER_MAX_USERS_THRESHOLD: "0",
  GOTRUE_DB_CLEANUP_ENABLED: "false",
  GOTRUE_MAILER_TEMPLATE_RELOADING_ENABLED: "false",
  GOTRUE_DB_ADVISOR_ENABLED: "false",
  GOTRUE_SECURITY_REFRESH_TOKEN_ALGORITHM_VERSION: "1",
  GOTRUE_SECURITY_REFRESH_TOKEN_UPGRADE_PERCENTAGE: "0",
  GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true",
  GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
  GOTRUE_JWT_AUD: "authenticated",
  GOTRUE_DISABLE_SIGNUP: "true",
});
export const REST_SETTINGS = Object.freeze({
  PGRST_DB_CONFIG: "false",
  PGRST_DB_PRE_CONFIG: "",
  PGRST_DB_PRE_REQUEST: "",
  PGRST_DB_CHANNEL_ENABLED: "false",
  PGRST_DB_SCHEMAS: "public",
  PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions",
  PGRST_DB_ANON_ROLE: "anon",
});
export const ADDITIONS = Object.freeze({
  "auth.users": 2,
  "auth.identities": 2,
  "auth.sessions": 2,
  "auth.refresh_tokens": 3,
  "auth.mfa_amr_claims": 2,
  "auth.audit_log_entries": 6,
  "public.profiles": 2,
  "public.organizations": 2,
  "public.memberships": 2,
  "public.notes": 1,
});
export function requireService(value) {
  if (!value) throw new RecoveryError("LOCAL_SERVICE_REJECTED");
}
const empty = (x) => x == null || Object.keys(x).length === 0;
const labels = (x, id) =>
  x?.["com.minted.recovery.owner"] === PROFILE && x?.["com.minted.recovery.run-id"] === id;
export function validateServiceTopology({ runId, network, containers, images }, expectedDbId) {
  requireService(/^[a-f0-9]{16}$/.test(runId) && /^[a-f0-9]{64}$/.test(expectedDbId));
  const name = `${PROFILE}-${runId}`;
  requireService(
    network?.Name === name &&
      network.Internal === true &&
      network.Driver === "bridge" &&
      labels(network.Labels, runId),
  );
  requireService(
    Array.isArray(containers) &&
      containers.length === 3 &&
      new Set(containers.map((c) => c.Id)).size === 3,
  );
  for (const kind of ["db", "auth", "rest"]) {
    const c = containers.find((c) => c.Name === `/${name}${kind === "db" ? "" : `-${kind}`}`),
      im = images?.[kind];
    requireService(
      c &&
        /^[a-f0-9]{64}$/.test(c.Id) &&
        c.State?.Running === true &&
        !c.State.Paused &&
        !c.State.Restarting &&
        !c.State.Dead,
    );
    requireService(
      c.Config?.Image === SERVICE_IMAGES[kind] &&
        labels(c.Config.Labels, runId) &&
        im?.Architecture === "arm64" &&
        im.Os === "linux" &&
        im.Id === c.Image &&
        im.RepoDigests?.includes(SERVICE_IMAGES[kind]),
    );
    const h = c.HostConfig,
      n = c.NetworkSettings;
    requireService(
      h &&
        n &&
        h.NetworkMode === name &&
        h.Privileged === false &&
        h.PublishAllPorts === false &&
        empty(h.PortBindings) &&
        Object.values(n.Ports ?? {}).every(
          (v) => v === null || (Array.isArray(v) && v.length === 0),
        ),
    );
    requireService(
      [
        "CapAdd",
        "Devices",
        "DeviceRequests",
        "DeviceCgroupRules",
        "VolumesFrom",
        "Binds",
        "Tmpfs",
      ].every((k) => empty(h[k])),
    );
    requireService(
      ["PidMode", "IpcMode", "CgroupnsMode"].every((k) => ["", "private"].includes(h[k])) &&
        h.UTSMode === "" &&
        h.UsernsMode === "",
    );
    requireService(
      Object.keys(n.Networks ?? {}).length === 1 && n.Networks[name]?.NetworkID === network.Id,
    );
    if (kind === "db")
      requireService(
        c.Id === expectedDbId &&
          c.Mounts?.length === 1 &&
          c.Mounts[0].Type === "volume" &&
          c.Mounts[0].Name === name,
      );
    else
      requireService(
        c.Mounts?.length === 0 &&
          h.ReadonlyRootfs === true &&
          h.LogConfig?.Type === "none" &&
          h.CapDrop?.includes("ALL") &&
          h.SecurityOpt?.some((s) => s === "no-new-privileges" || s === "no-new-privileges:true"),
      );
  }
  requireService(
    Object.keys(network.Containers ?? {})
      .sort()
      .join() ===
      containers
        .map((c) => c.Id)
        .sort()
        .join(),
  );
  return Object.freeze({
    runId,
    dbId: expectedDbId,
    networkId: network.Id,
    imageDigest: canonicalDigest(SERVICE_IMAGES),
    topologyDigest: canonicalDigest(
      containers
        .map((c) => ({ id: c.Id, image: c.Image }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  });
}
// Equality on multisets preserves duplicate rows. No table is exempt from original-row checks.
export function verifyFixtureDelta(before, after, manifest) {
  requireService(
    canonicalDigest(before.schema) === canonicalDigest(after.schema) &&
      canonicalDigest(before.ledger) === canonicalDigest(after.ledger),
  );
  requireService(
    Object.keys(before.tables).sort().join() === Object.keys(after.tables).sort().join(),
  );
  for (const [table, original] of Object.entries(before.tables)) {
    const remaining = [...after.tables[table]];
    for (const hash of original) {
      const i = remaining.indexOf(hash);
      requireService(i >= 0);
      remaining.splice(i, 1);
    }
    const expected = manifest[table] ?? [];
    requireService(
      expected.length === (ADDITIONS[table] ?? 0) &&
        canonicalDigest(remaining.sort()) === canonicalDigest([...expected].sort()),
    );
  }
  requireService(
    Object.keys(ADDITIONS).every(
      (t) => Object.hasOwn(before.tables, t) && Object.hasOwn(manifest, t),
    ),
  );
  requireService(Object.keys(manifest).every((t) => Object.hasOwn(ADDITIONS, t)));
  return true;
}
