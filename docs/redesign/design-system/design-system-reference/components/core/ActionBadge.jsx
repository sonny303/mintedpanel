import React from "react";
import { Badge } from "./Badge.jsx";

/**
 * Derived, one-per-case action state. Same tint system as Badge, but always
 * carries a leading dot so it reads as "what to do" rather than "what status".
 */
const ACTION_STATES = {
  needs:    { label: "Needs action",           tone: "overdue" },
  blocked:  { label: "Blocked",                tone: "pending" },
  stalled:  { label: "Stalled",                tone: "idle" },
  ontrack:  { label: "On track",               tone: "submitted" },
  awaiting: { label: "Awaiting effective date", tone: "review" },
};

/**
 * ActionBadge — the derived action state for a case or provider.
 * Pass a `state` key; the label and tone are set for you. `children`
 * overrides the default label if you need custom copy.
 */
export function ActionBadge({ state = "stalled", children, ...rest }) {
  const s = ACTION_STATES[state] || ACTION_STATES.stalled;
  return (
    <Badge tone={s.tone} dot {...rest}>
      {children || s.label}
    </Badge>
  );
}

export const ACTION_STATE_KEYS = Object.keys(ACTION_STATES);
