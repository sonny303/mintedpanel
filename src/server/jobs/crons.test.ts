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

  it("keeps one daily Vercel cron for the follow-up digest, a backup after every US 8 am", () => {
    // Production is on Vercel Hobby: one run a day per cron entry at most, and
    // a more frequent schedule fails the deploy. The hourly tick is the GitHub
    // Actions workflow below. 18:00 UTC is 8 am in Hawaii and later in every
    // other US zone, so the backup only ever catches up ("at or after").
    expect(crons).toEqual([{ path: "/api/jobs/followup-digest", schedule: "0 18 * * *" }]);
    for (const cron of crons) {
      const [minute, hour] = cron.schedule.split(" ");
      expect(/^\d+$/.test(minute) && /^\d+$/.test(hour), `${cron.path} runs once a day`).toBe(true);
    }
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

// The hourly tick (MINT-108): a GitHub Actions schedule, because Vercel Hobby
// allows only daily crons.
const TICK_PATH = ".github/workflows/followup-digest-tick.yml";
const tick = readFileSync(join(root, TICK_PATH), "utf8");

/** Every `run: |` block's body, by indentation. */
function runBlocks(yaml: string): string[] {
  const lines = yaml.split("\n");
  const blocks: string[] = [];
  lines.forEach((line, i) => {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!match) return;
    const indent = match[1].length;
    const body = [match[2]];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== "" && next.length - next.trimStart().length <= indent) break;
      body.push(next);
    }
    blocks.push(body.join("\n"));
  });
  return blocks;
}

describe("the follow-up digest's hourly GitHub Actions tick", () => {
  it("runs hourly off the top of the hour, and on manual dispatch", () => {
    expect([...tick.matchAll(/^\s*- cron: "([^"]+)"$/gm)].map((m) => m[1])).toEqual(["7 * * * *"]);
    expect(tick).toMatch(/^on:\n {2}schedule:\n/m);
    expect(tick).toMatch(/^ {2}workflow_dispatch:\s*$/m);
    expect(tick).not.toMatch(/pull_request|push:|workflow_run|repository_dispatch/);
  });

  it("calls the registered job route that the daily cron also calls", () => {
    const path = /"\$\{BASE_URL%\/\}(\/api\/jobs\/[a-z-]+)"/.exec(tick)?.[1];
    expect(path).toBe("/api/jobs/followup-digest");
    expect(crons.map((cron) => cron.path)).toContain(path);
    expect(JOB_REGISTRY.has("followup-digest")).toBe(true);
    // Production by default, overridable by a repository variable; https only.
    expect(tick).toContain(
      "BASE_URL: ${{ vars.FOLLOWUP_DIGEST_BASE_URL || 'https://mintedpanel.com' }}",
    );
    expect(tick).toContain("https://*) ;;");
  });

  it("sends the CRON_SECRET repository secret as the bearer, through env only", () => {
    expect(tick.match(/\$\{\{\s*secrets\.[A-Z_]+\s*\}\}/g)).toEqual(["${{ secrets.CRON_SECRET }}"]);
    expect(tick).toMatch(/^ {10}CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}$/m);
    expect(tick).toContain('-H "Authorization: Bearer ${CRON_SECRET}"');
    expect(tick).toContain("curl --silent --show-error --fail-with-body --max-time 60");
  });

  it("never interpolates an expression into a run: script, and never prints the secret", () => {
    const blocks = runBlocks(tick);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toContain("${{");
      expect(block).not.toMatch(/\b(echo|printf)\b[^\n]*CRON_SECRET\}?"?\s*$/m);
      expect(block).not.toMatch(/set -[a-z]*x|set -o xtrace/);
    }
    // The guard catches an interpolated secret.
    expect(runBlocks('    run: |\n      curl -H "${{ secrets.CRON_SECRET }}"\n')[0]).toContain(
      "${{",
    );
  });

  it("is a no-op with a notice until the secret is set, and holds no permissions", () => {
    expect(tick).toMatch(
      /if \[ -z "\$\{CRON_SECRET:-\}" \]; then\n\s+echo "::notice[^\n]*"\n\s+exit 0/,
    );
    expect(tick).toMatch(/^permissions: \{\}$/m);
    expect(tick).toMatch(
      /^concurrency:\n {2}group: followup-digest-tick\n {2}cancel-in-progress: false$/m,
    );
    expect(tick).toMatch(/^ {4}timeout-minutes: \d$/m);
    expect(tick).not.toContain("actions/checkout");
  });

  it("prints only the HTTP status, the outcome and the counts", () => {
    const echoes = [...tick.matchAll(/^\s*echo (.*)$/gm)].map((m) => m[1]);
    expect(echoes).toEqual([
      '"::notice title=Follow-up digest tick::CRON_SECRET is not set, so no tick ran."',
      '"::error title=Follow-up digest tick::FOLLOWUP_DIGEST_BASE_URL must start with https://"',
      '"HTTP ${status:-none}: ${summary}"',
    ]);
    expect(tick).toContain("jq -c '{outcome: .data.outcome, counts: .data.counts, error: .error}'");
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
