// Schema-following token resolution for the entities the client already holds
// (provider / group / facility / mso).
//
// WHY THIS EXISTS. `get_sop_field_tokens()` is not curated — it sweeps
// information_schema.columns and emits `<prefix>.<camelCaseColumn>`. Every
// consumer that resolved those tokens against a HAND-WRITTEN map therefore
// drifted the moment a column landed: the SOP resolver's map advertised ~19
// keys, the pdf fill map 40, against a 130+ token catalog, so the SOP authoring
// picker showed a fraction of what the portal mapper offered.
//
// The domain types mirror their columns in camelCase, which is exactly the
// token's local part — so a token resolves by LOOKUP, not by enumeration. A new
// column becomes a new token in the catalog and resolves here with no code
// change; only composed tokens (facility.address) and cross-row aliases
// (license.licenseNumber) stay hand-written in their callers.

/** Keys the token catalog never emits — the camelCase mirror of the column
 * exclusion list inside `get_sop_field_tokens()`. Kept identical to the RPC so
 * the sweep produces the catalog's key set and not a superset. */
export const NON_TOKEN_ENTITY_KEYS: readonly string[] = [
  "id",
  "orgId",
  "createdAt",
  "updatedAt",
  "groupId",
  "facilityId",
  "providerId",
  "payerId",
  "msoId",
  "status",
  "isActive",
  "isNewGrad",
  "contractingStatusId",
];

const EXCLUDED = new Set(NON_TOKEN_ENTITY_KEYS);

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Render one column value as the string a token substitutes.
 *
 * Booleans read as Yes/No because these land in payer emails and printed form
 * fields, where "true" is not an answer. A jsonb blob (facility hours, ADA
 * compliance) has no single-line rendering and resolves to nothing rather than
 * to "[object Object]". */
function formatTokenValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    if (!value.every(isPrimitive)) return null;
    return (
      value
        .map((v) => formatTokenValue(v))
        .filter(Boolean)
        .join(", ") || null
    );
  }
  return null;
}

/** `<prefix>.<key>` -> value for every populated, catalog-eligible column of
 * one entity. Absent and empty columns are OMITTED, never blanked, so a caller
 * can tell "no value on file" from "" and layer its own defaults. */
export function entityTokenValues(
  prefix: string,
  entity: object | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!entity) return out;
  for (const [key, raw] of Object.entries(entity as Record<string, unknown>)) {
    if (EXCLUDED.has(key)) continue;
    const value = formatTokenValue(raw);
    if (value !== null) out[`${prefix}.${key}`] = value;
  }
  return out;
}

/** The union of every entity's tokens, keyed by token family prefix. */
export function buildEntityTokenValues(
  entities: Record<string, object | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prefix, entity] of Object.entries(entities)) {
    Object.assign(out, entityTokenValues(prefix, entity));
  }
  return out;
}

/** The token families this module can resolve from client-held entities.
 * Case-scoped families (payer/contract) and child-row families
 * (assignment/groupInsurance/license) are NOT here: no row is in hand. */
export const ENTITY_TOKEN_FAMILIES: readonly string[] = ["provider", "group", "facility", "mso"];

/** Composed address token — one box on a payer form, four columns in the
 * schema, so no sweep can produce it. */
export function composeAddressToken(
  parts: ReadonlyArray<string | null | undefined>,
): string | null {
  const joined = parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  return joined || null;
}
