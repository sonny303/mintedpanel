// One provider's owner-facing card: identity row, x-of-y in-network progress
// (Providers work-view idiom), and one owner-safe payer line per visible case.
// Read-only by construction — no handlers, no mutations.
import { ProgressBar } from "@/components/triage/ProgressBar";
import { StatusPill } from "@/components/triage/StatusPill";
import { fmtDate } from "@/lib/format";
import {
  OWNER_STATUSES,
  type PayerProgressLine,
  type ProviderProgressCardModel,
} from "@/lib/clientProgress";
import type { ClientProgressProvider } from "@/services/clientProgress";

interface ProviderProgressCardProps {
  card: ProviderProgressCardModel<ClientProgressProvider>;
}

function initialsOf(p: ClientProgressProvider): string {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

function PayerLine({ line }: { line: PayerProgressLine }) {
  const status = OWNER_STATUSES[line.statusKey];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex-1 min-w-0 truncate text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
        {line.payerName}
      </span>
      <StatusPill label={status.label} color={status.color} />
      {/* Always rendered so pills align in a column, as on /progress. */}
      <span className="w-36 whitespace-nowrap text-right text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
        {line.effectiveDate ? `Effective ${fmtDate(line.effectiveDate)}` : ""}
      </span>
    </li>
  );
}

export function ProviderProgressCard({ card }: ProviderProgressCardProps) {
  const { provider, lines, inNetwork, denominator } = card;
  return (
    <section className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-mp-primary-tint flex items-center justify-center text-[length:var(--mp-text-xs)] font-semibold text-[color:var(--mp-primary)] flex-shrink-0">
          {initialsOf(provider)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
            {provider.firstName} {provider.lastName}
            {provider.credentials ? (
              <span className="font-normal text-[color:var(--mp-ink-secondary)]">
                , {provider.credentials}
              </span>
            ) : null}
          </div>
          {provider.startDate ? (
            <div className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
              Started {fmtDate(provider.startDate)}
            </div>
          ) : null}
        </div>
        <span className="flex w-full items-center gap-2 md:w-auto">
          <span className="w-full max-w-44 md:w-40 md:flex-shrink-0">
            <ProgressBar value={inNetwork} max={denominator} />
          </span>
          <span className="tabular-nums whitespace-nowrap text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
            {inNetwork} of {denominator} in-network
          </span>
        </span>
      </div>

      {lines.length > 0 ? (
        <ul className="mt-4 divide-y divide-[color:var(--mp-border)] border-t border-mp-border">
          {lines.map((line) => (
            <PayerLine key={line.caseId} line={line} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
          Enrollment hasn't started yet.
        </p>
      )}
    </section>
  );
}
