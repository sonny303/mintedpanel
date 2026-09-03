// Unified "Next action" for Payer Setup list + Payer Detail banner (MP-5).
// Resolution order (first unmet wins): checklist unpublished → no portal →
// fields untrained → not proven → drift present → not attached to a group →
// ready. Email/paper payers (no online-form need) skip the form ladder and
// read "Ready — no online form" (or "Attach to a group" when not in network).
import type { FunnelFormSuggestion, FunnelRow } from "@/lib/payerReadinessFunnel";
import type { TemplateEditorIntent } from "@/lib/templateEditorIntent";
import { templateIntentForFormSuggestion } from "@/lib/payerDetailView";

export type PayerNextActionKind =
  | "author_template"
  | "register_portal"
  | "train_form"
  | "repair_drift"
  | "prove_form"
  | "attach_group"
  | "ready"
  | "ready_no_form";

export interface PayerNextAction {
  kind: PayerNextActionKind;
  /** Short cell / button label. */
  label: string;
  /** Longer banner body (Detail). */
  description: string;
  templateId: string | null;
  intent: TemplateEditorIntent | null;
  /** Detail tab to open when the action is portal-inventory scoped. */
  detailTab: "templates" | "portals" | "overview" | null;
}

const FORM_KIND: Record<FunnelFormSuggestion, PayerNextActionKind> = {
  register_portal: "register_portal",
  train_mappings: "train_form",
  repair_drift: "repair_drift",
  run_dry_test: "prove_form",
};

const FORM_LABEL: Record<FunnelFormSuggestion, string> = {
  register_portal: "Register portal",
  train_mappings: "Train form",
  repair_drift: "Repair drift",
  run_dry_test: "Prove in Workbench",
};

const FORM_DESCRIPTION: Record<FunnelFormSuggestion, string> = {
  register_portal: "Register the portal this checklist fills, then capture fields in Workbench.",
  train_mappings: "Map captured fields so Workbench can auto-fill.",
  repair_drift: "Repair broken field mappings, then re-prove in Workbench.",
  run_dry_test: "Run the mock dry run in Workbench, then Mark proven — proven is never automatic.",
};

/**
 * One next action for a payer. List cell and Detail banner must call the same
 * helper so they never disagree.
 */
export function resolvePayerNextAction(input: {
  funnel: FunnelRow | null;
  /** ≥1 active payer_network_targets row for this payer. */
  inNetwork: boolean;
  archived?: boolean;
}): PayerNextAction {
  const { funnel, inNetwork, archived } = input;
  if (archived) {
    return {
      kind: "ready",
      label: "Archived",
      description: "This payer is archived.",
      templateId: null,
      intent: null,
      detailTab: "overview",
    };
  }
  if (!funnel || !funnel.sopPublished) {
    return {
      kind: "author_template",
      label: "Add template",
      description: "Author and publish an enrollment checklist for this payer.",
      templateId: null,
      intent: null,
      detailTab: "templates",
    };
  }

  if (funnel.needsPortal && funnel.formSuggestion) {
    const suggestion = funnel.formSuggestion;
    return {
      kind: FORM_KIND[suggestion],
      label: FORM_LABEL[suggestion],
      description: FORM_DESCRIPTION[suggestion],
      templateId: funnel.sopTemplateId,
      intent: templateIntentForFormSuggestion(suggestion),
      detailTab: "templates",
    };
  }

  if (!inNetwork) {
    return {
      kind: "attach_group",
      label: "Attach to a group",
      description:
        "Catalog identity is set. Attach this payer on a group's Payer Network so cases can generate.",
      templateId: funnel.sopTemplateId,
      intent: null,
      detailTab: null,
    };
  }

  if (!funnel.needsPortal) {
    return {
      kind: "ready_no_form",
      label: "Ready — no online form",
      description: funnel.readyNote ?? "Published enrollment checklist — no portal required.",
      templateId: funnel.sopTemplateId,
      intent: null,
      detailTab: "templates",
    };
  }

  return {
    kind: "ready",
    label: "Ready",
    description: funnel.readyNote ?? "Published enrollment checklist — nothing blocking.",
    templateId: funnel.sopTemplateId,
    intent: null,
    detailTab: "templates",
  };
}
