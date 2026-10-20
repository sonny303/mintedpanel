// The Reporting Guide page body: a left nav (a select on phone widths), one
// search box over articles, terms and questions together, and the content
// pane. The open article is the `topic` search param, so every article and
// term deep-links (/reporting/guide?topic=denials,
// /reporting/guide?topic=dictionary&term=psv). Static content only.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DICTIONARY_TOPIC_ID,
  GUIDE_TERM_CATEGORIES,
  QUESTIONS_TOPIC_ID,
  questionsFor,
  reportGroupsFor,
  reportsFor,
  searchGuide,
  termsFor,
  topicsFor,
  type GuideAudience,
  type GuideTermCategory,
} from "@/lib/reportingGuide";
import { QuestionCard, ReportArticleView, TermCard, TopicArticle } from "./GuideContent";

interface NavItem {
  id: string;
  title: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

function useNavSections(audience: GuideAudience): NavSection[] {
  return useMemo(() => {
    const sections: NavSection[] = [
      {
        title: "Getting started",
        items: topicsFor(audience).map((t) => ({ id: t.id, title: t.title })),
      },
      ...reportGroupsFor(audience).map((group) => ({
        title: `Reports · ${group.title}`,
        items: group.reports.map(({ report }) => ({ id: report.key, title: report.title })),
      })),
      {
        title: "Reference",
        items: [
          { id: DICTIONARY_TOPIC_ID, title: "Data dictionary" },
          { id: QUESTIONS_TOPIC_ID, title: "Common questions" },
        ],
      },
    ];
    return sections;
  }, [audience]);
}

function GuideNav({
  sections,
  current,
  onPick,
}: {
  sections: NavSection[];
  current: string;
  onPick: () => void;
}) {
  return (
    <nav aria-label="Guide sections" className="hidden space-y-4 md:block">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.id === current;
              return (
                <li key={item.id}>
                  <Link
                    to="/reporting/guide"
                    search={{ topic: item.id }}
                    onClick={onPick}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-[var(--mp-radius-control)] px-2 py-1.5 text-[13px] ${
                      active
                        ? "bg-[var(--mp-primary-tint)] font-medium text-[var(--mp-primary)]"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function GuideNavSelect({
  sections,
  current,
  onPick,
}: {
  sections: NavSection[];
  current: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="md:hidden">
      <Select value={current} onValueChange={onPick}>
        <SelectTrigger aria-label="Guide section">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sections.map((section) => (
            <SelectGroup key={section.title}>
              <SelectLabel>{section.title}</SelectLabel>
              {section.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Dictionary({ audience, focusTerm }: { audience: GuideAudience; focusTerm?: string }) {
  const [category, setCategory] = useState<GuideTermCategory | "all">("all");
  const all = termsFor(audience);
  const terms = category === "all" ? all : all.filter((t) => t.category === category);
  const letters = Array.from(new Set(terms.map((t) => t.term[0].toUpperCase())));

  // A deep-linked term always shows, whatever category was last picked.
  useEffect(() => {
    if (!focusTerm) return;
    setCategory("all");
    const handle = window.requestAnimationFrame(() => {
      document.getElementById(`term-${focusTerm}`)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [focusTerm]);

  const categories = GUIDE_TERM_CATEGORIES.filter((c) => all.some((t) => t.category === c.key));

  return (
    <article className="space-y-4" aria-labelledby="guide-dictionary">
      <div className="space-y-1">
        <h2 id="guide-dictionary" className="text-[18px] font-semibold tracking-tight">
          Data dictionary
        </h2>
        <p className="text-[14px] text-muted-foreground">
          Plain-English definitions of the terms in Minted Panel's reports, A to Z.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Term category">
        {[{ key: "all" as const, title: "All terms" }, ...categories].map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            aria-pressed={category === c.key}
            className={`rounded-[var(--mp-radius-control)] border px-2.5 py-1 text-[12px] ${
              category === c.key
                ? "border-[var(--mp-primary)] bg-[var(--mp-primary-tint)] font-medium text-[var(--mp-primary)]"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {c.title}
          </button>
        ))}
      </div>
      {category !== "all" ? (
        <p className="text-[13px] text-muted-foreground">
          {GUIDE_TERM_CATEGORIES.find((c) => c.key === category)?.description}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1 text-[12px]" role="group" aria-label="Jump to letter">
        {letters.map((letter) => (
          <button
            key={letter}
            type="button"
            onClick={() =>
              document.getElementById(`letter-${letter}`)?.scrollIntoView({ block: "start" })
            }
            className="rounded-[var(--mp-radius-control)] px-1.5 py-0.5 text-[var(--mp-primary)] hover:bg-muted"
          >
            {letter}
          </button>
        ))}
      </div>
      {letters.map((letter) => (
        <section key={letter} id={`letter-${letter}`} className="scroll-mt-4 space-y-2">
          <h3 className="text-[13px] font-semibold text-muted-foreground">{letter}</h3>
          {terms
            .filter((t) => t.term[0].toUpperCase() === letter)
            .map((term) => (
              <TermCard
                key={term.id}
                term={term}
                audience={audience}
                highlighted={term.id === focusTerm}
              />
            ))}
        </section>
      ))}
    </article>
  );
}

function Questions({ audience }: { audience: GuideAudience }) {
  return (
    <article className="space-y-4" aria-labelledby="guide-questions">
      <div className="space-y-1">
        <h2 id="guide-questions" className="text-[18px] font-semibold tracking-tight">
          Common questions
        </h2>
        <p className="text-[14px] text-muted-foreground">
          Why two numbers don't match, and where to look to see the difference yourself.
        </p>
      </div>
      {questionsFor(audience).map((q) => (
        <QuestionCard key={q.id} question={q} audience={audience} />
      ))}
    </article>
  );
}

function SearchResults({
  query,
  audience,
  onClear,
}: {
  query: string;
  audience: GuideAudience;
  onClear: () => void;
}) {
  const results = searchGuide(query, audience);
  const articles = [
    ...results.topics.map((t) => ({ id: t.id, title: t.title, summary: t.summary })),
    ...results.reports.map(({ report, article }) => ({
      id: report.key,
      title: report.title,
      summary: article.summary,
    })),
  ];
  const total = articles.length + results.terms.length + results.questions.length;

  return (
    <div className="space-y-5" data-testid="guide-search-results">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[18px] font-semibold tracking-tight">
          {total === 1 ? "1 result" : `${total} results`} for “{query.trim()}”
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="text-[13px] text-[var(--mp-primary)] underline-offset-2 hover:underline"
        >
          Clear search
        </button>
      </div>
      {total === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing matches. Try a shorter word, or browse the data dictionary.
        </p>
      ) : null}
      {articles.length > 0 ? (
        <section className="space-y-2" aria-label="Matching articles">
          <h3 className="text-[13px] font-semibold text-muted-foreground">
            Articles ({articles.length})
          </h3>
          <ul className="divide-y divide-[var(--mp-border-subtle)] rounded-md border border-border bg-card">
            {articles.map((a) => (
              <li key={a.id}>
                <Link
                  to="/reporting/guide"
                  search={{ topic: a.id }}
                  onClick={onClear}
                  className="block p-3 hover:bg-muted"
                >
                  <span className="text-[13px] font-medium text-foreground">{a.title}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {a.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {results.terms.length > 0 ? (
        <section className="space-y-2" aria-label="Matching terms">
          <h3 className="text-[13px] font-semibold text-muted-foreground">
            Terms ({results.terms.length})
          </h3>
          {results.terms.map((term) => (
            <TermCard key={term.id} term={term} audience={audience} />
          ))}
        </section>
      ) : null}
      {results.questions.length > 0 ? (
        <section className="space-y-2" aria-label="Matching questions">
          <h3 className="text-[13px] font-semibold text-muted-foreground">
            Common questions ({results.questions.length})
          </h3>
          {results.questions.map((q) => (
            <QuestionCard key={q.id} question={q} audience={audience} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function ReportingGuide({
  topic,
  term,
  audience,
}: {
  topic: string;
  term?: string;
  audience: GuideAudience;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const sections = useNavSections(audience);
  const searching = query.trim().length > 0;

  const visibleTopic = topicsFor(audience).find((t) => t.id === topic);
  const reportEntry = reportsFor(audience).find((entry) => entry.report.key === topic);

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <aside className="md:sticky md:top-0 md:w-60 md:shrink-0">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide"
              aria-label="Search the guide"
              className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <GuideNavSelect
            sections={sections}
            current={topic}
            onPick={(id) => {
              setQuery("");
              void navigate({ to: "/reporting/guide", search: { topic: id } });
            }}
          />
          <GuideNav sections={sections} current={topic} onPick={() => setQuery("")} />
        </div>
      </aside>
      <div className="max-w-3xl min-w-0 flex-1">
        {searching ? (
          <SearchResults query={query} audience={audience} onClear={() => setQuery("")} />
        ) : topic === DICTIONARY_TOPIC_ID ? (
          <Dictionary audience={audience} focusTerm={term} />
        ) : topic === QUESTIONS_TOPIC_ID ? (
          <Questions audience={audience} />
        ) : reportEntry ? (
          <ReportArticleView entry={reportEntry} audience={audience} />
        ) : visibleTopic ? (
          <TopicArticle topic={visibleTopic} audience={audience} />
        ) : null}
      </div>
    </div>
  );
}
