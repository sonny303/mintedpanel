import { describe, it, expect, vi } from "vitest";
import {
  CASE_SEARCH_DEFAULT_LIMIT,
  CASE_SEARCH_MAX_LIMIT,
  normalizeCaseSearchLimit,
  resolveCaseSearchLimit,
} from "./caseSearchLimit";

const db = {} as Parameters<typeof resolveCaseSearchLimit>[0];

describe("case-search limit seam", () => {
  it("defaults to 5 (Sowmya, Oct 30)", () => {
    expect(CASE_SEARCH_DEFAULT_LIMIT).toBe(5);
  });

  it("resolves the default while no platform setting exists (before Mission Control M6)", async () => {
    expect(await resolveCaseSearchLimit(db)).toBe(5);
  });

  it("uses the platform setting when one is set, reading it with the server's client", async () => {
    const readSetting = vi.fn().mockResolvedValue(12);
    expect(await resolveCaseSearchLimit(db, readSetting)).toBe(12);
    expect(readSetting).toHaveBeenCalledWith(db);
  });

  it("caps a platform setting at 50 (the Platform Settings IA maximum)", async () => {
    expect(CASE_SEARCH_MAX_LIMIT).toBe(50);
    expect(normalizeCaseSearchLimit(50)).toBe(50);
    expect(normalizeCaseSearchLimit(51)).toBe(50);
    expect(await resolveCaseSearchLimit(db, async () => 10_000)).toBe(50);
  });

  it.each([null, undefined, 0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "10", {}])(
    "falls back to the default for an unset or unusable setting (%j)",
    async (raw) => {
      expect(normalizeCaseSearchLimit(raw)).toBe(5);
      expect(await resolveCaseSearchLimit(db, async () => raw)).toBe(5);
    },
  );
});
