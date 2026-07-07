// Code-owned canonical status sets (Epic 6 finale, P11). The per-org
// `status_configs` rows are seeded from this exact set: the `create_organization`
// RPC (`supabase/migrations/20260707140000_create_organization_rpc.sql`) writes
// the same 22 rows in SQL, and this module mirrors them in TypeScript so the app
// has a single, typed reference for what the canonical labels/colors/buckets are.
// The RPC is SQL and cannot import this module, so the two are kept consistent by
// hand — if you change one, change the other (the values are asserted well-formed
// in `canonicalStatuses.test.ts`).
//
// Both live demo orgs (Kansas Fitness Physio, South Park Physician Group) already
// carry exactly this set across all three tracks — there is ZERO divergence — so
// this ships as a code-owned reference + a compat shim, NOT a relabel migration.
import type { StatusTrack } from "@/types";
import {
  APPROVED_LABEL,
  CONTRACTED_LABEL,
  DENIED_LABEL,
  IN_NETWORK_LABEL,
  IN_PROGRESS_LABEL,
  INACTIVE_LABEL,
  INTERVIEWING_LABEL,
  LIVE_LABEL,
  NOT_REQUIRED_LABEL,
  NOT_STARTED_LABEL,
  OON_LABEL,
  PENDING_FULFILLMENT_LABEL,
  PLANNED_LABEL,
  PROSPECT_LABEL,
  READY_FOR_LAUNCH_LABEL,
  SUBMITTED_LABEL,
  WAITING_ON_PROVIDER_LABEL,
} from "./statusLabels";

/** The `status_configs.action_bucket` closed set that drives the action engine. */
export type ActionBucket = "ours" | "waiting_payer" | "waiting_provider" | "complete";

export const ACTION_BUCKETS: readonly ActionBucket[] = [
  "ours",
  "waiting_payer",
  "waiting_provider",
  "complete",
];

export interface CanonicalStatus {
  track: StatusTrack;
  label: string;
  /** hex, matching `status_configs.color` */
  color: string;
  sortOrder: number;
  actionBucket: ActionBucket;
}

/**
 * The canonical status set per track. Copied verbatim from the live demo orgs
 * and the `create_organization` seed. Order within a track is ascending by
 * `sortOrder`.
 */
export const CANONICAL_STATUSES: Record<StatusTrack, readonly CanonicalStatus[]> = {
  credentialing: [
    {
      track: "credentialing",
      label: NOT_STARTED_LABEL,
      color: "#9CA3AF",
      sortOrder: 5,
      actionBucket: "ours",
    },
    {
      track: "credentialing",
      label: IN_NETWORK_LABEL,
      color: "#059669",
      sortOrder: 10,
      actionBucket: "complete",
    },
    {
      track: "credentialing",
      label: OON_LABEL,
      color: "#DC2626",
      sortOrder: 20,
      actionBucket: "complete",
    },
    {
      track: "credentialing",
      label: IN_PROGRESS_LABEL,
      color: "#2563EB",
      sortOrder: 30,
      actionBucket: "ours",
    },
    {
      track: "credentialing",
      label: WAITING_ON_PROVIDER_LABEL,
      color: "#D97706",
      sortOrder: 31,
      actionBucket: "waiting_provider",
    },
    {
      track: "credentialing",
      label: SUBMITTED_LABEL,
      color: "#0891B2",
      sortOrder: 32,
      actionBucket: "waiting_payer",
    },
    {
      track: "credentialing",
      label: APPROVED_LABEL,
      color: "#059669",
      sortOrder: 35,
      actionBucket: "complete",
    },
    {
      track: "credentialing",
      label: DENIED_LABEL,
      color: "#DC2626",
      sortOrder: 40,
      actionBucket: "ours",
    },
    {
      track: "credentialing",
      label: NOT_REQUIRED_LABEL,
      color: "#9CA3AF",
      sortOrder: 45,
      actionBucket: "complete",
    },
  ],
  contracting: [
    {
      track: "contracting",
      label: NOT_STARTED_LABEL,
      color: "#9CA3AF",
      sortOrder: 10,
      actionBucket: "ours",
    },
    {
      track: "contracting",
      label: IN_PROGRESS_LABEL,
      color: "#2563EB",
      sortOrder: 20,
      actionBucket: "ours",
    },
    {
      track: "contracting",
      label: DENIED_LABEL,
      color: "#DC2626",
      sortOrder: 30,
      actionBucket: "ours",
    },
    {
      track: "contracting",
      label: CONTRACTED_LABEL,
      color: "#0891B2",
      sortOrder: 40,
      actionBucket: "waiting_payer",
    },
    {
      track: "contracting",
      label: IN_NETWORK_LABEL,
      color: "#059669",
      sortOrder: 50,
      actionBucket: "complete",
    },
    {
      track: "contracting",
      label: OON_LABEL,
      color: "#DC2626",
      sortOrder: 60,
      actionBucket: "complete",
    },
  ],
  location: [
    {
      track: "location",
      label: PROSPECT_LABEL,
      color: "#9CA3AF",
      sortOrder: 10,
      actionBucket: "ours",
    },
    {
      track: "location",
      label: PLANNED_LABEL,
      color: "#2563EB",
      sortOrder: 20,
      actionBucket: "ours",
    },
    {
      track: "location",
      label: INTERVIEWING_LABEL,
      color: "#0891B2",
      sortOrder: 30,
      actionBucket: "ours",
    },
    {
      track: "location",
      label: PENDING_FULFILLMENT_LABEL,
      color: "#D97706",
      sortOrder: 40,
      actionBucket: "ours",
    },
    {
      track: "location",
      label: READY_FOR_LAUNCH_LABEL,
      color: "#059669",
      sortOrder: 50,
      actionBucket: "ours",
    },
    {
      track: "location",
      label: LIVE_LABEL,
      color: "#059669",
      sortOrder: 60,
      actionBucket: "complete",
    },
    {
      track: "location",
      label: INACTIVE_LABEL,
      color: "#9CA3AF",
      sortOrder: 70,
      actionBucket: "complete",
    },
  ],
};

/** All 22 canonical rows across the three tracks, flat. */
export const ALL_CANONICAL_STATUSES: readonly CanonicalStatus[] = [
  ...CANONICAL_STATUSES.credentialing,
  ...CANONICAL_STATUSES.contracting,
  ...CANONICAL_STATUSES.location,
];

/**
 * Maps a divergent live-org status label → its canonical equivalent, so
 * by-label matching (`canonicalLabel(label) === SOME_CONSTANT`) still classifies
 * an org that shipped a non-canonical label.
 *
 * EMPTY by design: both live demo orgs already use the canonical labels above,
 * so there is nothing to reconcile today. This is the single place to add an
 * entry if a future/imported org diverges — e.g. `{ "In Network": IN_NETWORK_LABEL }`
 * for an org whose label drops the hyphen. Adding a key is a no-migration,
 * code-only reconciliation. Mappings must be single-hop (a canonical label is
 * never itself a key) so `canonicalLabel` stays idempotent.
 */
export const STATUS_LABEL_COMPAT: Record<string, string> = {};

/**
 * Normalizes a raw status label to its canonical form via `STATUS_LABEL_COMPAT`.
 * Identity for any canonical label and any label without a compat entry — so it
 * is a no-op today (the map is empty) and safe to route every by-label match
 * through. The point is future-proofing: the day an org ships a divergent label,
 * one `STATUS_LABEL_COMPAT` entry fixes matching everywhere at once.
 */
export function canonicalLabel(label: string): string {
  return STATUS_LABEL_COMPAT[label] ?? label;
}
