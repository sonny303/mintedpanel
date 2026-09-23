import { randomBytes, createHmac } from "node:crypto";
import { AUTH_SETTINGS, REST_SETTINGS, requireService } from "./service-contract.mjs";
import { PROFILE } from "./contract.mjs";
export function generateLocalCredentials() {
  return {
    jwt: randomBytes(48).toString("base64url"),
    authPassword: randomBytes(32).toString("base64url"),
    restPassword: randomBytes(32).toString("base64url"),
    fixturePasswords: [
      randomBytes(32).toString("base64url"),
      randomBytes(32).toString("base64url"),
    ],
  };
}
export function localAdminToken(secret, now) {
  requireService(typeof secret === "string" && secret.length >= 48 && Number.isSafeInteger(now));
  const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "service_role", aud: "authenticated", iss: "minted-local-recovery", iat: now, exp: now + 600 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function serviceEnvironment(runId, credentials) {
  requireService(/^[a-f0-9]{16}$/.test(runId));
  for (const key of ["jwt", "authPassword", "restPassword"])
    requireService(
      typeof credentials[key] === "string" && /^[A-Za-z0-9_-]{40,}$/.test(credentials[key]),
    );
  const db = `${PROFILE}-${runId}`;
  return {
    auth: {
      ...AUTH_SETTINGS,
      GOTRUE_DB_DRIVER: "postgres",
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${credentials.authPassword}@${db}:5432/minted_recovery`,
      GOTRUE_API_HOST: "0.0.0.0",
      GOTRUE_API_PORT: "9999",
      API_EXTERNAL_URL: "http://auth:9999",
      GOTRUE_SITE_URL: "http://fixture.invalid",
      GOTRUE_JWT_SECRET: credentials.jwt,
      GOTRUE_JWT_ADMIN_ROLES: "service_role",
      GOTRUE_JWT_EXP: "600",
    },
    rest: {
      ...REST_SETTINGS,
      PGRST_DB_URI: `postgres://authenticator:${credentials.restPassword}@${db}:5432/minted_recovery`,
      PGRST_JWT_SECRET: credentials.jwt,
      PGRST_SERVER_PORT: "3000",
    },
  };
}
import { execFile } from "node:child_process";
import { LOCAL_SOCKET, collectLocalTarget } from "./local-target.mjs";
import { SERVICE_IMAGES, validateServiceTopology } from "./service-contract.mjs";
export function fixedDocker(args, input, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/opt/homebrew/bin/docker",
      ["--host", LOCAL_SOCKET, ...args],
      {
        encoding: "utf8",
        timeout,
        maxBuffer: 256 * 1024 * 1024,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: "/Users/ar",
          DOCKER_CONFIG: "/Users/ar/.docker",
          LANG: "C",
        },
      },
      (e, out) =>
        e
          ? reject(
              Object.assign(new Error("LOCAL_SERVICE_REJECTED"), {
                code: "LOCAL_SERVICE_REJECTED",
              }),
            )
          : resolve(out),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
const one = (text) => {
  const a = JSON.parse(text);
  requireService(Array.isArray(a) && a.length === 1);
  return a[0];
};
function owned(c, target, kind) {
  requireService(
    c.Name === `/${PROFILE}-${target.runId}-${kind}` &&
      c.Config?.Labels?.["com.minted.recovery.owner"] === PROFILE &&
      c.Config.Labels["com.minted.recovery.run-id"] === target.runId &&
      c.Config.Image === SERVICE_IMAGES[kind],
  );
}
export async function inspectServices(target, execute = fixedDocker, expectedEnvironment) {
  const name = `${PROFILE}-${target.runId}`;
  const containers = [];
  const images = {};
  for (const kind of ["db", "auth", "rest"]) {
    containers.push(
      one(
        await execute([
          "container",
          "inspect",
          kind === "db" ? target.containerId : `${name}-${kind}`,
        ]),
      ),
    );
    images[kind] = one(await execute(["image", "inspect", SERVICE_IMAGES[kind]]));
  }
  for (const kind of ["auth", "rest"]) {
    const c = containers.find((c) => c.Name === `/${name}-${kind}`),
      im = images[kind];
    requireService(expectedEnvironment?.[kind]);
    const expected = new Map(
      (im.Config?.Env ?? []).map((v) => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]),
    );
    for (const [k, v] of Object.entries(expectedEnvironment[kind])) expected.set(k, v);
    const actual = c.Config.Env ?? [];
    requireService(
      actual.every((v) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) &&
        new Set(actual.map((v) => v.slice(0, v.indexOf("=")))).size === actual.length,
    );
    requireService(
      actual.length === expected.size &&
        actual.every(
          (v) => expected.get(v.slice(0, v.indexOf("="))) === v.slice(v.indexOf("=") + 1),
        ),
    );
    requireService(
      JSON.stringify(c.Config.Entrypoint ?? null) === JSON.stringify(im.Config?.Entrypoint ?? null),
    );
    requireService(
      JSON.stringify(c.Config.Cmd) ===
        JSON.stringify(kind === "auth" ? ["auth", "serve"] : im.Config?.Cmd),
    );
  }
  const network = one(await execute(["network", "inspect", target.networkId]));
  return validateServiceTopology(
    { runId: target.runId, network, containers, images },
    target.containerId,
  );
}
export async function createServices(target, env, execute = fixedDocker, { start } = {}) {
  const observed = await collectLocalTarget(target.runId);
  requireService(
    observed.containerId === target.containerId && observed.networkId === target.networkId,
  );
  const name = `${PROFILE}-${target.runId}`;
  // Images must already exist after separate review; never pull implicitly.
  for (const kind of ["auth", "rest"]) {
    const im = one(await execute(["image", "inspect", SERVICE_IMAGES[kind]]));
    requireService(
      im.Architecture === "arm64" &&
        im.Os === "linux" &&
        im.RepoDigests?.includes(SERVICE_IMAGES[kind]),
    );
    const args = [
      "create",
      "--name",
      `${name}-${kind}`,
      "--label",
      `com.minted.recovery.owner=${PROFILE}`,
      "--label",
      `com.minted.recovery.run-id=${target.runId}`,
      "--network",
      name,
      "--network-alias",
      kind,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--log-driver",
      "none",
      "--restart",
      "no",
      "--memory",
      "256m",
      "--pids-limit",
      "128",
      "--env-file",
      "/dev/stdin",
      SERVICE_IMAGES[kind],
    ];
    if (kind === "auth") args.push("auth", "serve");
    await execute(
      args,
      Object.entries(env[kind])
        .map(([k, v]) => {
          requireService(!/[\r\n]/.test(v));
          return `${k}=${v}`;
        })
        .join("\n") + "\n",
    );
    const c = one(await execute(["container", "inspect", `${name}-${kind}`]));
    owned(c, target, kind);
    await (start ? start(c.Id, kind) : execute(["start", c.Id]));
  }
  return inspectServices(target, execute, env);
}
export async function stopServices(target, execute = fixedDocker) {
  let failed = false;
  for (const kind of ["auth", "rest"]) {
    try {
      const name = `${PROFILE}-${target.runId}-${kind}`;
      const ids = (await execute(["ps", "-aq", "--filter", `name=^/${name}$`])).trim();
      if (!ids) continue;
      requireService(/^[a-f0-9]{12,64}$/.test(ids));
      const c = one(await execute(["container", "inspect", ids]));
      owned(c, target, kind);
      if (c.State.Running) await execute(["stop", "--time", "10", c.Id], undefined, 20000);
      requireService(one(await execute(["container", "inspect", c.Id])).State.Running === false);
    } catch {
      failed = true;
    }
  }
  requireService(!failed);
}
export async function removeServices(target, execute = fixedDocker) {
  let failed = false;
  try {
    await stopServices(target, execute);
  } catch {
    failed = true;
  }
  for (const kind of ["auth", "rest"]) {
    try {
      const name = `${PROFILE}-${target.runId}-${kind}`;
      const ids = (await execute(["ps", "-aq", "--filter", `name=^/${name}$`])).trim();
      if (ids) {
        requireService(/^[a-f0-9]{12,64}$/.test(ids));
        const c = one(await execute(["container", "inspect", ids]));
        owned(c, target, kind);
        await execute(["rm", "--force", c.Id]);
      }
      requireService((await execute(["ps", "-aq", "--filter", `name=^/${name}$`])).trim() === "");
    } catch {
      failed = true;
    }
  }
  try {
    const after = await collectLocalTarget(target.runId);
    requireService(after.containerId === target.containerId);
  } catch {
    failed = true;
  }
  requireService(!failed);
}
