import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/hooks/queryKeys";
import { providerRosterCacheKeys } from "@/lib/providerRosterCaches";

const SRC = join(process.cwd(), "src");

describe("providerRosterCacheKeys", () => {
  it("includes the readiness-facts fence plus group and facility memberships", () => {
    const keys = providerRosterCacheKeys("org-1");
    expect(keys).toEqual(
      expect.arrayContaining([
        ["providers", "org-1"],
        queryKeys.providerGroupAssignments("org-1"),
        queryKeys.orgStateLicenses("org-1"),
        queryKeys.facilityAssignments("org-1"),
        queryKeys.providerReadinessFacts("org-1"),
      ]),
    );
  });
});

describe("create-provider cache invalidation", () => {
  it("the shared create hook awaits the roster cache set", () => {
    const hook = readFileSync(join(SRC, "hooks/useProviders.ts"), "utf8");
    expect(hook).toContain("invalidateProviderRosterCaches");
    expect(hook).toMatch(
      /useCreateProviderWithDetails[\s\S]*onSuccess: async \(\) => \{\s*await invalidateProviderRosterCaches/,
    );
  });

  it("the Add Provider route uses the shared hook instead of a second invalidate list", () => {
    const route = readFileSync(join(SRC, "routes/providers.new.tsx"), "utf8");
    expect(route).toContain("useCreateProviderWithDetails");
    expect(route).not.toMatch(/invalidateQueries/);
    expect(route).not.toMatch(/useMutation/);
  });
});
