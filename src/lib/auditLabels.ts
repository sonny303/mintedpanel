// Audit Log display labels. audit_log stores machine keys: the action enum,
// the entity type (snake_case), and the field names inside before / after
// (camelCase by the time they reach the report: listAuditLog camelizes the
// row deeply, RPC to_jsonb snapshots included). The report reads them as
// words. The maps hold the common keys whose humanized form is wrong or
// unclear; every other key falls back to humanizeAuditKey, so a new writer
// never shows a raw key. The raw key stays on hover for support staff. Pure.
import { humanizeTokenField } from "@/lib/quickCardCatalog";
import type { AuditActionType } from "@/types";

// humanizeTokenField already knows NPI / TIN / CAQH / SSN / ID; these are the
// audit-only words it would otherwise leave lower-case.
const AUDIT_ACRONYMS: Readonly<Record<string, string>> = {
  sop: "SOP",
  ids: "IDs",
  pdf: "PDF",
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

/** Any audit key as words: `credential_case` → "Credential case",
 * `STATUS_CHANGE` → "Status change", `sopTemplateId` → "SOP template ID". */
export function humanizeAuditKey(key: string): string {
  const spaced = key.replace(/_+/g, " ").trim();
  if (!spaced) return key;
  return humanizeTokenField(spaced)
    .split(" ")
    .map((word) => AUDIT_ACRONYMS[word.toLowerCase()] ?? word)
    .join(" ");
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanizeAuditKey(action);
}

export function auditEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? humanizeAuditKey(entityType);
}

export function auditFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanizeAuditKey(key);
}
