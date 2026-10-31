import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConfigEnv, UserConfig } from "vite";

// The nitro plugin is replaced by a spy so loading vite.config.ts records the
// options it passes and builds nothing.
const nitroSpy = vi.hoisted(() => vi.fn((_options: unknown) => []));
vi.mock("nitro/vite", () => ({ nitro: nitroSpy }));

import { JOB_NAME_RE, JOB_REGISTRY } from "./registry";
import { vercelCronsFrom } from "./vercelCrons";

// MINT-108 cron contract. vercel.json declares the schedule; Vercel cron calls
// GET /api/jobs/<name>; the deploy ships nitro's prebuilt .vercel/output,
// whose config.json nitro writes from its own vercel.config option and never
// from vercel.json. So vite.config.ts must hand vercel.json's crons to nitro.
const root = process.cwd();
const vercelJson: unknown = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const crons = vercelCronsFrom(vercelJson);
const JOB_PATH = /^\/api\/jobs\/([^/]+)$/;

describe("vercel.json crons and the job registry agree", () => {
  it("points every cron at a registered job", () => {
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) {
      const name = JOB_PATH.exec(cron.path)?.[1];
      expect(name, cron.path).toMatch(JOB_NAME_RE);
      expect(JOB_REGISTRY.has(name as string), cron.path).toBe(true);
    }
  });

  it("schedules every registered job exactly once", () => {
    for (const name of JOB_REGISTRY.keys()) {
      expect(crons.filter((cron) => cron.path === `/api/jobs/${name}`)).toHaveLength(1);
    }
  });

  it("runs the follow-up digest once a day at 13:00 UTC", () => {
    // Daily deploys on any Vercel plan (Hobby rejects more frequent crons, and
    // a rejected cron fails the production deploy). At 13:00 UTC the UTC date
    // is the local date in every US time zone, 8 to 9 am Eastern. On Pro,
    // "0 12-23 * * *" adds hourly retries with no other change.
    expect(crons).toEqual([{ path: "/api/jobs/followup-digest", schedule: "0 13 * * *" }]);
  });

  it("rejects a malformed cron list", () => {
    expect(vercelCronsFrom({})).toEqual([]);
    expect(() => vercelCronsFrom([])).toThrow();
    expect(() => vercelCronsFrom({ crons: {} })).toThrow();
    expect(() =>
      vercelCronsFrom({ crons: [{ path: "api/jobs/x", schedule: "0 * * * *" }] }),
    ).toThrow();
    expect(() =>
      vercelCronsFrom({ crons: [{ path: "/api/jobs/x", schedule: "hourly" }] }),
    ).toThrow();
    expect(() =>
      vercelCronsFrom({ crons: [{ path: "/api/jobs/x", schedule: "0 * * *" }] }),
    ).toThrow();
  });
});

describe("vite.config.ts delivers the crons into nitro's Vercel build output", () => {
  async function nitroOptionsFor(env: ConfigEnv): Promise<unknown[]> {
    nitroSpy.mockClear();
    const { default: config } = await import("../../../vite.config");
    const factory = config as unknown as (env: ConfigEnv) => UserConfig;
    factory(env);
    return nitroSpy.mock.calls.map(([options]) => options);
  }

  it("passes vercel.json's crons as nitro's vercel.config.crons on build", async () => {
    const options = await nitroOptionsFor({ command: "build", mode: "production" });
    expect(options).toEqual([
      {
        defaultPreset: "cloudflare-module",
        vercel: { config: { version: 3, crons } },
      },
    ]);
  });

  it("adds no nitro plugin outside a build", async () => {
    expect(await nitroOptionsFor({ command: "serve", mode: "development" })).toEqual([]);
  });
});
