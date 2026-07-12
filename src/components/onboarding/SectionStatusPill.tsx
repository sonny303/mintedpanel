// Derived-status chip for wizard scope sections (E1.0 TE-7): the conformed
// StatusPill treatment — fixed tint/ink pairs, 4px radius, text label always
// visible so color is never the sole signal. Preview sections show the
// authored "Coming next" label and never participate in completion (TE-3).
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import type { OnboardingSectionStatus } from "@/lib/onboardingProgress";

const STATUS_PILL: Record<OnboardingSectionStatus, { color: StatusColor; label: string }> = {
  not_started: { color: "neutral", label: "Not started" },
  in_progress: { color: "amber", label: "In progress" },
  complete: { color: "green", label: "Complete" },
};

export function SectionStatusPill({ status }: { status: OnboardingSectionStatus }) {
  const pill = STATUS_PILL[status];
  return <StatusPill status={pill.color} label={pill.label} />;
}

export function ComingNextPill() {
  return <StatusPill status="neutral" label="Coming next" />;
}
