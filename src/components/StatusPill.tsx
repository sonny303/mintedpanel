// StatusPill renders a small colored pill for status labels.
// Also exports hexToStatusColor to map DB hex colors to the pill's semantic color name.
// E0.9 design-system conformance: 4px radius, fixed tint + darker ink token
// pairs, no border (the DS status Badge contract).
import React from "react";

export type StatusColor =
  | "gray"
  | "blue"
  | "amber"
  | "red"
  | "teal"
  | "green"
  // Semantic one-off tones consolidated from feature surfaces:
  | "neutral" // warm gray (admin Inactive/No/Billing pills)
  | "brand" // primary-green tint (Admin role badge)
  | "violet"; // audit TOUCH_LOGGED

export interface StatusPillProps {
  status: StatusColor;
  label: string;
  className?: string;
}

export function hexToStatusColor(hex: string | null | undefined): StatusColor {
  switch ((hex ?? "").toUpperCase()) {
    case "#2563EB":
      return "blue";
    case "#D97706":
      return "amber";
    case "#DC2626":
    case "#991B1B":
      return "red";
    case "#0891B2":
      return "teal";
    case "#059669":
      return "green";
    default:
      return "gray";
  }
}

// DS tint + ink pairs from tokens.css — background is the *-tint, text is the
// darker *-ink (never the raw status hue), borderless.
export const statusToneClasses: Record<StatusColor, string> = {
  gray: "bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]",
  blue: "bg-[var(--mp-info-tint)] text-[var(--mp-info-ink)]",
  amber: "bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]",
  red: "bg-[var(--mp-danger-tint)] text-[var(--mp-danger-ink)]",
  teal: "bg-[var(--mp-pending-tint)] text-[var(--mp-pending-ink)]",
  green: "bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]",
  neutral: "bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]",
  brand: "bg-[var(--mp-brand-tint)] text-[var(--mp-brand-ink)]",
  violet: "bg-[var(--mp-violet-tint)] text-[var(--mp-violet-ink)]",
};

export const StatusPill = ({ status, label, className = "" }: StatusPillProps) => {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-[4px] text-[12px] font-medium ${statusToneClasses[status]} ${className}`}
    >
      {label}
    </span>
  );
};
