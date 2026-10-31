import { describe, expect, it } from "vitest";
import { countLabel, pluralize } from "./countLabel";

describe("countLabel", () => {
  it("uses the plural for 0", () => {
    expect(countLabel(0, "section")).toBe("0 sections");
  });

  it("uses the singular for exactly 1", () => {
    expect(countLabel(1, "case")).toBe("1 case");
  });

  it("uses the plural for 2 and more", () => {
    expect(countLabel(2, "payer")).toBe("2 payers");
    expect(countLabel(12, "state")).toBe("12 states");
  });

  it("takes an irregular plural when one is passed", () => {
    expect(countLabel(0, "facility", "facilities")).toBe("0 facilities");
    expect(countLabel(1, "facility", "facilities")).toBe("1 facility");
    expect(countLabel(3, "facility", "facilities")).toBe("3 facilities");
  });
});

describe("pluralize", () => {
  it("returns the word alone, without the count", () => {
    expect(pluralize(1, "case")).toBe("case");
    expect(pluralize(4, "case")).toBe("cases");
  });

  it("picks a verb form that agrees with the count", () => {
    expect(pluralize(1, "blocks", "block")).toBe("blocks");
    expect(pluralize(2, "blocks", "block")).toBe("block");
  });
});
