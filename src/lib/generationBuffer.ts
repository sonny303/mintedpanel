// E6.2 F6.2.3 / E6.3 F6.3.1 — the candidate buffer math, computed live and
// stored nowhere: candidates = the group's payer targets × eligible providers
// (the locked E2.0 candidacy: un-ended group membership + ≥1 facility
// assignment at a facility of the group) − enrollment facts − existing cases −
// standing exclusions. This module deliberately COMPOSES the locked
// buildGenerationPreview derivation (which already subtracts existing cases by
// the TE-6 two-branch rule and active exclusions) and adds the E6.2
// enrollment-facts subtraction — E6.3's grid consumes this same function, so
// the board's banner count always equals the generation candidate math by
// construction (F6.2.3 AC).
//
// The banner's "most recent cause" is DERIVED from the candidates' own
// timestamps — the newest of: the candidate provider's group-join date, the
// candidate target's attach date, and an expired fact's expiry at the exact
// candidate key. Never a stored flag. No clock reads — `today` rides the
// preview input.
import {
  buildGenerationPreview,
  previewRowKey,
  type GenerationPreviewInput,
  type GenerationPreviewRow,
} from "@/lib/generationPreview";

export interface BufferFactInput {
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  expiredAt: string | null;
}

/** The facts subtraction over already-derived preview rows (callers holding a
 * useGenerationPreview result apply it without re-deriving the preview). */
export function subtractLiveFacts(
  rows: readonly GenerationPreviewRow[],
  facts: readonly BufferFactInput[],
): GenerationPreviewRow[] {
  const liveFactKeys = new Set(
    facts
      .filter((f) => f.expiredAt === null)
      .map((f) => `${f.providerId}|${f.groupId}|${f.payerId}|${f.state}`),
  );
  return rows.filter(
    (row) => row.disposition === "proposed" && !liveFactKeys.has(previewRowKey(row)),
  );
}

/** Every proposed combination not covered by a LIVE enrollment fact. */
export function generationCandidates(
  input: GenerationPreviewInput,
  facts: readonly BufferFactInput[],
): GenerationPreviewRow[] {
  return subtractLiveFacts(buildGenerationPreview(input), facts);
}

/** One group's slice of the buffer (the board banner count). */
export function groupCandidates(
  candidates: readonly GenerationPreviewRow[],
  groupId: string,
): GenerationPreviewRow[] {
  return candidates.filter((row) => row.groupId === groupId);
}

// ---------------------------------------------------------------------------
// The banner's cause line ("5 candidates — Dr. Chen joined Sep 3").
// ---------------------------------------------------------------------------

export interface BufferCauseAssignment {
  providerId: string | null;
  groupId: string | null;
  /** Join date: startDate when recorded, else the row's createdAt. */
  startDate?: string | null;
  createdAt?: string | null;
}

export interface BufferCauseTarget {
  groupId: string;
  payerId: string;
  state: string;
  createdAt: string;
}

export interface BufferCauseInput {
  assignments: readonly BufferCauseAssignment[];
  targets: readonly BufferCauseTarget[];
  /** The full fact list — expiry timestamps ride the fact rows themselves. */
  facts: readonly BufferFactInput[];
}

export type BufferCauseKind = "provider_joined" | "payer_attached" | "fact_expired";

export interface BufferCause {
  kind: BufferCauseKind;
  /** Human line, date left to the caller's formatter ("Dr. Chen joined"). */
  label: string;
  /** ISO date or timestamp of the cause; null when no input carried one. */
  date: string | null;
}

/**
 * The most recent contributing change among the CURRENT candidates: the
 * newest of each candidate's provider-join date, its target's attach date,
 * and — where an expired fact sits at the exact key — that fact's expiry
 * (expiring re-opens the candidate, F6.2.5). Returns null when the buffer is
 * empty.
 */
export function bufferCause(
  candidates: readonly GenerationPreviewRow[],
  input: BufferCauseInput,
): BufferCause | null {
  if (candidates.length === 0) return null;

  const joinByProviderGroup = new Map<string, string>();
  for (const a of input.assignments) {
    if (!a.providerId || !a.groupId) continue;
    const date = a.startDate ?? a.createdAt ?? null;
    if (!date) continue;
    const key = `${a.providerId}|${a.groupId}`;
    const prior = joinByProviderGroup.get(key);
    if (!prior || date > prior) joinByProviderGroup.set(key, date);
  }
  const attachByTarget = new Map<string, string>();
  for (const t of input.targets) {
    attachByTarget.set(`${t.groupId}|${t.payerId}|${t.state}`, t.createdAt);
  }
  const expiryByKey = new Map<string, string>();
  for (const f of input.facts) {
    if (f.expiredAt === null) continue;
    const key = `${f.providerId}|${f.groupId}|${f.payerId}|${f.state}`;
    const prior = expiryByKey.get(key);
    if (!prior || f.expiredAt > prior) expiryByKey.set(key, f.expiredAt);
  }

  let best: BufferCause | null = null;
  const consider = (kind: BufferCauseKind, label: string, date: string | null) => {
    if (date === null) return;
    if (best === null || best.date === null || date > best.date) best = { kind, label, date };
  };

  for (const row of candidates) {
    consider(
      "provider_joined",
      `${row.providerName} joined`,
      joinByProviderGroup.get(`${row.providerId}|${row.groupId}`) ?? null,
    );
    consider(
      "payer_attached",
      `${row.payerName} attached`,
      attachByTarget.get(`${row.groupId}|${row.payerId}|${row.state}`) ?? null,
    );
    consider(
      "fact_expired",
      `${row.payerName} enrollment fact expired`,
      expiryByKey.get(previewRowKey(row)) ?? null,
    );
  }

  // A buffer with candidates but no dated inputs still explains itself.
  return best ?? { kind: "provider_joined", label: "Candidates awaiting review", date: null };
}
