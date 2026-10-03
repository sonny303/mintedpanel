import type { CaseType } from "@/lib/caseTypes";

// A portal_key is the stable identifier the extension sends with each fill /
// capture. When an admin adds a portal by hand we derive a sane default from
// the name: lowercase, spaces/punctuation → single hyphens, trimmed.
export function slugifyPortalKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Create an independent configuration key. Display names and URLs can be
 * shared by multiple scenarios, so neither alone can identify the config.
 * Generate only when the user submits; calling this during render would make
 * server/client output nondeterministic.
 */
export function createPortalConfigurationKey(name: string, caseType: CaseType): string {
  const base = slugifyPortalKey(name) || "portal";
  const unique = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12).toLowerCase();
  return `${base}-${caseType}-${unique}`;
}

export function createIndependentPortalInput(input: {
  name: string;
  payerId: string;
  caseType: CaseType;
  formUrl: string;
}) {
  const name = input.name.trim();
  const payerId = input.payerId.trim();
  if (!name) throw new Error("Portal name is required.");
  if (!payerId) throw new Error("Payer is required.");
  return {
    name,
    portalKey: createPortalConfigurationKey(name, input.caseType),
    payerId,
    formUrl: input.formUrl.trim() || null,
    caseType: input.caseType,
  };
}
