import { describe, expect, it } from "vitest";
import { formatFullSsn, maskSsn } from "./ssnMask";

describe("maskSsn", () => {
  it("masks a last-4 as ***--NNNN", () => {
    expect(maskSsn("1234")).toBe("***--1234");
  });

  it("renders an em-dash when there is nothing to mask", () => {
    expect(maskSsn(null)).toBe("—");
    expect(maskSsn(undefined)).toBe("—");
    expect(maskSsn("")).toBe("—");
    expect(maskSsn("  ")).toBe("—");
  });

  it("never renders more than the last four digits", () => {
    // Defensive: even a mistakenly-full value can only ever show the last four.
    expect(maskSsn("123456789")).toBe("***--6789");
  });

  it("strips punctuation before masking", () => {
    expect(maskSsn("12-34")).toBe("***--1234");
  });
});

describe("formatFullSsn", () => {
  it("groups nine digits as NNN-NN-NNNN", () => {
    expect(formatFullSsn("123456789")).toBe("123-45-6789");
  });

  it("strips punctuation then groups", () => {
    expect(formatFullSsn("123-45-6789")).toBe("123-45-6789");
  });

  it("returns digits-only when not exactly nine digits (never mis-groups)", () => {
    expect(formatFullSsn("1234")).toBe("1234");
    expect(formatFullSsn("")).toBe("");
    expect(formatFullSsn(null)).toBe("");
  });
});
