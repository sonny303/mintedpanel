// Client Progress v1 (M5.5): read-only owner view at /progress. Plain-language
// progress per provider, zero credentialing jargon. Every string is derived or
// mapped in src/lib/ownerWording.ts — no hand-written copy. Pre-cred cases
// never render as payer rows.
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ActionBadge } from "@/components/triage/ActionBadge";
import { StatusPill } from "@/components/triage/StatusPill";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useFollowUpsDue } from "@/hooks/useTouches";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import {
  expandCredentials,
  ownerState,
  ownerWhen,
  type OwnerWordingInput,
} from "@/lib/ownerWording";

export const Route = createFileRoute("/progress")({
  component: ProgressPage,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";
const NOTE_TRUNCATE = 90;

function firstSentence(notes: string | null): string | null {
  if (!notes) return null;
  const sentence = notes.split(/(?<=[.!?])\s/)[0] ?? notes;
  return sentence.length > NOTE_TRUNCATE ? `${sentence.slice(0, NOTE_TRUNCATE)}…` : sentence;
}

function ProgressPage() {
  const providersQ = useProviders();
  const casesQ = useCases();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();
  const followUpsQ = useFollowUpsDue();

  const now = new Date();
  const loading = providersQ.isLoading || casesQ.isLoading || statusConfigsQ.isLoading;
  const failed = providersQ.isError || casesQ.isError || statusConfigsQ.isError;

  const model = useMemo(() => {
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));

    // Owner-relevant cases: real payers only (pre-cred excluded), Not Required omitted.
    const rows = (casesQ.data ?? [])
      .map((c) => {
        const payer = payerById.get(c.payerId);
        const status = c.credentialingStatusId
          ? (statusById.get(c.credentialingStatusId) ?? null)
          : null;
        const latest = followUpsQ.data?.get(c.id) ?? null;
        const wordingInput: OwnerWordingInput = {
          statusLabel: status?.label ?? null,
          confirmedEffectiveDate: c.confirmedEffectiveDate,
          expectedEffectiveDate: c.expectedEffectiveDate,
          submittedDate: c.submittedDate,
          avgDecisionDays: payer?.avgDecisionDays ?? null,
          nextFollowUpDate: latest?.nextFollowUpDate ?? null,
          now,
        };
        return {
          case: c,
          payerName: payer?.name ?? "Unknown payer",
          isPreCred: payer?.name === PRE_CRED_PAYER_NAME,
          state: ownerState(wordingInput),
          when: ownerWhen(wordingInput),
          latestTouch: latest,
        };
      })
      .filter((r) => !r.isPreCred && !r.state.omit);

    const active = rows.filter((r) => r.state.billingNow).length;

    const cards = (providersQ.data ?? [])
      .map((p) => {
        const mine = rows.filter((r) => r.case.providerId === p.id);
        if (mine.length === 0) return null;
        const billing = mine.filter((r) => r.state.billingNow);
        // Latest touch across the provider's cases, for the templated line.
        const latest = mine
          .filter((r) => r.latestTouch != null)
          .sort((a, b) =>
            (b.latestTouch?.touchDate ?? "").localeCompare(a.latestTouch?.touchDate ?? ""),
          )[0];
        const note = firstSentence(latest?.latestTouch?.notes ?? null);
        const sentence = [
          `Billing ${billing.length} of ${mine.length} insurers.`,
          latest?.latestTouch
            ? `Latest: ${latest.payerName}${note ? ` — ${note}` : ""} (${format(
                new Date(latest.latestTouch.touchDate),
                "MMM d",
              )}).`
            : null,
        ]
          .filter(Boolean)
          .join(" ");
        // Worst case first (owner tones roughly track urgency): danger > warn > neutral > info > pending > ok
        const toneRank = { danger: 0, warn: 1, neutral: 2, info: 3, pending: 4, ok: 5 } as const;
        const worst = [...mine].sort((a, b) => toneRank[a.state.tone] - toneRank[b.state.tone])[0];
        return { provider: p, rows: mine, billing, sentence, worst };
      })
      .filter((c) => c !== null);

    return { active, denominator: rows.length, cards };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is derived each render by design
  }, [providersQ.data, casesQ.data, payersQ.data, statusConfigsQ.data, followUpsQ.data]);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Client progress"
        description={`${model.active} of ${model.denominator} insurer enrollments active · Updated ${format(now, "MMM d, h:mm a")}`}
      />
      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load progress. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : model.cards.length === 0 ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card px-5 py-12">
          <EmptyState
            message="Nothing to show yet"
            description="Provider enrollment progress will appear here once credentialing begins."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {model.cards.map((card) => (
            <section
              key={card.provider.id}
              className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[length:var(--mp-text-base)] font-semibold text-[color:var(--mp-ink)]">
                    {card.provider.firstName} {card.provider.lastName}
                  </div>
                  {expandCredentials(card.provider.credentials) ? (
                    <div className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
                      {expandCredentials(card.provider.credentials)}
                    </div>
                  ) : null}
                </div>
                <ActionBadge tone={card.worst.state.tone} text={card.worst.state.label} />
              </div>

              <p className="mt-3 text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
                {card.sentence}
              </p>

              {card.billing.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[length:var(--mp-text-2xs)] font-bold uppercase tracking-wider text-[color:var(--mp-ok)]">
                    Billing now
                  </span>
                  {card.billing.map((r) => (
                    <StatusPill key={r.case.id} label={r.payerName} color="var(--mp-ok)" />
                  ))}
                </div>
              ) : null}

              <ul className="mt-4 divide-y divide-[color:var(--mp-border)] border-t border-mp-border">
                {card.rows.map((r) => (
                  <li key={r.case.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex-1 min-w-0 truncate text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
                      {r.payerName}
                    </span>
                    <ActionBadge tone={r.state.tone} text={r.state.label} />
                    <span className="w-36 text-right text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
                      {r.when}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
