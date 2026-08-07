// Person-name shape for parties (decision D6, 2026-08-07).
//
// `parties.name` was a single text column and the intake form collected one
// "Full name", but payer forms ask for first and last in separate boxes. The
// split therefore happens at CAPTURE, where a human can correct it — a
// heuristic split at fill time is strictly worse, because nobody is watching.
//
// THE SPLIT RULE IS MIRRORED IN SQL by public._party_first_name /
// _party_last_name (migration 20260807130000). Keep the two in lockstep: the
// same last-space rule, the same trimming. The SQL side runs on the one-time
// backfill and inside the SECURITY DEFINER intake/capture functions; this side
// runs in the browser. A divergence would show up as a contact whose split name
// disagrees with its display name depending on which door it came through.

export interface PersonNameParts {
  firstName: string;
  lastName: string;
}

/**
 * Split a full name on its LAST whitespace run: everything before is the first
 * name (so middle names ride along), the final token is the last name. A
 * single-token name is all first name with an empty last name — never a guess,
 * and never an error: the form is what asks for the correction.
 */
export function splitFullName(full: string | null | undefined): PersonNameParts {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const match = /^(.*)\s+(\S+)$/.exec(trimmed);
  if (!match) return { firstName: trimmed, lastName: "" };
  return { firstName: match[1].trim(), lastName: match[2].trim() };
}

/**
 * The display value written to `parties.name`, which is RETAINED as the single
 * display column every legacy reader still uses. Composed from the parts so the
 * two can never drift: services call this on every party write.
 */
export function composeFullName(parts: {
  firstName?: string | null;
  lastName?: string | null;
}): string {
  return [parts.firstName ?? "", parts.lastName ?? ""]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Display name for a party row that may predate the split (first/last null).
 * Prefers the composed parts, falls back to the stored display name.
 */
export function personDisplayName(row: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
}): string {
  const composed = composeFullName(row);
  return composed || (row.name ?? "").trim();
}
