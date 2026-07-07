// Fix-it queue derivation (Surface 1) — pure and unit-tested. Turns the org's
// providers, open cases, portals, field maps, and dictionary into an
// impact-ordered deck of 30-second decisions. Ordered by SOONEST BLOCKED FILL,
// never by ease.
import { FIXIT_FIELDS, hasProviderValue } from "@/lib/fixitFields";
import type { FieldDictionaryEntry, PortalFieldMap, Provider } from "@/types";

export type FixitCardKind = "provider_gap" | "dictionary_confirm" | "train_form";

export interface Coverage {
  filled: number;
  total: number;
  gain: number;
}

export interface FixitCard {
  id: string;
  kind: FixitCardKind;
  // Soonest blocked fill (ISO date) — the sort key; null sorts last.
  sortDate: string | null;
  fieldsUnlocked: number;
  gap?: {
    providerId: string;
    providerName: string;
    token: string;
    field: keyof typeof FIXIT_FIELDS;
    fieldLabel: string;
    payerName: string;
    caseId: string;
    portalKey: string;
    portalName: string;
    moreCount: number;
    coverage: Coverage;
  };
  dictionary?: { entryId: string; label: string; token: string; seenCount: number };
  train?: { portalKey: string; portalName: string; matched: number; total: number };
}

export interface OpenCaseLite {
  caseId: string;
  providerId: string;
  payerId: string;
  payerName: string;
  state: string;
  // Earliest open-task due date, else expected effective date, else null.
  nextDueDate: string | null;
}

export interface PortalLite {
  portalKey: string;
  name: string;
  payerId: string | null;
}

export interface BuildFixitInput {
  providers: Provider[];
  openCases: OpenCaseLite[];
  portals: PortalLite[];
  fieldMaps: PortalFieldMap[];
  dictionary: FieldDictionaryEntry[];
}

const FAR_FUTURE = "9999-12-31";

// A field map counts as auto-filling for a provider when it resolves to a value.
// v1 resolves the provider.* family against the provider row; other families are
// assumed resolved (out of scope) so coverage isn't understated. Manual rows
// never auto-fill and count out.
function isFilled(map: PortalFieldMap, provider: Provider): boolean {
  if (map.source === "manual" || map.source === "manual_partial") return false;
  if (map.source === "hardcoded") return true;
  if (map.token && map.token.startsWith("provider.")) return hasProviderValue(provider, map.token);
  return true;
}

export function coverageFor(
  provider: Provider,
  approvedMaps: PortalFieldMap[],
  gapToken?: string,
): Coverage {
  const total = approvedMaps.length;
  let filled = 0;
  let gain = 0;
  for (const m of approvedMaps) {
    if (isFilled(m, provider)) filled += 1;
    else if (gapToken && m.token === gapToken) gain += 1;
  }
  return { filled, total, gain };
}

function compareCards(a: FixitCard, b: FixitCard): number {
  const da = a.sortDate ?? FAR_FUTURE;
  const db = b.sortDate ?? FAR_FUTURE;
  if (da !== db) return da < db ? -1 : 1;
  if (a.fieldsUnlocked !== b.fieldsUnlocked) return b.fieldsUnlocked - a.fieldsUnlocked;
  return cardTitle(a).localeCompare(cardTitle(b));
}

function cardTitle(c: FixitCard): string {
  if (c.gap) return c.gap.providerName;
  if (c.dictionary) return c.dictionary.label;
  if (c.train) return c.train.portalName;
  return "";
}

function minDate(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a < b ? a : b;
}

