// E6.2 F6.2.5 — pure helpers over enrollment facts. A fact is LIVE while
// `expiredAt` is null; expiry is a flip, never a delete, so history rows stay
// in every read and the live filter is applied here, in one place. Live facts
// count a payer row toward Active (via the E6.0 caseRollups derivations) and
// suppress generation candidates (src/lib/generationBuffer.ts); expired facts
// do neither, immediately, because everything downstream derives from this
// filter at render time.
import type { EnrollmentFact } from "@/types";
import type { EnrollmentFactRow } from "@/lib/caseRollups";

export function isLiveFact(fact: Pick<EnrollmentFact, "expiredAt">): boolean {
  return fact.expiredAt === null;
}

export function liveEnrollmentFacts<T extends Pick<EnrollmentFact, "expiredAt">>(
  facts: readonly T[],
): T[] {
  return facts.filter(isLiveFact);
}

/** The 4-part fact key — identical to the case key / preview row key grain. */
export function enrollmentFactKey(
  fact: Pick<EnrollmentFact, "providerId" | "groupId" | "payerId" | "state">,
): string {
  return `${fact.providerId}|${fact.groupId}|${fact.payerId}|${fact.state}`;
}

/** Live facts in the caseRollups input shape (groupPayerFulfillment's third
 * argument — the "Active = approved case OR enrollment fact" input). */
export function factRollupRows(facts: readonly EnrollmentFact[]): EnrollmentFactRow[] {
  return liveEnrollmentFacts(facts).map((f) => ({
    groupId: f.groupId,
    payerId: f.payerId,
    state: f.state,
  }));
}
