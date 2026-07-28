// Payer & Cases design bundle, screen 3 Enrollments (Slice C) — providers
// credentialed with this payer, with the captured ID under the payer's OWN
// label. Read-only by design: "cases capture, payer pages display" (screen 5),
// so every row links back to the case that captured it and nothing here writes.
//
// Composed from caches the app already holds — enrollment facts, the case list
// projection, and the PHI-narrow provider list — through the pure
// buildPayerEnrollmentRows, whose ID badge rides Slice D's enrollmentIdBadge
// (resolver-backed: a NULL-column payer resolves EXPECTED, so a missing ID
// reads "Awaiting ID" rather than silently rendering nothing).
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { useCases } from "@/hooks/useCases";
import { useEnrollmentFacts } from "@/hooks/useEnrollmentFacts";
import { useProviders } from "@/hooks/useProviders";
import { fmtDate } from "@/lib/format";
import { buildPayerEnrollmentRows } from "@/lib/payerDetailView";
import { resolveIdentifierConfig } from "@/lib/payerResolutionIdentifier";
import type { Payer } from "@/types";

export function PayerEnrollmentsTab({ payer }: { payer: Payer }) {
  const factsQ = useEnrollmentFacts();
  const casesQ = useCases();
  const providersQ = useProviders();

  const providerNames = useMemo(
    () =>
      new Map(
        (providersQ.data ?? []).map((p) => [
          p.id,
          `${p.lastName}, ${p.firstName}${p.credentials ? `, ${p.credentials}` : ""}`,
        ]),
      ),
    [providersQ.data],
  );

  const rows = useMemo(
    () =>
      buildPayerEnrollmentRows(
        payer.id,
        payer,
        factsQ.data ?? [],
        casesQ.data ?? [],
        providerNames,
      ),
    [payer, factsQ.data, casesQ.data, providerNames],
  );

  const idLabel = resolveIdentifierConfig(payer).individualLabel;
  // providersQ feeds the provider-name map above, so it belongs in BOTH guards
  // — omitting it from `loading` renders rows with unresolved names that pop in
  // a moment later. `failed` already accounted for it.
  const loading =
    factsQ.data === undefined || casesQ.data === undefined || providersQ.data === undefined;
  const failed = factsQ.isError || casesQ.isError || providersQ.isError;

  return (
    <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
      <div className="border-b border-[#E8E5E0] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-foreground">Enrolled providers</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Providers credentialed with this payer. IDs are captured when a case is approved —
          read-only here.
        </p>
      </div>
      <div className="p-5">
        {failed ? (
          <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load enrollments.</p>
        ) : loading ? (
          <Skeleton className="h-20 w-full rounded-[6px]" />
        ) : rows.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-[#DCDAD4] px-4 py-10 text-center">
            <div className="text-[14px] font-semibold text-foreground">
              No providers credentialed yet
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Providers appear here when their case with this payer is approved.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[6px] border border-[#E8E5E0]">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#E8E5E0] bg-[#FBFBF9] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">{idLabel}</th>
                  <th className="px-3 py-2">Effective</th>
                  <th className="px-3 py-2">From</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-[#F0EEEA] last:border-b-0">
                    <td className="px-3 py-2.5 text-[13px]">
                      <Link
                        to="/providers/$id"
                        params={{ id: row.providerId }}
                        className="font-medium text-foreground underline-offset-2 hover:text-[#1B4D3E] hover:underline"
                      >
                        {row.providerName}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">{row.state}</td>
                    <td className="px-3 py-2.5 text-[13px]">
                      {row.badge.kind === "value" ? (
                        <span className="font-mono text-foreground">{row.badge.value}</span>
                      ) : row.badge.kind === "awaiting" ? (
                        <StatusPill status="amber" label="Awaiting ID" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                      {row.effectiveDate ? fmtDate(row.effectiveDate) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[13px]">
                      {row.caseId ? (
                        <Link
                          to="/cases/$id"
                          params={{ id: row.caseId }}
                          className="font-medium text-[#1B4D3E] underline underline-offset-2"
                        >
                          {row.caseNumber ? `C-${row.caseNumber}` : "Open case"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Recorded enrollment</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