export function buildFixitQueue(input: BuildFixitInput): FixitCard[] {
  const cards: FixitCard[] = [];

  const portalByPayer = new Map<string, PortalLite>();
  for (const p of input.portals) {
    if (p.payerId && !portalByPayer.has(p.payerId)) portalByPayer.set(p.payerId, p);
  }
  const portalByKey = new Map(input.portals.map((p) => [p.portalKey, p]));

  const approvedByKey = new Map<string, PortalFieldMap[]>();
  const proposedCountByKey = new Map<string, number>();
  for (const m of input.fieldMaps) {
    if (m.status === "approved") {
      const list = approvedByKey.get(m.portalKey) ?? [];
      list.push(m);
      approvedByKey.set(m.portalKey, list);
    } else if (m.status === "proposed") {
      proposedCountByKey.set(m.portalKey, (proposedCountByKey.get(m.portalKey) ?? 0) + 1);
    }
  }

  // Reference-only providers (migrated/onboard-existing) are never worked, so
  // they raise no gap cards — drop them before the provider map so a case whose
  // provider is reference-only finds no provider and is skipped (Epic 2e).
  const providerById = new Map(
    input.providers.filter((p) => !p.referenceOnly).map((p) => [p.id, p]),
  );
  const casesByProvider = new Map<string, OpenCaseLite[]>();
  for (const c of input.openCases) {
    const list = casesByProvider.get(c.providerId) ?? [];
    list.push(c);
    casesByProvider.set(c.providerId, list);
  }

  // --- provider_gap ---
  for (const [providerId, cases] of casesByProvider) {
    const provider = providerById.get(providerId);
    if (!provider) continue;
    for (const [token, def] of Object.entries(FIXIT_FIELDS)) {
      if (hasProviderValue(provider, token)) continue; // field present → no gap
      // Blocking cases: an open case whose payer's portal has an approved map
      // using this token. Absent that, the gap blocks no upcoming fill (v1).
      const blocking = cases.filter((c) => {
        const portal = portalByPayer.get(c.payerId);
        if (!portal) return false;
        const maps = approvedByKey.get(portal.portalKey) ?? [];
        return maps.some((m) => m.source === "token" && m.token === token);
      });
      if (blocking.length === 0) continue;
      blocking.sort((x, y) =>
        (x.nextDueDate ?? FAR_FUTURE).localeCompare(y.nextDueDate ?? FAR_FUTURE),
      );
      const soonest = blocking[0];
      const portal = portalByPayer.get(soonest.payerId)!;
      const approved = approvedByKey.get(portal.portalKey) ?? [];
      cards.push({
        id: `gap:${providerId}:${token}`,
        kind: "provider_gap",
        sortDate: soonest.nextDueDate,
        fieldsUnlocked: approved.filter((m) => m.source === "token" && m.token === token).length,
        gap: {
          providerId,
          providerName: `${provider.firstName} ${provider.lastName}`,
          token,
          field: token,
          fieldLabel: def.label,
          payerName: soonest.payerName,
          caseId: soonest.caseId,
          portalKey: portal.portalKey,
          portalName: portal.name,
          moreCount: blocking.length - 1,
          coverage: coverageFor(provider, approved, token),
        },
      });
    }
  }

  // --- dictionary_confirm: suggested rules seen at least twice ---
  for (const e of input.dictionary) {
    if (e.status !== "suggested" || e.seenCount < 2) continue;
    cards.push({
      id: `dict:${e.id}`,
      kind: "dictionary_confirm",
      sortDate: null, // affects every future form; no single blocked fill
      fieldsUnlocked: e.seenCount,
      dictionary: {
        entryId: e.id,
        label: e.labelNormalized,
        token: e.token,
        seenCount: e.seenCount,
      },
    });
  }

  // --- train_form: portals with proposed field maps ---
  for (const [portalKey, proposed] of proposedCountByKey) {
    if (proposed <= 0) continue;
    const portal = portalByKey.get(portalKey);
    if (!portal) continue;
    const matched = (approvedByKey.get(portalKey) ?? []).length;
    // Soonest fill this training would benefit: earliest open case on the payer.
    let sortDate: string | null = null;
    if (portal.payerId) {
      for (const c of input.openCases) {
        if (c.payerId === portal.payerId) sortDate = minDate(sortDate, c.nextDueDate);
      }
    }
    cards.push({
      id: `train:${portalKey}`,
      kind: "train_form",
      sortDate,
      fieldsUnlocked: proposed,
      train: { portalKey, portalName: portal.name, matched, total: matched + proposed },
    });
  }

  cards.sort(compareCards);
  return cards;
}
