// E4.0 F4.0.1 / TE-7 — the payer-pipeline state badge. Reuses the shared
// StatusPill (no new primitive) with a status-semantic tone, kept VISUALLY
// DISTINCT from the internal credentialing status pill everywhere a case
// appears (case detail, list, queue) — the two are never merged into one label.
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { pipelineLabel, type PayerPipelineState } from "@/lib/payerPipeline";

const PIPELINE_TONE: Record<PayerPipelineState, StatusColor> = {
  not_started: "gray",
  assigned: "blue",
  drafting: "blue",
  submitted: "teal",
  in_review: "teal",
  action_required: "amber",
  approved: "green",
  denied: "red",
  oon: "neutral",
};

export function payerPipelineTone(state: PayerPipelineState): StatusColor {
  return PIPELINE_TONE[state];
}

export function PayerPipelineBadge({
  state,
  className,
}: {
  state: PayerPipelineState;
  className?: string;
}) {
  return (
    <StatusPill status={PIPELINE_TONE[state]} label={pipelineLabel(state)} className={className} />
  );
}
