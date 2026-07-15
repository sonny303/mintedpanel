// E4.2 F4.2.7 / TE-17 — the ONE shared predicate for the designated test
// provider. The test provider is an ordinary `providers` row with
// `is_test_provider = true`; it exists only for dry-run form fills and must be
// excluded from EVERY work-facing derivation (queue, generation candidates,
// scorecard/reporting). Every surface calls this one predicate rather than
// re-checking the flag, so the exclusion can never drift between surfaces.

/** Anything carrying the (optional, camelCased) test-provider flag. */
export interface HasTestProviderFlag {
  isTestProvider?: boolean | null;
}

/** True when the provider is the org's designated test provider. */
export function isTestProvider(provider: HasTestProviderFlag): boolean {
  return provider.isTestProvider === true;
}

/** Drop test providers from a work-facing list (queue/generation/scorecard). */
export function excludeTestProviders<T extends HasTestProviderFlag>(providers: readonly T[]): T[] {
  return providers.filter((p) => !isTestProvider(p));
}
