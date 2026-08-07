import { describe, it, expect } from "vitest";
import { splitFullName, composeFullName, personDisplayName } from "./personName";

describe("splitFullName", () => {
  it("splits on the last whitespace run", () => {
    expect(splitFullName("Marc Douek")).toEqual({ firstName: "Marc", lastName: "Douek" });
  });

  it("keeps middle names with the first name", () => {
    expect(splitFullName("Mary Anne Van Der Berg")).toEqual({
      firstName: "Mary Anne Van Der",
      lastName: "Berg",
    });
  });

  it("treats a single token as all first name", () => {
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });

  it("trims surrounding and collapsing whitespace", () => {
    expect(splitFullName("  Marc   Douek  ")).toEqual({ firstName: "Marc", lastName: "Douek" });
  });

  it("returns empty parts for empty / null / undefined", () => {
    expect(splitFullName("")).toEqual({ firstName: "", lastName: "" });
    expect(splitFullName("   ")).toEqual({ firstName: "", lastName: "" });
    expect(splitFullName(null)).toEqual({ firstName: "", lastName: "" });
    expect(splitFullName(undefined)).toEqual({ firstName: "", lastName: "" });
  });

  it("puts a suffix in the last-name slot — the documented lossy case a human fixes", () => {
    // The rule is deliberately simple and predictable rather than clever: an
    // editable form is the correction mechanism, not a smarter regex.
    expect(splitFullName("John Smith Jr")).toEqual({ firstName: "John Smith", lastName: "Jr" });
  });
});

describe("composeFullName", () => {
  it("joins first and last", () => {
    expect(composeFullName({ firstName: "Marc", lastName: "Douek" })).toBe("Marc Douek");
  });

  it("drops an empty half without leaving stray whitespace", () => {
    expect(composeFullName({ firstName: "Cher", lastName: "" })).toBe("Cher");
    expect(composeFullName({ firstName: "", lastName: "Douek" })).toBe("Douek");
  });

  it("tolerates nulls and untrimmed input", () => {
    expect(composeFullName({ firstName: null, lastName: null })).toBe("");
    expect(composeFullName({ firstName: " Marc ", lastName: " Douek " })).toBe("Marc Douek");
  });

  it("round-trips a split", () => {
    const full = "Mary Anne Berg";
    expect(composeFullName(splitFullName(full))).toBe(full);
  });
});

describe("personDisplayName", () => {
  it("prefers the composed parts", () => {
    expect(personDisplayName({ firstName: "Marc", lastName: "Douek", name: "stale" })).toBe(
      "Marc Douek",
    );
  });

  it("falls back to the stored display name for a pre-split row", () => {
    expect(personDisplayName({ firstName: null, lastName: null, name: "Marc Douek" })).toBe(
      "Marc Douek",
    );
  });

  it("returns empty when nothing is set", () => {
    expect(personDisplayName({})).toBe("");
  });
});
