// Read-only "in network" derivation for Payer Setup next-action cells.
// Uses the same payer_network_targets cache as usePayerNetworkTargets, but
// never filters the catalog list — Setup rows stay on catalogSetupPayers
// (see payerGovernance.test.ts). Group attach lives on Groups → Payer Network.
import { useMemo } from "react";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { networkPayerIdsFromTargets } from "@/lib/payerSetup";

export function useActiveNetworkPayerIds(): Set<string> {
  const targetsQ = usePayerNetworkTargets();
  return useMemo(() => networkPayerIdsFromTargets(targetsQ.data ?? []), [targetsQ.data]);
}
