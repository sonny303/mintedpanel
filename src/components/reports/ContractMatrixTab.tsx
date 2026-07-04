// Reports → Contracts (M4): read-only payer × state matrix. Columns are the
// distinct states across group contracts plus launch states (new states get a
// NEW tag). Cells show the contracting StatusPill from status_configs plus a
// future effective date; a dash means no contract.
import { useMemo } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { StatusPill } from "@/components/triage/StatusPill";
import { useContracts } from "@/hooks/useContracts";
import { useLaunches } from "@/hooks/useLaunches";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import type { Contract } from "@/types";

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";

export function ContractMatrixTab() {
  const contractsQ = useContracts();
  const launchesQ = useLaunches();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();

  const { states, newStates, payers, cellFor } = useMemo(() => {
    const contracts = contractsQ.data ?? [];
    const contractStates = new Set(contracts.map((c) => c.state).filter(Boolean));
    const launchStates = new Set((launchesQ.data ?? []).map((l) => l.state).filter(Boolean));
    const newStates = new Set([...launchStates].filter((s) => !contractStates.has(s)));
    const states = [...new Set([...contractStates, ...launchStates])].sort();

    const payers = (payersQ.data ?? []).filter((p) => p.name !== PRE_CRED_PAYER_NAME);
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));

    const byKey = new Map<string, Contract>();
    for (const c of contracts) {
      if (c.payerId) byKey.set(`${c.payerId}|${c.state}`, c);
    }

    const now = new Date();
    function cellFor(payerId: string, state: string) {
      const contract = byKey.get(`${payerId}|${state}`);
      if (!contract) return null;
      const status = contract.contractingStatusId
        ? (statusById.get(contract.contractingStatusId) ?? null)
        : null;
      const futureEff =
        contract.effectiveDate &&
        differenceInCalendarDays(parseISO(contract.effectiveDate), now) > 0
          ? format(parseISO(contract.effectiveDate), "MMM d, yyyy")
          : null;
      return { status, futureEff };
    }

    return { states, newStates, payers, cellFor };
  }, [contractsQ.data, launchesQ.data, payersQ.data, statusConfigsQ.data]);

  if (contractsQ.isLoading || payersQ.isLoading) {
    return <div className="h-40 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />;
  }

  return (
    <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-x-auto">
      <table className="w-full text-[length:var(--mp-text-sm)]">
        <thead>
          <tr className="border-b border-mp-border bg-mp-muted/60">
            <th className="px-4 py-2.5 text-left text-[length:var(--mp-text-xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
              Payer
            </th>
            {states.map((s) => (
              <th
                key={s}
                className="px-4 py-2.5 text-left text-[length:var(--mp-text-xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)] whitespace-nowrap"
              >
                {s}
                {newStates.has(s) ? (
                  <span className="ml-1.5 normal-case tracking-normal">
                    <StatusPill label="New" color="var(--mp-warn)" />
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payers.map((p) => (
            <tr key={p.id} className="border-b border-mp-border/60 last:border-0">
              <td className="px-4 py-2.5 font-medium text-[color:var(--mp-ink)] whitespace-nowrap">
                {p.name}
              </td>
              {states.map((s) => {
                const cell = cellFor(p.id, s);
                return (
                  <td key={s} className="px-4 py-2.5 whitespace-nowrap">
                    {cell ? (
                      <span className="flex items-center gap-1.5">
                        {cell.status ? (
                          <StatusPill label={cell.status.label} color={cell.status.color} />
                        ) : (
                          <span className="text-[color:var(--mp-ink-faint)]">No status</span>
                        )}
                        {cell.futureEff ? (
                          <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
                            Eff {cell.futureEff}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-[color:var(--mp-ink-faint)]">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
