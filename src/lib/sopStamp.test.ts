import { describe, expect, it } from "vitest";
import {
  caseIdsUsingGenericSop,
  distinctStampPairs,
  fallbackTemplateIds,
  stampTasks,
  templateStamp,
} from "./sopStamp";
import type { SOPTemplate } from "@/types";

function tmpl(over: Partial<SOPTemplate>): SOPTemplate {
  return {
    id: over.id ?? "t1",
    orgId: "org",
    name: over.name ?? "T",
    groupId: null,
    state: over.state ?? "KS",
    specialty: null,
    payerId: over.payerId ?? "p1",
    taskDefinitions: [],
    isArchived: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("templateStamp (TE-2 version-consistency contract)", () => {
  it("stamps the id + currentVersion pair off the held head-row snapshot", () => {
    expect(templateStamp(tmpl({ id: "humana-ks", currentVersion: 1 }))).toEqual({
      sopTemplateId: "humana-ks",
      sopVersion: 1,
    });
  });

  it("stamps the version read WITH the content, not a re-read: a publish after the snapshot never changes the stamp", () => {
    // The caller resolved content from this snapshot (v1). Someone publishes
    // v2 before the RPC fires — the stamp must stay the resolved v1: the pure
    // function only ever sees the held row, so a racing publish cannot leak in.
    const snapshot = tmpl({ id: "humana-ks", currentVersion: 1 });
    const stampAtResolve = templateStamp(snapshot);
    // ...concurrent publish bumps the DB head to v2 (not our snapshot)...
    expect(templateStamp(snapshot)).toEqual(stampAtResolve);
    expect(stampAtResolve.sopVersion).toBe(1);
  });

  it("returns NULL/NULL for no template (both-or-neither, legacy-shaped)", () => {
    expect(templateStamp(null)).toEqual({ sopTemplateId: null, sopVersion: null });
  });

  it("returns NULL/NULL — never a guessed version — when the head row carries no readable currentVersion", () => {
    expect(templateStamp(tmpl({ id: "stale-cache" }))).toEqual({
      sopTemplateId: null,
      sopVersion: null,
    });
    expect(templateStamp({ id: "bad", currentVersion: 0 })).toEqual({
      sopTemplateId: null,
      sopVersion: null,
    });
    expect(templateStamp({ id: "bad", currentVersion: 1.5 })).toEqual({
      sopTemplateId: null,
      sopVersion: null,
    });
  });
});

describe("stampTasks", () => {
  it("attaches the same stamp to every resolved task payload", () => {
    const tasks = [{ title: "A" }, { title: "B" }];
    const stamped = stampTasks(tasks, tmpl({ id: "tpl", currentVersion: 3 }));
    expect(stamped).toEqual([
      { title: "A", sopTemplateId: "tpl", sopVersion: 3 },
      { title: "B", sopTemplateId: "tpl", sopVersion: 3 },
    ]);
  });

  it("yields unstamped (NULL/NULL) payloads when no template resolved", () => {
    expect(stampTasks([{ title: "A" }], null)).toEqual([
      { title: "A", sopTemplateId: null, sopVersion: null },
    ]);
  });
});

describe("fallbackTemplateIds / caseIdsUsingGenericSop (F2.2.2 chip derivation)", () => {
  const fallback = tmpl({ id: "fb", orgId: null as unknown as string, payerId: null });
  const payerSop = tmpl({ id: "humana-ks", payerId: "p1" });

  it("identifies fallback templates structurally (global + payerless), including archived ones", () => {
    const archivedFallback = tmpl({
      id: "fb-old",
      orgId: null as unknown as string,
      payerId: null,
      archived: true,
      isArchived: true,
    });
    expect(fallbackTemplateIds([fallback, payerSop, archivedFallback])).toEqual(
      new Set(["fb", "fb-old"]),
    );
  });

  it("does not treat an ORG payerless template as fallback", () => {
    expect(fallbackTemplateIds([tmpl({ id: "org-generic", payerId: null })])).toEqual(new Set());
  });

  it("marks a case generic iff any task is stamped with a fallback id; legacy NULL stamps never match", () => {
    const ids = caseIdsUsingGenericSop(
      [
        { caseId: "c1", sopTemplateId: "fb", sopVersion: 1 },
        { caseId: "c2", sopTemplateId: "humana-ks", sopVersion: 2 },
        { caseId: "c3", sopTemplateId: null, sopVersion: null },
        { caseId: null, sopTemplateId: "fb", sopVersion: 1 },
      ],
      new Set(["fb"]),
    );
    expect(ids).toEqual(new Set(["c1"]));
  });
});

describe("distinctStampPairs (provenance lines)", () => {
  it("dedupes to one pair per (template, version) in first-seen order; legacy tasks contribute nothing", () => {
    expect(
      distinctStampPairs([
        { caseId: "c", sopTemplateId: "fb", sopVersion: 1 },
        { caseId: "c", sopTemplateId: "fb", sopVersion: 1 },
        { caseId: "c", sopTemplateId: null, sopVersion: null },
        { caseId: "c", sopTemplateId: "humana-ks", sopVersion: 2 },
      ]),
    ).toEqual([
      { sopTemplateId: "fb", sopVersion: 1 },
      { sopTemplateId: "humana-ks", sopVersion: 2 },
    ]);
  });

  it("returns empty for an all-legacy task list (NULL stamps render unchanged)", () => {
    expect(distinctStampPairs([{ caseId: "c", sopTemplateId: null, sopVersion: null }])).toEqual(
      [],
    );
  });
});
