// E6.0 — THE status pill: one canonical tone per unified case status,
// rendered through the shared StatusPill tone map (fixed tint + ink pairs,
// 4px borderless — no new pill primitive). Every surface that shows a case
// status renders this component so the same status always looks the same.
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { caseStatusLabel, type CaseStatus } from "@/lib/caseStatus";

const CASE_STATUS_TONE: Record<CaseStatus, StatusColor> = {
  not_started: "gray",
  in_progress: "blue",
  submitted: "teal",
  in_review: "teal",
  action_required: "amber",
  approved: "green",
  denied: "red",
  not_pursuing: "neutral",
};

export function caseStatusTone(status: CaseStatus): StatusColor {
  return CASE_STATUS_TONE[status];
}

export function CaseStatusPill({
  status,
  className,
}: {
  status: CaseStatus;
  className?: string;
}) {
  return (
    <StatusPill
      status={CASE_STATUS_TONE[status]}
      label={caseStatusLabel(status)}
      className={className}
    />
  );
}
