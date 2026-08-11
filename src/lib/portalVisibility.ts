// 3M Slice 6 / D6.4 (audit finding F24) — which GLOBAL portal registry rows
// are real, workable forms.
//
// The global tier is a shared library every org inherits, and it accumulates
// rows that are not forms anyone should be offered: a portal registered
// before its payer existed (payer_id null — nothing can ever join it to a
// SOP step, a case, or a fill), and portals whose payer has since been
// retired, merged into a successor, or archived out of the network. Left
// unfiltered they surface as GHOSTS: Train lists forms nobody can act on, and
// Work-case recognition can match a page to a portal whose payer is gone.
//
// The rule is one predicate, applied wherever a global portal is listed
// (listSharedPortals for Train, the global leg of listPortalsForApi for Work,
// and browser listPortals for panel pickers), so API and webapp can never
// disagree about what exists.
//
// It FAILS CLOSED on purpose: an absent or unreadable payer embed reads as
// "not listable" rather than "assume fine". A ghost that stays hidden costs a
// re-register; a ghost that shows up costs a trainer real work on a form that
// can never be used.
//
// merged_into_id is checked even though a merged payer also carries
// status = 'merged' (merge_payer sets both). The pair is cheap, and a row
// that ever ends up half-marked should drop out, not leak through.

/** The payer facts that decide a global portal's listability. */
export interface PortalPayerFacts {
  status?: string | null;
  archivedAt?: string | null;
  mergedIntoId?: string | null;
}

export interface SharedPortalCandidate {
  payerId?: string | null;
  payer?: PortalPayerFacts | null;
}

/**
 * True when a GLOBAL portal row points at a live catalog payer. Own-org rows
 * are NOT subject to this — an org's private registry is its own business,
 * and this slice does not change what an org sees of its own rows.
 */
export function isListableSharedPortal(row: SharedPortalCandidate): boolean {
  if (!row.payerId) return false;
  const payer = row.payer;
  if (!payer) return false;
  return payer.status === "active" && !payer.archivedAt && !payer.mergedIntoId;
}

/**
 * The Work registry's rule: keep every own-org row untouched, and hold global
 * rows to the shared-tier predicate above. `orgId` null IS the global tier
 * (the E6.5 shape).
 *
 * SERVICE-ROLE READS ONLY. This runs on `listPortalsForApi`/`listSharedPortals`,
 * where the service key sees every payer, so a missing embed really does mean
 * "this portal has no live payer". Browser reads must use
 * `isListableBrowserPortal` — see the note there.
 */
export function isListableRegistryPortal(
  row: SharedPortalCandidate & { orgId?: string | null },
): boolean {
  return row.orgId != null || isListableSharedPortal(row);
}

/**
 * The BROWSER tier's rule. Same intent as `isListableRegistryPortal`, but it
 * FAILS OPEN on an unreadable payer instead of closed.
 *
 * Under RLS, `payers_select` only exposes a global payer to an org that holds
 * an `org_payer_assignments` row for it. So a null `payers` embed is ambiguous
 * in the browser: it means EITHER the payer is gone OR the org simply has not
 * adopted it yet. Failing closed there deleted healthy portals from every
 * `usePortals()` consumer — measured on production, Kansas Fitness Physio lost
 * 4 of its 5 global portals, none of which were ghosts.
 *
 * What the browser can still prove off the row itself is `payer_id IS NULL` —
 * a portal attached to no payer at all — so that is the only global row it
 * drops. Lifecycle ghosts (retired/merged/archived payers) are filtered on the
 * service-role paths, which can actually see the payer to judge it; when the
 * org HAS adopted the payer the embed resolves and the full check applies here
 * too.
 */
export function isListableBrowserPortal(
  row: SharedPortalCandidate & { orgId?: string | null },
): boolean {
  if (row.orgId != null) return true; // own-org rows are the org's own business
  if (!row.payerId) return false; // provably attached to no payer
  if (!row.payer) return true; // unreadable under RLS — not evidence of a ghost
  return isListableSharedPortal(row);
}
