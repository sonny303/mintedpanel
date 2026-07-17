// Facility contact inheritance (E1.2 TE-4, locked PM decision 2026-07-12):
// a facility's tel/fax/contact DEFAULT TO the owning group's contact unless
// the facility supplies its own. Pure render-time derivation — the group's
// values are displayed as inherited, NEVER copied into facility columns, so
// a later group edit is never frozen into a stale copy. When several group
// blocks are populated the precedence is credentialing → correspondence →
// billing (first non-empty block wins).
import type { ProviderGroup } from "@/types";

export interface ContactChannel {
  contactName: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
}

export interface ResolvedFacilityContact extends ContactChannel {
  /** "facility" = own values; a block key = inherited from the group. */
  source: "facility" | "credentialing" | "correspondence" | "billing" | null;
  inherited: boolean;
}

const blank = (v: string | null | undefined): boolean => !v || !v.trim();
const hasAny = (c: ContactChannel): boolean =>
  !blank(c.contactName) || !blank(c.phone) || !blank(c.fax) || !blank(c.email);

function groupBlock(
  g: ProviderGroup,
  key: "credentialing" | "correspondence" | "billing",
): ContactChannel {
  return {
    contactName: g[`${key}ContactName`] ?? null,
    phone: g[`${key}Phone`] ?? null,
    fax: g[`${key}Fax`] ?? null,
    email: g[`${key}Email`] ?? null,
  };
}

/** First non-empty group contact block in locked precedence order, or null. */
export function groupDefaultContact(
  group: ProviderGroup | null | undefined,
): { block: "credentialing" | "correspondence" | "billing"; channel: ContactChannel } | null {
  if (!group) return null;
  for (const key of ["credentialing", "correspondence", "billing"] as const) {
    const channel = groupBlock(group, key);
    if (hasAny(channel)) return { block: key, channel };
  }
  return null;
}

export function resolveFacilityContact(
  facility: ContactChannel,
  group: ProviderGroup | null | undefined,
): ResolvedFacilityContact {
  if (hasAny(facility)) {
    return { ...facility, source: "facility", inherited: false };
  }
  const fallback = groupDefaultContact(group);
  if (fallback) {
    return { ...fallback.channel, source: fallback.block, inherited: true };
  }
  return {
    contactName: null,
    phone: null,
    fax: null,
    email: null,
    source: null,
    inherited: false,
  };
}

/** The F1.2.1 minimum-to-save contact rule: some reachable channel must
 * exist — the facility's own, or the owning group's inherited default. */
export function hasReachableContact(
  facility: ContactChannel,
  group: ProviderGroup | null | undefined,
): boolean {
  return resolveFacilityContact(facility, group).source !== null;
}
