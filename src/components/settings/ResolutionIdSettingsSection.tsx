// E4.2 unified payer setup — the Organization settings tab's resolution-ID
// panel: what the E4.0 approval step will call each payer's payer-issued
// enrollment identifier, and which tier that label comes from (org setting →
// Minted default → generic). Writes go through the e4-2c
// PayerResolutionIdDialog onto org_payer_settings (the org × payer grain) —
// NEVER the Minted-managed payers row. Per the PM scope decision this tab
// carries payer-relevant org settings only.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { usePayers } from "@/hooks/useAdmin";
import { useOrgPayerAssignments } from "@/hooks/useOrgPayerAssignments";
import { useOrgPayerSettings } from "@/hooks/useOrgPayerSettings";
import { useIsAdmin } from "@/lib/permissions";
import { activeOrgPayers, resolutionIdSource, type ResolutionIdSource } from "@/lib/payerSetup";
import { resolveIdentifierConfig } from "@/lib/payerResolutionIdentifier";
import { PayerResolutionIdDialog } from "@/components/settings/PayerResolutionIdDialog";
import type { Payer } from "@/types";

const SOURCE_LABEL: Record<ResolutionIdSource, string> = {
  org: "Organization setting",
  minted: "Minted default",
  generic: "Generic fallback",
};

function SourcePill({ source }: { source: ResolutionIdSource }) {
  return (
    <StatusPill status={source === "generic" ? "amber" : "neutral"} label={SOURCE_LABEL[source]} />
  );
}

export function ResolutionIdSettingsSection() {
  const isAdmin = useIsAdmin();
  const payersQ = usePayers();
  const assignmentsQ = useOrgPayerAssignments();
  const settingsQ = useOrgPayerSettings();
  const [configuring, setConfiguring] = useState<Payer | null>(null);

  const settingByPayer = useMemo(
    () => new Map((settingsQ.data ?? []).map((s) => [s.payerId, s])),
    [settingsQ.data],
  );
  const rows = useMemo(
    () => activeOrgPayers(payersQ.data ?? [], assignmentsQ.data ?? []),
    [payersQ.data, assignmentsQ.data],
  );

  if (payersQ.data === undefined || assignmentsQ.data === undefined || settingsQ.isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        message="No payers to configure yet."
        description="Resolution identifiers become configurable once a payer is added from the Catalog tab."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-[#E8E5E0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#E8E5E0] bg-[#FAFAF9]">
                {["Payer", "Identifier label", "Source", "Expected at approval", ""].map((h, i) => (
                  <th
                    key={i}
                    className="h-10 whitespace-nowrap px-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ payer }) => {
                const setting = settingByPayer.get(payer.id) ?? null;
                const config = resolveIdentifierConfig(payer, setting);
                return (
                  <tr key={payer.id} className="border-b border-[#E8E5E0] last:border-0">
                    <td className="h-10 px-3 align-middle font-medium">{payer.name}</td>
                    <td className="h-10 px-3 align-middle">{config.individualLabel}</td>
                    <td className="h-10 px-3 align-middle">
                      <SourcePill source={resolutionIdSource(payer, setting)} />
                    </td>
                    <td className="h-10 px-3 align-middle text-muted-foreground">
                      {config.expected ? "Yes" : "No"}
                    </td>
                    <td className="h-10 px-3 align-middle text-right">
                      {isAdmin ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setConfiguring(payer)}
                        >
                          Configure ID
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {configuring ? (
        <PayerResolutionIdDialog
          payer={configuring}
          setting={settingByPayer.get(configuring.id) ?? null}
          onClose={() => setConfiguring(null)}
        />
      ) : null}
    </div>
  );
}
