// E4.2 F4.2.5 / TE-7 — admin-facing labels + persistence shape for the
// org-level next-best-action queue ranking config. The key union, the config
// TYPE, the validator, and the shipped default all live in one place —
// `src/lib/nextBestActions.ts` — and are re-exported/imported from there; this
// module only adds the human labels for the settings picker and the storage
// serializer, so there is exactly one source of truth for the keys.

import {
  QUEUE_RANKING_GROUPS,
  resolveQueueRankingConfig,
  type QueueRankingConfig,
  type QueueRankingGroup,
} from "./nextBestActions";

export { QUEUE_RANKING_GROUPS, resolveQueueRankingConfig };
export type { QueueRankingConfig, QueueRankingGroup };

export const QUEUE_RANKING_GROUP_LABELS: Record<QueueRankingGroup, string> = {
  follow_up: "Overdue follow-ups",
  task_due: "Task due dates",
  provider_start: "Provider start dates",
  launch_date: "Location launch dates",
};

export const QUEUE_RANKING_GROUP_HINTS: Record<QueueRankingGroup, string> = {
  follow_up: "Arrived/overdue follow-ups and SOP-cadence touch deadlines.",
  task_due: "The earliest open task due date on the case.",
  provider_start: "How soon the provider starts.",
  launch_date: "How soon the case's location goes live.",
};

/** The shipped default order, made explicit for the settings UI's initial
 * state and the "Reset to default" preview. Mirrors the comparator inside
 * `buildNextBestActions` (E6.1 F6.1.3 default tiers: arrived follow-ups →
 * task due dates → provider start dates → launch dates/the rest by date). */
export const DEFAULT_QUEUE_RANKING_ORDER: QueueRankingGroup[] = [
  "follow_up",
  "task_due",
  "provider_start",
  "launch_date",
];

/** The persisted jsonb shape for `next_best_action_configs.ranking`. */
export interface QueueRankingRow {
  order: QueueRankingGroup[];
}

/** Serialize an admin-chosen order (enabled groups, in priority order) into the
 * stored row. Throws if the order fails validation, so a bad config can never
 * be written (it would silently fall back to default on read otherwise). */
export function buildQueueRankingRow(order: readonly QueueRankingGroup[]): QueueRankingRow {
  const candidate: QueueRankingRow = { order: [...order] };
  if (!resolveQueueRankingConfig(candidate)) {
    throw new Error("Invalid queue ranking configuration");
  }
  return candidate;
}

/** True when a resolved config equals the shipped default order exactly (used
 * to show whether the org is on the default or a custom order). */
export function isDefaultOrder(order: readonly QueueRankingGroup[]): boolean {
  return (
    order.length === DEFAULT_QUEUE_RANKING_ORDER.length &&
    order.every((g, i) => g === DEFAULT_QUEUE_RANKING_ORDER[i])
  );
}

/** Move a group up (delta -1) or down (delta +1) within the order, clamped —
 * the keyboard-accessible reorder primitive (TE-10, no drag dependency). */
export function moveGroup(
  order: readonly QueueRankingGroup[],
  index: number,
  delta: -1 | 1,
): QueueRankingGroup[] {
  const next = [...order];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next;
  }
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
