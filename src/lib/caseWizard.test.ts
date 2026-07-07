import { describe, it, expect } from "vitest";
import {
  findUnresolvedTokens,
  splitOnUnresolvedTokens,
  firstIncompleteTaskIndex,
} from "./caseWizard";
import type { TaskStatus } from "@/types";

describe("findUnresolvedTokens", () => {
  it("returns the bare token names inside {{ ... }}", () => {
    expect(
      findUnresolvedTokens("Hi {{provider.firstName}}, your NPI is {{provider.npi}}."),
    ).toEqual(["provider.firstName", "provider.npi"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(findUnresolvedTokens("Dear {{  provider.lastName  }}")).toEqual(["provider.lastName"]);
  });

  it("de-dupes repeated tokens, preserving first-seen order", () => {
    expect(findUnresolvedTokens("{{a}} then {{b}} then {{a}}")).toEqual(["a", "b"]);
  });

  it("returns an empty array for fully-resolved text or empty input", () => {
    expect(findUnresolvedTokens("Everything is filled in.")).toEqual([]);
    expect(findUnresolvedTokens("")).toEqual([]);
    expect(findUnresolvedTokens(null)).toEqual([]);
    expect(findUnresolvedTokens(undefined)).toEqual([]);
  });

  it("ignores blank placeholders", () => {
    expect(findUnresolvedTokens("a {{ }} b")).toEqual([]);
  });

  it("does not merge adjacent placeholders", () => {
    expect(findUnresolvedTokens("{{one}}{{two}}")).toEqual(["one", "two"]);
  });
});

describe("splitOnUnresolvedTokens", () => {
  it("alternates plain and token segments", () => {
    expect(splitOnUnresolvedTokens("Hi {{x}}!")).toEqual([
      { value: "Hi ", isToken: false },
      { value: "{{x}}", isToken: true },
      { value: "!", isToken: false },
    ]);
  });

  it("keeps the raw braced form on token segments", () => {
    expect(splitOnUnresolvedTokens("{{ y }}")).toEqual([{ value: "{{ y }}", isToken: true }]);
  });

  it("returns a single plain segment when there are no tokens", () => {
    expect(splitOnUnresolvedTokens("no tokens here")).toEqual([
      { value: "no tokens here", isToken: false },
    ]);
  });

  it("handles back-to-back tokens with no text between", () => {
    expect(splitOnUnresolvedTokens("{{a}}{{b}}")).toEqual([
      { value: "{{a}}", isToken: true },
      { value: "{{b}}", isToken: true },
    ]);
  });
});

describe("firstIncompleteTaskIndex", () => {
  const t = (status: TaskStatus) => ({ status });

  it("returns the index of the first non-completed task", () => {
    expect(
      firstIncompleteTaskIndex([
        t("completed"),
        t("completed"),
        t("in_progress"),
        t("not_started"),
      ]),
    ).toBe(2);
  });

  it("returns 0 when the first task is incomplete", () => {
    expect(firstIncompleteTaskIndex([t("not_started"), t("completed")])).toBe(0);
  });

  it("returns 0 when every task is completed", () => {
    expect(firstIncompleteTaskIndex([t("completed"), t("completed")])).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(firstIncompleteTaskIndex([])).toBe(0);
  });
});
