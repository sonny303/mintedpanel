// Resolves SOP template task definitions into concrete task insert payloads,
// substituting {{tokens}} with values from the provider, group, facility,
// and optional MSO routing rule. Unknown tokens are left blank.

import {
  ENTITY_TOKEN_FAMILIES,
  buildEntityTokenValues,
  composeAddressToken,
} from "@/lib/entityTokens";
import type {
  Facility,
  Mso,
  Provider,
  ProviderGroup,
  ResolvedSOPEmailRecipient,
  ResolvedSOPEmailTemplate,
  SOPEmailRecipient,
  SOPEmailTemplate,
  SOPStep,
  SOPStepType,
  SOPTaskDefinition,
  SOPTemplate,
} from "@/types";

export interface ResolvedTaskInsert {
  title: string;
  description: string | null;
  sopContent: SOPStep[];
  sortOrder: number;
  dueDate: string | null;
}

interface ResolveContext {
  provider: Provider;
  group: ProviderGroup | null;
  facility: Facility | null;
  mso?: Mso | null;
  stateLicenseNumber?: string | null;
}

// Tokens no column sweep can produce: a composed value, or a value that lives
// on a row outside the entity the prefix names.
//
// E1.7b TE-7 catalog-name aliases: get_sop_field_tokens() advertises
// schema-derived names, and `license.licenseNumber` names the state_licenses row
// selected for the case's state — which this context carries as a bare string,
// not a row. `provider.licenseNumber` is the older resolver name for the same
// value and keeps working, since SOP bodies in the wild use it. Never rename the
// catalog side: catalog token names are a live wire contract (portal_field_maps,
// view-prefs, the extension's field-map ↔ profile join).
const COMPOSED_TOKENS = ["facility.address", "license.licenseNumber"] as const;

function buildTokenMap(ctx: ResolveContext): Record<string, string> {
  const { provider, group, facility, mso, stateLicenseNumber } = ctx;
  // Every populated column of the four entities in hand, keyed exactly as the
  // catalog names it — so a column added to `providers` is authorable and
  // resolvable with no edit here.
  const tokens = buildEntityTokenValues({ provider, group, facility, mso });

  const address = facility
    ? composeAddressToken([facility.street, facility.city, facility.state, facility.zip])
    : null;
  if (address) tokens["facility.address"] = address;

  // The state-specific license wins over the provider row's own column: the
  // case is filed in one state, and that is the number the payer wants.
  const licenseNumber = stateLicenseNumber?.trim() || provider.licenseNumber?.trim() || "";
  if (licenseNumber) {
    tokens["provider.licenseNumber"] = licenseNumber;
    tokens["license.licenseNumber"] = licenseNumber;
  }

  return tokens;
}

// Whether the SOP authoring picker may advertise a token (E1.7b TE-7): a
// `dataFields` entry this resolver cannot substitute is silently filtered at
// resolution, so authoring it loses the field.
//
// Family-based rather than key-based, because resolution is now a lookup on the
// entity: any column of providers/provider_groups/facilities/msos resolves, so
// the picker widens with the schema instead of waiting for someone to extend a
// map. Excluded families are the ones with NO row in hand at case creation —
// case-scoped payer.*/contract.*, the child-row assignment.*/groupInsurance.*,
// the org-contact families (fill-time only, D12), and user.*.
export function isResolvableToken(token: string): boolean {
  if ((COMPOSED_TOKENS as readonly string[]).includes(token)) return true;
  return ENTITY_TOKEN_FAMILIES.includes(token.split(".")[0]);
}

// E1.7b F1.7b.5 (TE-14) — the closed set of email-valued token keys a
// draft-email recipient may resolve. A STRICT SUBSET of what
// isResolvableToken() admits: that set advertises every substitutable token
// (provider.npi, facility.city, …), but only these carry an actual email
// address. Today that is
// `provider.email` alone — facility/group/mso and payer-contact tokens are
// deferred (AQ2, additive later once a resolver value exists), and `payer.*` has
// no resolver value at all and must NEVER be accepted as a recipient token. The
// authoring picker (TE-15) and the publish lint (TE-16) both read this as the
// single authority; keep it a subset of the map keys above.
export function emailValuedTokenKeys(): string[] {
  return ["provider.email"];
}

const TOKEN_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;

function interpolate(input: string, tokens: Record<string, string>): string {
  return input.replace(TOKEN_PATTERN, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : "",
  );
}

