// Reporting Guide building blocks — the article, term and question renderers
// shared by the /reporting/guide page and the per-report "About this report"
// sheet. Content comes from src/lib/reportingGuide.ts; nothing here fetches.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { REPORTS } from "@/lib/reports";
import {
  DICTIONARY_TOPIC_ID,
  findGuideTerm,
  findGuideTopic,
  visibleReportKeys,
  visibleTermIds,
  type GuideAudience,
  type GuideQuestion,
  type GuideReport,
  type GuideReviewStatus,
  type GuideTerm,
  type GuideTopic,
} from "@/lib/reportingGuide";

/** "Draft definition" — shown to internal users only, so a review can see
 * what is still unvalidated. Clients never see review state. */
export function DraftChip({
  status,
  audience,
}: {
  status: GuideReviewStatus;
  audience: GuideAudience;
}) {
  if (status !== "draft" || audience !== "internal") return null;
  return <StatusPill status="amber" label="Draft definition" className="shrink-0" />;
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 text-[14px] font-semibold text-foreground">{children}</h3>;
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function LearnBox({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        What you'll learn
      </div>
      <BulletList items={items} />
    </div>
  );
}

function ArticleHeader({
  title,
  summary,
  status,
  audience,
  action,
}: {
  title: string;
  summary: string;
  status: GuideReviewStatus;
  audience: GuideAudience;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[18px] font-semibold tracking-tight text-foreground">{title}</h2>
        <DraftChip status={status} audience={audience} />
      </div>
      <p className="text-[14px] text-muted-foreground">{summary}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

/** Links to related terms and reports, narrowed to what the audience may read. */
export function RelatedLinks({
  reportKeys,
  termIds,
  topicIds = [],
  audience,
}: {
  reportKeys: readonly string[];
  termIds: readonly string[];
  topicIds?: readonly string[];
  audience: GuideAudience;
}) {
  const reports = visibleReportKeys(reportKeys, audience);
  const terms = visibleTermIds(termIds, audience);
  const topics = topicIds.filter((id) => findGuideTopic(id)?.audiences.includes(audience));
  if (reports.length + terms.length + topics.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border pt-4">
      {reports.length + topics.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-medium text-muted-foreground">
            Related articles
          </span>
          {topics.map((id) => (
            <GuideChipLink key={id} topic={id}>
              {findGuideTopic(id)?.title ?? id}
            </GuideChipLink>
          ))}
          {reports.map((key) => (
            <GuideChipLink key={key} topic={key}>
              {REPORTS.find((r) => r.key === key)?.title ?? key}
            </GuideChipLink>
          ))}
        </div>
      ) : null}
      {terms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-medium text-muted-foreground">Related terms</span>
          {terms.map((id) => (
            <GuideChipLink key={id} topic={DICTIONARY_TOPIC_ID} term={id}>
              {findGuideTerm(id)?.term ?? id}
            </GuideChipLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GuideChipLink({
  topic,
  term,
  children,
}: {
  topic: string;
  term?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to="/reporting/guide"
      search={{ topic, term }}
      className="rounded-[var(--mp-radius-control)] border border-border bg-card px-2 py-0.5 text-[12px] text-foreground hover:bg-muted"
    >
      {children}
    </Link>
  );
}

/** A Getting started article (overview, industry timelines). */
export function TopicArticle({ topic, audience }: { topic: GuideTopic; audience: GuideAudience }) {
  return (
    <article className="space-y-5" aria-labelledby={`guide-topic-${topic.id}`}>
      <div id={`guide-topic-${topic.id}`}>
        <ArticleHeader
          title={topic.title}
          summary={topic.summary}
          status={topic.reviewStatus}
          audience={audience}
        />
      </div>
      <LearnBox items={topic.learn} />
      {topic.sections.map((section) => (
        <section key={section.heading}>
          <SectionHeading>{section.heading}</SectionHeading>
          <div className="space-y-2">
            {(section.paragraphs ?? []).map((p) => (
              <p key={p} className="text-[13px] leading-relaxed text-foreground">
                {p}
              </p>
            ))}
            {section.bullets ? <BulletList items={section.bullets} /> : null}
            {section.rows ? (
              <dl className="divide-y divide-[var(--mp-border-subtle)] rounded-md border border-border">
                {section.rows.map((row) => (
                  <div key={row.label} className="grid gap-1 p-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                    <dt className="text-[13px] font-medium text-foreground">{row.label}</dt>
                    <dd className="text-[13px] text-foreground">
                      {row.value}
                      {row.note ? (
                        <span className="mt-0.5 block text-[12px] text-muted-foreground">
                          {row.note}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </section>
      ))}
      <RelatedLinks
        reportKeys={topic.relatedReports}
        termIds={topic.relatedTerms}
        audience={audience}
      />
    </article>
  );
}

/** The body of a report article — shared by the guide page and the sheet. */
export function ReportArticleBody({
  entry,
  audience,
  compact = false,
}: {
  entry: GuideReport;
  audience: GuideAudience;
  compact?: boolean;
}) {
  const { article } = entry;
  return (
    <div className="space-y-5">
      {compact ? null : <LearnBox items={article.learn} />}
      <section>
        <SectionHeading>The question it answers</SectionHeading>
        <p className="text-[13px] leading-relaxed text-foreground">{article.question}</p>
      </section>
      <section>
        <SectionHeading>Who uses it</SectionHeading>
        <p className="text-[13px] leading-relaxed text-foreground">{article.whoUses}</p>
      </section>
      <section>
        <SectionHeading>How to read it</SectionHeading>
        <dl className="divide-y divide-[var(--mp-border-subtle)] rounded-md border border-border">
          {article.howToRead.map((field) => (
            <div
              key={field.label}
              className={`grid gap-1 p-3 ${compact ? "" : "sm:grid-cols-[180px_1fr] sm:gap-4"}`}
            >
              <dt className="text-[13px] font-medium text-foreground">{field.label}</dt>
              <dd className="text-[13px] leading-relaxed text-foreground">{field.meaning}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className={`grid gap-5 ${compact ? "" : "md:grid-cols-2"}`}>
        <section>
          <SectionHeading>What's counted</SectionHeading>
          <BulletList items={article.counted} />
        </section>
        <section>
          <SectionHeading>What's left out</SectionHeading>
          <BulletList items={article.leftOut} />
        </section>
      </div>
      <section>
        <SectionHeading>Filters and export</SectionHeading>
        <BulletList items={article.filtersAndExport} />
      </section>
      {article.goodToKnow.length > 0 ? (
        <section>
          <SectionHeading>Good to know</SectionHeading>
          <BulletList items={article.goodToKnow} />
        </section>
      ) : null}
      {audience === "internal" && article.staffNotes && article.staffNotes.length > 0 ? (
        <section>
          <SectionHeading>For Minted Panel staff</SectionHeading>
          <BulletList items={article.staffNotes} />
        </section>
      ) : null}
    </div>
  );
}

/** A full report article for the guide page. */
export function ReportArticleView({
  entry,
  audience,
}: {
  entry: GuideReport;
  audience: GuideAudience;
}) {
  const { report, article } = entry;
  return (
    <article className="space-y-5" aria-labelledby={`guide-report-${report.key}`}>
      <div id={`guide-report-${report.key}`}>
        <ArticleHeader
          title={report.title}
          summary={article.summary}
          status={article.reviewStatus}
          audience={audience}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={report.path}>
                Open {report.title}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
      </div>
      <ReportArticleBody entry={entry} audience={audience} />
      <RelatedLinks
        reportKeys={article.relatedReports}
        termIds={article.relatedTerms}
        audience={audience}
      />
    </article>
  );
}

/** One dictionary entry. */
export function TermCard({
  term,
  audience,
  highlighted = false,
  showRelated = true,
}: {
  term: GuideTerm;
  audience: GuideAudience;
  highlighted?: boolean;
  showRelated?: boolean;
}) {
  const related = visibleTermIds(term.related, audience);
  return (
    <div
      id={`term-${term.id}`}
      data-testid={`guide-term-${term.id}`}
      className={`scroll-mt-4 rounded-md border bg-card p-4 ${
        highlighted ? "border-[var(--mp-primary)]" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold text-foreground">{term.term}</h3>
        <DraftChip status={term.reviewStatus} audience={audience} />
      </div>
      {term.aka && term.aka.length > 0 ? (
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          Also called {term.aka.join(", ")}
        </div>
      ) : null}
      <p className="mt-2 text-[13px] leading-relaxed text-foreground">{term.definition}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-foreground">
        <span className="font-medium">Where you see it in Minted Panel: </span>
        {term.whereYouSeeIt}
      </p>
      {showRelated && related.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted-foreground">Related</span>
          {related.map((id) => (
            <GuideChipLink key={id} topic={DICTIONARY_TOPIC_ID} term={id}>
              {findGuideTerm(id)?.term ?? id}
            </GuideChipLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One common question with its answer. */
export function QuestionCard({
  question,
  audience,
}: {
  question: GuideQuestion;
  audience: GuideAudience;
}) {
  return (
    <div
      id={`question-${question.id}`}
      className="space-y-2 rounded-md border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold text-foreground">{question.question}</h3>
        <DraftChip status={question.reviewStatus} audience={audience} />
      </div>
      {question.answer.map((p) => (
        <p key={p} className="text-[13px] leading-relaxed text-foreground">
          {p}
        </p>
      ))}
      {question.check ? (
        <p className="text-[13px] leading-relaxed text-foreground">
          <span className="font-medium">How to check: </span>
          {question.check}
        </p>
      ) : null}
      <RelatedLinks
        reportKeys={question.relatedReports}
        termIds={question.relatedTerms}
        audience={audience}
      />
    </div>
  );
}
