// Billing readiness pill. A Hold or Do Not Bill pill explains itself on hover
// or keyboard focus (Oct 20 review: a bare "Do Not Bill" next to an approved
// enrollment read as a bug). Render inside a TooltipProvider.
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BillingReadinessStatus, BillingReason } from "@/lib/billingReadiness";

const READINESS_TONE: Record<BillingReadinessStatus, StatusColor> = {
  ready: "green",
  hold: "amber",
  stop: "red",
};

export function ReadinessPill({
  status,
  label,
  reasons,
}: {
  status: BillingReadinessStatus;
  label: string;
  reasons: BillingReason[];
}) {
  const pill = <StatusPill status={READINESS_TONE[status]} label={label} />;
  if (reasons.length === 0) return pill;
  const ordered = [
    ...reasons.filter((reason) => reason.severity === "stop"),
    ...reasons.filter((reason) => reason.severity === "hold"),
  ];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label}. ${ordered.map((reason) => reason.label).join(" ")}`}
          className="rounded-[4px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {pill}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs">
        <ul className="space-y-1">
          {ordered.map((reason) => (
            <li key={`${reason.severity}:${reason.label}`}>{reason.label}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