function offsetDate(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// E1.7b F1.7b.5 (TE-14) — resolve one authored recipient, preserving its source.
// A literal address is a fixed value, carried through VERBATIM (never
// interpolated — the portalKey precedent). A token recipient is looked up in the
// SAME token map as subject/body; an empty value (e.g. a provider with no email)
// resolves to `address: null` — an explicit unresolved recipient the case
// workflow renders as a fill-before-send gap (AQ1). It is never dropped and
// never auto-sent, and its `token` provenance is retained.
function resolveRecipient(
  recipient: SOPEmailRecipient,
  tokens: Record<string, string>,
): ResolvedSOPEmailRecipient {
  if (recipient.source === "literal") {
    return { source: "literal", address: recipient.address };
  }
  const raw = Object.prototype.hasOwnProperty.call(tokens, recipient.token)
    ? tokens[recipient.token]
    : "";
  return { source: "token", token: recipient.token, address: raw.trim() ? raw : null };
}

function resolveRecipients(
  list: SOPEmailRecipient[] | undefined,
  tokens: Record<string, string>,
): ResolvedSOPEmailRecipient[] | undefined {
  if (!list || list.length === 0) return undefined;
  return list.map((r) => resolveRecipient(r, tokens));
}

// Resolve the whole draft-email body: subject/body interpolated, recipients
// source-tagged (TE-14). Absent to/cc stay absent so a legacy version row (no
// recipients) resolves to the historical subject/body-only step unchanged.
function resolveEmailTemplate(
  authored: SOPEmailTemplate,
  tokens: Record<string, string>,
): ResolvedSOPEmailTemplate {
  const to = resolveRecipients(authored.to, tokens);
  const cc = resolveRecipients(authored.cc, tokens);
  return {
    subject: interpolate(authored.subject, tokens),
    body: interpolate(authored.body, tokens),
    ...(to ? { to } : {}),
    ...(cc ? { cc } : {}),
  };
}

function definitionToInsert(
  definition: SOPTaskDefinition,
  index: number,
  tokens: Record<string, string>,
  baseDateIso: string,
): ResolvedTaskInsert {
  const sortOrder = definition.sortOrder ?? index;
  const dueDate =
    typeof definition.dueOffsetDays === "number"
      ? offsetDate(baseDateIso, definition.dueOffsetDays)
      : null;
  const steps: SOPStep[] = definition.steps.map((step, idx) => {
    const stepType: SOPStepType = step.stepType ?? "online_form";
    const emailTemplate: ResolvedSOPEmailTemplate | undefined =
      stepType === "draft_email" && step.emailTemplate
        ? resolveEmailTemplate(step.emailTemplate, tokens)
        : undefined;
    return {
      id: `step-${idx}`,
      order: idx,
      label: interpolate(step.label, tokens),
      detail: step.detail ? interpolate(step.detail, tokens) : undefined,
      stepType,
      emailTemplate,
      // Carried through verbatim — a portal_key is an identifier, never
      // interpolated. The resolved task keeps the same portal link the template
      // authored, so the extension can close this task on submit.
      portalKey: step.portalKey,
      // E1.7b step-shape extension: carried through verbatim like portalKey
      // (numbers/names, never interpolated). Absent on pre-existing steps.
      expectedTurnaroundDays: step.expectedTurnaroundDays,
      followUpEveryDays: step.followUpEveryDays,
      requiredArtifacts: step.requiredArtifacts,
      isCompleted: false,
      completedAt: null,
      completedBy: null,
      dataFields: (step.dataFields ?? [])
        .map((f) => ({
          label: f.label,
          value: Object.prototype.hasOwnProperty.call(tokens, f.token) ? tokens[f.token] : "",
        }))
        .filter((f) => f.label && f.value),
    };
  });
  return {
    title: interpolate(definition.title, tokens),
    description: definition.description ? interpolate(definition.description, tokens) : null,
    sortOrder,
    dueDate,
    sopContent: steps,
  };
}

export function resolveTemplate(
  template: SOPTemplate,
  provider: Provider,
  group: ProviderGroup | null,
  facility: Facility | null,
  msoRule?: { mso?: Mso | null } | null,
  stateLicenseNumber?: string | null,
): ResolvedTaskInsert[] {
  const tokens = buildTokenMap({
    provider,
    group,
    facility,
    mso: msoRule?.mso ?? null,
    stateLicenseNumber: stateLicenseNumber ?? null,
  });
  const baseDateIso = new Date().toISOString();
  return template.taskDefinitions.map((def, idx) =>
    definitionToInsert(def, idx, tokens, baseDateIso),
  );
}
