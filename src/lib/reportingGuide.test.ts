import { describe, expect, it } from "vitest";
import { REPORTS } from "@/lib/reports";
import {
  DEFAULT_TOPIC_ID,
  DICTIONARY_TOPIC_ID,
  GUIDE_QUESTIONS,
  GUIDE_TERMS,
  GUIDE_TOPICS,
  REPORT_ARTICLES,
  findGuideTerm,
  guideAudienceFor,
  guideTermFor,
  questionsFor,
  reportsFor,
  resolveGuideTopic,
  searchGuide,
  termsFor,
  topicsFor,
  visibleReportKeys,
  visibleTermIds,
} from "@/lib/reportingGuide";

const REPORT_KEYS = new Set(REPORTS.map((r) => r.key));
const TERM_IDS = new Set(GUIDE_TERMS.map((t) => t.id));
const TOPIC_IDS = new Set(GUIDE_TOPICS.map((t) => t.id));

/** The only report a client-audience user can open today. */
const CLIENT_REPORTS = ["enrollment-explorer"];

describe("reporting guide — registry coverage", () => {
  it("has an article for every report in the registry", () => {
    const missing = REPORTS.filter((r) => !REPORT_ARTICLES.some((a) => a.reportKey === r.key));
    expect(missing.map((r) => r.key)).toEqual([]);
  });

  it("has no article for a key that is not in the registry", () => {
    const orphans = REPORT_ARTICLES.filter((a) => !REPORT_KEYS.has(a.reportKey));
    expect(orphans.map((a) => a.reportKey)).toEqual([]);
  });

  it("has exactly one article per report key", () => {
    const keys = REPORT_ARTICLES.map((a) => a.reportKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("reporting guide — references resolve", () => {
  it("every term id is unique", () => {
    expect(TERM_IDS.size).toBe(GUIDE_TERMS.length);
  });

  it("every related-term reference resolves to a term", () => {
    const refs = [
      ...GUIDE_TERMS.flatMap((t) => t.related.map((id) => [`term ${t.id}`, id])),
      ...REPORT_ARTICLES.flatMap((a) => a.relatedTerms.map((id) => [`report ${a.reportKey}`, id])),
      ...GUIDE_TOPICS.flatMap((t) => t.relatedTerms.map((id) => [`topic ${t.id}`, id])),
      ...GUIDE_QUESTIONS.flatMap((q) => q.relatedTerms.map((id) => [`question ${q.id}`, id])),
    ];
    const broken = refs.filter(([, id]) => !TERM_IDS.has(id));
    expect(broken).toEqual([]);
  });

  it("every related-report reference resolves to a registry key", () => {
    const refs = [
      ...REPORT_ARTICLES.flatMap((a) =>
        a.relatedReports.map((key) => [`report ${a.reportKey}`, key]),
      ),
      ...GUIDE_TOPICS.flatMap((t) => t.relatedReports.map((key) => [`topic ${t.id}`, key])),
      ...GUIDE_QUESTIONS.flatMap((q) => q.relatedReports.map((key) => [`question ${q.id}`, key])),
    ];
    const broken = refs.filter(([, key]) => !REPORT_KEYS.has(key));
    expect(broken).toEqual([]);
  });

  it("no term relates to itself and no article lists itself as related", () => {
    expect(GUIDE_TERMS.filter((t) => t.related.includes(t.id)).map((t) => t.id)).toEqual([]);
    expect(
      REPORT_ARTICLES.filter((a) => a.relatedReports.includes(a.reportKey)).map((a) => a.reportKey),
    ).toEqual([]);
  });

  it("topic ids never collide with report keys or the reference pages", () => {
    for (const id of TOPIC_IDS) {
      expect(REPORT_KEYS.has(id)).toBe(false);
      expect(id).not.toBe(DICTIONARY_TOPIC_ID);
    }
  });
});

describe("reporting guide — content shape", () => {
  it("every article has the sections the guide renders", () => {
    for (const a of REPORT_ARTICLES) {
      expect(a.summary, a.reportKey).not.toBe("");
      expect(a.question, a.reportKey).not.toBe("");
      expect(a.howToRead.length, a.reportKey).toBeGreaterThan(0);
      expect(a.counted.length, a.reportKey).toBeGreaterThan(0);
      expect(a.leftOut.length, a.reportKey).toBeGreaterThan(0);
      expect(a.filtersAndExport.length, a.reportKey).toBeGreaterThan(0);
    }
  });

  it("every term has a definition and a place you see it", () => {
    for (const t of GUIDE_TERMS) {
      expect(t.definition, t.id).not.toBe("");
      expect(t.whereYouSeeIt, t.id).not.toBe("");
      expect(t.audiences.length, t.id).toBeGreaterThan(0);
    }
  });

  it("keeps internal wording out of user-facing text", () => {
    const text = JSON.stringify([GUIDE_TERMS, REPORT_ARTICLES, GUIDE_TOPICS, GUIDE_QUESTIONS]);
    // Table names, epic numbers and file paths never reach the UI.
    for (const leak of [
      /\bcredential_cases\b/,
      /\bcase_facilities\b/,
      /\bstate_licenses\b/,
      /\bprovider_documents\b/,
      /\bE\d\.\d+\b/,
      /src\//,
      /\.tsx?\b/,
      /\bTODO\b/,
    ]) {
      expect(text).not.toMatch(leak);
    }
  });
});

describe("reporting guide — audience", () => {
  it("maps the access context audience onto the two views", () => {
    expect(guideAudienceFor("client")).toBe("client");
    expect(guideAudienceFor("staff")).toBe("internal");
    expect(guideAudienceFor(null)).toBe("internal");
    expect(guideAudienceFor(undefined)).toBe("internal");
  });

  it("client users see only the reports a client can open", () => {
    expect(reportsFor("client").map((e) => e.report.key)).toEqual(CLIENT_REPORTS);
  });

  it("internal users see every report", () => {
    expect(reportsFor("internal").map((e) => e.report.key)).toEqual(REPORTS.map((r) => r.key));
  });

  it("no text a client can read names an internal-only report", () => {
    const internalTitles = REPORTS.filter((r) => !CLIENT_REPORTS.includes(r.key)).map(
      (r) => r.title,
    );
    const clientText = JSON.stringify([
      termsFor("client").map((t) => [t.term, t.aka, t.definition, t.whereYouSeeIt]),
      questionsFor("client").map((q) => [q.question, q.answer, q.check]),
      topicsFor("client").map((t) => [t.title, t.summary, t.learn, t.sections]),
      reportsFor("client").map(({ article }) => [
        article.summary,
        article.question,
        article.whoUses,
        article.howToRead,
        article.counted,
        article.leftOut,
        article.filtersAndExport,
        article.goodToKnow,
      ]),
    ]);
    for (const title of internalTitles) {
      expect(clientText.includes(title), title).toBe(false);
    }
  });

  it("related links a client sees point only at client reports and terms", () => {
    const linked = [
      ...questionsFor("client").flatMap((q) => q.relatedReports),
      ...topicsFor("client").flatMap((t) => t.relatedReports),
      ...reportsFor("client").flatMap(({ article }) => article.relatedReports),
    ];
    expect(visibleReportKeys(linked, "client").every((k) => CLIENT_REPORTS.includes(k))).toBe(true);
    const terms = reportsFor("client").flatMap(({ article }) => article.relatedTerms);
    for (const id of visibleTermIds(terms, "client")) {
      expect(guideTermFor(id, "client")?.audiences).toContain("client");
    }
  });

  it("client users read their own where-you-see-it text", () => {
    expect(guideTermFor("group", "client")?.whereYouSeeIt).toMatch(/Enrollment Explorer/);
    expect(guideTermFor("group", "internal")?.whereYouSeeIt).toMatch(/sidebar/);
    expect(guideTermFor("touch", "client")).toBeUndefined();
  });

  it("client users get the basics and every case status", () => {
    const ids = new Set(termsFor("client").map((t) => t.id));
    for (const t of GUIDE_TERMS.filter(
      (t) => t.category === "basics" || t.category === "statuses",
    )) {
      expect(ids.has(t.id), t.id).toBe(true);
    }
  });

  it("an unknown or hidden deep link falls back to Getting started", () => {
    expect(resolveGuideTopic(undefined, "internal")).toBe(DEFAULT_TOPIC_ID);
    expect(resolveGuideTopic("nope", "internal")).toBe(DEFAULT_TOPIC_ID);
    expect(resolveGuideTopic("denials", "internal")).toBe("denials");
    expect(resolveGuideTopic("denials", "client")).toBe(DEFAULT_TOPIC_ID);
    expect(resolveGuideTopic("enrollment-explorer", "client")).toBe("enrollment-explorer");
    expect(resolveGuideTopic(DICTIONARY_TOPIC_ID, "client")).toBe(DICTIONARY_TOPIC_ID);
  });
});

describe("reporting guide — search", () => {
  it("an empty query matches nothing", () => {
    const r = searchGuide("   ", "internal");
    expect(r.topics.length + r.reports.length + r.terms.length + r.questions.length).toBe(0);
  });

  it("finds terms by name and alias, case-insensitively", () => {
    expect(searchGuide("psv", "internal").terms.map((t) => t.id)).toContain("psv");
    expect(searchGuide("TAX ID", "internal").terms.map((t) => t.id)).toContain("tin");
  });

  it("searches report articles and terms together", () => {
    const r = searchGuide("denied", "internal");
    expect(r.reports.map((e) => e.report.key)).toContain("denials");
    expect(r.terms.map((t) => t.id)).toContain("denied");
  });

  it("never returns internal-only content to a client", () => {
    const r = searchGuide("denied", "client");
    expect(r.reports.map((e) => e.report.key)).not.toContain("denials");
    expect(r.terms.every((t) => t.audiences.includes("client"))).toBe(true);
  });

  it("finds a term by any word of its definition", () => {
    expect(findGuideTerm("npi")).toBeDefined();
    expect(searchGuide("10-digit", "internal").terms.map((t) => t.id)).toContain("npi");
  });
});
