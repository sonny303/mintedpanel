// The Vercel cron list (MINT-108). vercel.json's `crons` is the one source.
//
// Why vite.config.ts also hands it to nitro: the deploy runs `vercel build`
// then `vercel deploy --prebuilt`, and nitro's vercel preset writes
// .vercel/output/config.json itself, from its own `vercel.config` option. It
// never reads `crons` from vercel.json, so without this the prebuilt output
// ships with no cron and no job ever runs. vite.config.ts reads vercel.json
// through vercelCronsFrom and passes the list as `vercel.config.crons`.
//
// No imports and no `@/` paths: vite.config.ts loads this file before any
// alias exists.

export interface VercelCron {
  path: string;
  schedule: string;
}

const CRON_FIELD = /^[0-9*,/-]+$/;

/** The `crons` of a parsed vercel.json, checked; [] when it has none. */
export function vercelCronsFrom(config: unknown): VercelCron[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("vercel.json must be a JSON object");
  }
  const crons = (config as { crons?: unknown }).crons;
  if (crons === undefined) return [];
  if (!Array.isArray(crons)) throw new Error("vercel.json crons must be an array");
  return crons.map((entry: unknown) => {
    const { path, schedule } = (entry ?? {}) as { path?: unknown; schedule?: unknown };
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error("Each vercel.json cron needs a path starting with /");
    }
    const fields = typeof schedule === "string" ? schedule.trim().split(/\s+/) : [];
    if (fields.length !== 5 || !fields.every((field) => CRON_FIELD.test(field))) {
      throw new Error("Each vercel.json cron needs a five-field numeric schedule");
    }
    return { path, schedule: fields.join(" ") };
  });
}
