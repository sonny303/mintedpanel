// Audit Log display labels. audit_log stores machine keys: the action enum,
// the entity type (snake_case), and the field names inside before / after
// (camelCase by the time they reach the report: listAuditLog camelizes the
// row deeply, RPC to_jsonb snapshots included). The report reads them as
// words. The maps hold the common keys whose humanized form is wrong or
// unclear; every other key falls back to humanizeAuditKey, so a new writer
// never shows a raw key. The raw key stays on hover for support staff. Pure.
//
// Keys come from stored rows, so every lookup is own-property only: a field
// named `constructor` or `toString` must read as words, never reach
// Object.prototype. (humanizeTokenField in quickCardCatalog.ts indexes its
// acronym table unguarded, which is why this file keeps its own humanizer.)
import type { AuditActionType } from "@/types";

const ACRONYMS: Readonly<Record<string, string>> = {
  npi: "NPI",
  tin: "TIN",
  caqh: "CAQH",
  dea: "DEA",
  ssn: "SSN",
  sop: "SOP",
  pdf: "PDF",
  url: "URL",
  id: "ID",
  ids: "IDs",
};

const ACTION_LABELS: Readonly<Record<string, string>> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
  STATUS_CHANGE: "Status changed",
  TOUCH_LOGGED: "Touch logged",
  TERMINATION: "Terminated",
  READ: "Viewed",
} satisfies Record<AuditActionType, string>;

// `case` (app services) and `credential_case` (case RPCs) are the same record;
// distinct labels keep both entity filter options tellable apart.
const ENTITY_LABELS: Readonly<Record<string, string>> = {
  case: "Case",
  credential_case: "Credentialing case",
  import_run: "Roster import",
  portal: "Payer portal",
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  orgId: "Organization ID",
  ssnLast4: "SSN (last 4)",
  removedReason: "Removal reason",
};

function own(map: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

/** Any audit key as words: `credential_case` → "Credential case",
 * `STATUS_CHANGE` → "Status change", `sopTemplateId` → "SOP template ID". */
export function humanizeAuditKey(key: string): string {
  const words = key
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => own(ACRONYMS, word) ?? word);
  if (words.length === 0) return key;
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

export function auditActionLabel(action: string): string {
  return own(ACTION_LABELS, action) ?? humanizeAuditKey(action);
}

export function auditEntityLabel(entityType: string): string {
  return own(ENTITY_LABELS, entityType) ?? humanizeAuditKey(entityType);
}

export function auditFieldLabel(key: string): string {
  return own(FIELD_LABELS, key) ?? humanizeAuditKey(key);
}
