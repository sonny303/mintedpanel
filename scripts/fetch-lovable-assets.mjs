#!/usr/bin/env node
// Downloads the Lovable-hosted images referenced by src/assets/*.asset.json into
// public/, so the app serves them itself and the Lovable CDN dependency is gone.
// Run once from a machine that can reach the Lovable site, then commit the files
// it creates under public/__l5e/.
//
// Usage: node scripts/fetch-lovable-assets.mjs https://<your-lovable-site-domain>

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/fetch-lovable-assets.mjs https://<lovable-site-domain>");
  process.exit(1);
}

const assetsDir = fileURLToPath(new URL("../src/assets/", import.meta.url));
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));

let failed = false;
for (const file of (await readdir(assetsDir)).filter((f) => f.endsWith(".asset.json"))) {
  const meta = JSON.parse(await readFile(path.join(assetsDir, file), "utf8"));
  const res = await fetch(new URL(meta.url, base));
  if (!res.ok) {
    console.error(`FAIL ${meta.url} -> HTTP ${res.status}`);
    failed = true;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (meta.size && buf.length !== meta.size) {
    console.warn(`WARN ${meta.url}: got ${buf.length} bytes, asset.json says ${meta.size}`);
  }
  const target = path.join(publicDir, `.${meta.url}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buf);
  console.log(`OK   ${meta.url} (${buf.length} bytes)`);
}
process.exit(failed ? 1 : 0);
