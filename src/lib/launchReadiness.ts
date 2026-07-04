// M4: launch readiness, derived and never stored. One definition, used by the
// pipeline list and the launch detail alike: the share of the launch's
// providers' payer cases at In-Network (pre-cred excluded), plus a contract-gap
// flag when any active payer lacks a group contract in the launch's state.
export interface ReadinessCaseInput {
  /** status_configs.label for the case, if any */
  statusLabel: string | null;
  /** true when the case sits on the Pre-Credentialing Setup payer */
  isPreCred: boolean;
}

export interface ReadinessInput {
  /** cases belonging to providers linked to the launch (providers.launch_id) */
  cases: readonly ReadinessCaseInput[];
  /** ids of active payers for the org */
  activePayerIds: readonly string[];
  /** payer ids that have a group contract in the launch's state */
  contractedPayerIdsInState: ReadonlySet<string>;
}

export interface LaunchReadiness {
  inNetwork: number;
  denominator: number;
  /** 0..1, or null when the launch has no countable cases yet */
  share: number | null;
  /** true when any active payer lacks a group contract in the launch state */
  contractGap: boolean;
}

export function launchReadiness(input: ReadinessInput): LaunchReadiness {
  const countable = input.cases.filter((c) => !c.isPreCred);
  const inNetwork = countable.filter((c) => c.statusLabel === "In-Network").length;
  const denominator = countable.length;
  const contractGap = input.activePayerIds.some((id) => !input.contractedPayerIdsInState.has(id));
  return {
    inNetwork,
    denominator,
    share: denominator > 0 ? inNetwork / denominator : null,
    contractGap,
  };
}

/** NEW STATE: the group has zero contracts in the launch's state. */
export function isNewState(contractedPayerIdsInState: ReadonlySet<string>): boolean {
  return contractedPayerIdsInState.size === 0;
}
