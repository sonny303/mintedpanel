// Slice F (payer-and-cases screen 4) — the Template Editor's five inline
// online-form modes (register / capture / map / repair / prove) and the derived
// context banner a readiness CTA deep-links into (?intent=). The banner
// describes a CONDITION, so it is derived from the live state of the
// template's first online-form step — it disappears the moment the work the
// intent points at is done. Nothing here is stored; the intent only rides the
// URL and the banner re-derives on every render.
export const TEMPLATE_EDITOR_INTENTS = ["register", "capture", "train", "repair", "prove"] as const;

export type TemplateEditorIntent = (typeof TEMPLATE_EDITOR_INTENTS)[number];

export function parseTemplateEditorIntent(value: unknown): TemplateEditorIntent | null {
  return typeof value === "string" && (TEMPLATE_EDITOR_INTENTS as readonly string[]).includes(value)
    ? (value as TemplateEditorIntent)
    : null;
}

export interface IntentBanner {
  title: string;
  body: string;
}

export const INTENT_BANNERS: Record<TemplateEditorIntent, IntentBanner> = {
  register: {
    title: "Register the portal this step fills",
    body: "This step fills an online form, but no portal is linked yet.",
  },
  capture: {
    title: "Waiting on field capture",
    body: "The portal is registered, but no fields have been captured from it yet.",
  },
  train: {
    title: "Map the captured fields",
    body: "Decide what fills each captured field, then check coverage.",
  },
  repair: {
    title: "Repair broken mappings",
    body: "The portal changed and some fields no longer match. Re-map them, then re-check coverage.",
  },
  prove: {
    title: "Check field coverage",
    body: "Every captured field is mapped. Prove the form in the Workbench Train forms tab (mock dry run, then Mark proven).",
  },
};

/** The live facts of the template's first online-form step, reduced to what the
 * banner derivation needs. All values come from the SAME org caches the step's
 * FormStepPanel reads (portals / portal_field_maps / drift) — never a second
 * source of truth. */
export interface IntentStepFacts {
  /** A registered portal matches the step's normalized portal key. */
  hasPortal: boolean;
  /** Non-retired captured field maps for that portal key. */
  fieldCount: number;
  /** Broken (drifted) mappings for that portal key. */
  brokenCount: number;
  /** The portal carries a proven_at stamp (manual Mark proven after a dry run). */
  proven: boolean;
}

/** Does the deep-linked intent still describe real outstanding work? Mirrors
 * the design's derivation exactly: register → no portal; capture → portal but
 * zero captured fields; repair → any broken mapping; train/prove → captured
 * fields exist and the form is not yet proven. */
export function intentStillApplies(intent: TemplateEditorIntent, facts: IntentStepFacts): boolean {
  switch (intent) {
    case "register":
      return !facts.hasPortal;
    case "capture":
      return facts.hasPortal && facts.fieldCount === 0;
    case "repair":
      return facts.brokenCount > 0;
    case "train":
    case "prove":
      return facts.hasPortal && facts.fieldCount > 0 && !facts.proven;
  }
}

/** The banner to render for a deep-linked intent, or null when there is no
 * intent, no online-form step to anchor it, or the work is already done. */
export function resolveIntentBanner(
  intent: TemplateEditorIntent | null,
  facts: IntentStepFacts | null,
): IntentBanner | null {
  if (!intent || !facts) return null;
  return intentStillApplies(intent, facts) ? INTENT_BANNERS[intent] : null;
}
