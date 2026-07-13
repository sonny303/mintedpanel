// Resolves SOP template task definitions into concrete task insert payloads,
// substituting {{tokens}} with values from the provider, group, facility,
// and optional MSO routing rule. Unknown tokens are left blank.

import type {
  Facility,
  Mso,
  Provider,
  ProviderGroup,
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

function buildTokenMap(ctx: ResolveContext): Record<string, string> {
  const { provider, group, facility, mso, stateLicenseNumber } = ctx;
  return {
    "provider.npi": provider.npi ?? "",
    "provider.caqhId": provider.caqhId ?? "",
    "provider.caqhLastAttestedDate": provider.caqhLastAttestedDate ?? "",
    "provider.taxonomyCode": provider.taxonomyCode ?? "",
    "provider.firstName": provider.firstName,
    "provider.lastName": provider.lastName,
    "provider.email": provider.email ?? "",
    "provider.licenseNumber": stateLicenseNumber ?? "",
    // E1.7b TE-7 catalog-name aliases: get_sop_field_tokens() advertises
    // schema-derived names; these map them onto values this context already
    // holds so authored catalog tokens resolve. Existing names above stay —
    // SOP bodies in the wild use them. Never rename the catalog side: catalog
    // token names are a live wire contract (portal_field_maps, view-prefs,
    // the extension's field-map ↔ profile join).
    "license.licenseNumber": stateLicenseNumber ?? "",
    "group.tin": group?.tin ?? "",
    "group.npiType2": group?.npiType2 ?? "",
    "group.name": group?.name ?? "",
    "facility.name": facility?.name ?? "",
    "facility.address": facility
      ? [facility.street, facility.city, facility.state, facility.zip].filter(Boolean).join(", ")
      : "",
    "facility.street": facility?.street ?? "",
    "facility.city": facility?.city ?? "",
    "facility.state": facility?.state ?? "",
    "facility.zip": facility?.zip ?? "",
    "mso.portalUrl": mso?.portalUrl ?? "",
  };
}

// The closed set of token keys this resolver can substitute, for the SOP
// authoring picker (E1.7b TE-7): the picker must advertise only tokens that
// resolve here — case-scoped catalog families (payer.*, mso.*, contract.*
// beyond the map below) are filtered out of `dataFields` at resolution and
// would be silently lost.
export function resolvableTokenKeys(): string[] {
  return Object.keys(
    buildTokenMap({
      provider: {} as Provider,
      group: null,
      facility: null,
      mso: null,
      stateLicenseNumber: null,
    }),
  );
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
    const emailTemplate: SOPEmailTemplate | undefined =
      stepType === "draft_email" && step.emailTemplate
        ? {
            subject: interpolate(step.emailTemplate.subject, tokens),
            body: interpolate(step.emailTemplate.body, tokens),
          }
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
