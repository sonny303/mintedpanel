// Triage ActionBadge (M1): worst-state rollup badge, dot + text.
export type ActionBadgeTone = "ok" | "info" | "warn" | "danger" | "pending" | "neutral";

interface ActionBadgeProps {
  text: string;
  tone: ActionBadgeTone;
}

export function ActionBadge({ text, tone }: ActionBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[var(--mp-radius-pill)] px-2 py-0.5 text-[length:var(--mp-text-xs)] font-medium leading-4 whitespace-nowrap"
      style={{
        color: `var(--mp-${tone})`,
        backgroundColor: `var(--mp-${tone}-tint)`,
      }}
    >
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: `var(--mp-${tone})` }}
      />
      {text}
    </span>
  );
}
