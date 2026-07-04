// Fixed launch-status palette (M4). These are enum values, not status_configs
// rows, so their hues come from the token sheet — never hardcoded hex.
import type { LaunchStatus } from "@/types";

export const LAUNCH_STATUS_META: Record<LaunchStatus, { label: string; color: string }> = {
  prospect: { label: "Prospect", color: "var(--mp-neutral)" },
  interviewing: { label: "Interviewing", color: "var(--mp-info)" },
  planned: { label: "Planned", color: "var(--mp-pending)" },
  pending_fulfillment: { label: "Pending Fulfillment", color: "var(--mp-warn)" },
  ready_for_launch: { label: "Ready for Launch", color: "var(--mp-ok)" },
  live: { label: "Live", color: "var(--mp-ok)" },
  cancelled: { label: "Cancelled", color: "var(--mp-danger)" },
};
