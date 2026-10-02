import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("credentialing website assets", () => {
  it("ships the three customer logos the landing page references", () => {
    for (const file of [
      "public/customers/best-physical-therapy.png",
      "public/customers/physio.png",
      "public/customers/renew-physiotherapy.png",
    ]) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
  });
});
