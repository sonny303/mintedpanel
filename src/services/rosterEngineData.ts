// Server-only injected data operations for the roster API. Caller org and
// actor are always supplied by the verified API guard, never the body.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  getRosterTransformsForTarget,
  isRosterSourceCompatibleWithTarget,
} from "@/lib/rosterTransforms";
import type {
  CreateRosterMappingInput,
  RosterColumnAssignment,
  RosterExportFormat,
  RosterExportSnapshot,
  RosterGrain,
  RosterMapping,
  RosterOverride,
  RosterTemplate,
  RosterTemplateColumn,
  SaveRosterOverrideInput,
  UpdateRosterMappingInput,
} from "@/types";

export interface RosterEngineDataCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  actorId: string;
}

export interface RosterSourceSnapshot {
  source: {
    mapping: RosterMapping;
    template: RosterTemplate;
    rows: unknown[];
    validation_date: string;
    validator_version: string;
  };
  input_fingerprint: string;
}

const ROSTER_SELECT_LIMIT = 5000;
const ROSTER_SOURCE_FIELD_NAMES = new Set([
  "provider.first_name",
  "provider.last_name",
  "provider.npi",
  "provider.taxonomy_code",
  "provider.date_of_birth",
  "provider.ssn_last4",
  "facility.name",
  "facility.street",
  "facility.suite",
  "facility.city",
  "facility.state",
  "facility.zip",
  "facility.phone",
  "group.name",
  "group.npi_type2",
  "group.tin",
  "license.license_number",
  "license.issue_date",
  "license.expiration_date",
]);
const ROSTER_TRANSFORMS = new Set([
  "uppercase",
  "date_yyyy_mm_dd",
  "date_mm_dd_yyyy",
  "phone_strip",
  "npi_check",
]);

function failIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed roster response");
  return value as Record<string, unknown>;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function mapTemplate(raw: Record<string, unknown>): RosterTemplate {
  return {
    id: str(raw.id),
    slug: str(raw.slug),
    payerName: str(raw.payer_name),
    name: str(raw.name),
    schemaVersion: Number(raw.schema_version),
    verified: raw.is_verified === true,
    verificationStatus:
      raw.verification_status === "verified" ? "verified" : "draft_pending_payer_spec",
    grains: stringList(raw.grains).filter(
      (v): v is RosterGrain =>
        v === "provider" || v === "provider_location" || v === "provider_location_tin",
    ),
    columns: jsonArray(raw.columns).map((item) => {
      const column = jsonObject(item);
      return {
        key: str(column.key),
        header: str(column.header),
        required: column.required === true,
        targetType: column.targetType as RosterTemplateColumn["targetType"],
      };
    }),
  };
}

function mapMapping(raw: Record<string, unknown>): RosterMapping {
  const assignmentItems = jsonArray(raw.column_assignments).map((item) => jsonObject(item));
  return {
    id: str(raw.id),
    orgId: str(raw.org_id),
    templateId: str(raw.template_id),
    name: str(raw.name),
    grain: raw.grain as RosterGrain,
    selectedProviderIds: stringList(raw.selected_provider_ids),
    selectedFacilityIds: stringList(raw.selected_facility_ids),
    selectedGroupIds: stringList(raw.selected_group_ids),
    columnAssignments: assignmentItems.map((item) => ({
      columnKey: str(item.columnKey),
      sourceField: strOrNull(item.sourceField) as RosterColumnAssignment["sourceField"],
      transform: strOrNull(item.transform) as RosterColumnAssignment["transform"],
    })),
    revision: Number(raw.revision),
    updatedAt: str(raw.updated_at),
  };
}

async function readBounded<T>(
  queryPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  name: string,
): Promise<T[]> {
  const pageSize = 500;
  const rows: T[] = [];
  for (let from = 0; from <= ROSTER_SELECT_LIMIT; from += pageSize) {
    const to = Math.min(from + pageSize - 1, ROSTER_SELECT_LIMIT);
    const result = await queryPage(from, to);
    failIf(result.error);
    const page = result.data ?? [];
    rows.push(...page);
    if (rows.length > ROSTER_SELECT_LIMIT)
      throw new Error(`${name} exceeds the 5,000 row selection limit`);
    if (page.length < to - from + 1) return rows;
  }
  throw new Error(`${name} exceeds the 5,000 row selection limit`);
}

export async function listRosterTemplates(ctx: RosterEngineDataCtx): Promise<RosterTemplate[]> {
  const { data, error } = await ctx.db
    .from("roster_templates")
    .select(
      "id,org_id,slug,payer_name,name,schema_version,is_verified,verification_status,grains,columns",
    )
    .eq("org_id", ctx.orgId)
    .order("payer_name")
    .order("name");
  failIf(error);
  return (data ?? []).map((row) => mapTemplate(row as unknown as Record<string, unknown>));
}

export async function listRosterMappings(ctx: RosterEngineDataCtx): Promise<RosterMapping[]> {
  const rows = await readBounded(
    (from, to) =>
      ctx.db
        .from("roster_mappings")
        .select(
          "id,org_id,template_id,name,grain,selected_provider_ids,selected_facility_ids,selected_group_ids,column_assignments,revision,updated_at",
        )
        .eq("org_id", ctx.orgId)
        .order("updated_at", { ascending: false })
        .range(from, to),
    "Roster mappings",
  );
  return rows.map((row) => mapMapping(row as unknown as Record<string, unknown>));
}

export async function getRosterMappingRecord(
  ctx: RosterEngineDataCtx,
  mappingId: string,
): Promise<RosterMapping | null> {
  const { data, error } = await ctx.db
    .from("roster_mappings")
    .select(
      "id,org_id,template_id,name,grain,selected_provider_ids,selected_facility_ids,selected_group_ids,column_assignments,revision,updated_at",
    )
    .eq("org_id", ctx.orgId)
    .eq("id", mappingId)
    .maybeSingle();
  failIf(error);
  return data ? mapMapping(data as unknown as Record<string, unknown>) : null;
}

export async function getRosterMappingTemplate(
  ctx: RosterEngineDataCtx,
  templateId: string,
): Promise<RosterTemplate | null> {
  const { data, error } = await ctx.db
    .from("roster_templates")
    .select(
      "id,org_id,slug,payer_name,name,schema_version,is_verified,verification_status,grains,columns",
    )
    .eq("org_id", ctx.orgId)
    .eq("id", templateId)
    .maybeSingle();
  failIf(error);
  return data ? mapTemplate(data as unknown as Record<string, unknown>) : null;
}

export async function saveRosterMapping(
  ctx: RosterEngineDataCtx,
  input: CreateRosterMappingInput | UpdateRosterMappingInput,
  mappingId: string | null,
  current: RosterMapping | null,
): Promise<RosterMapping> {
  const merged: {
    templateId: string;
    name: string;
    grain: RosterGrain;
    selectedProviderIds: string[];
    selectedFacilityIds: string[];
    selectedGroupIds: string[];
    columnAssignments: RosterColumnAssignment[];
    expectedRevision: number;
  } =
    "expectedRevision" in input
      ? current
        ? {
            templateId: current.templateId,
            name: input.name ?? current.name,
            grain: input.grain ?? current.grain,
            selectedProviderIds: input.selectedProviderIds ?? current.selectedProviderIds,
            selectedFacilityIds: input.selectedFacilityIds ?? current.selectedFacilityIds,
            selectedGroupIds: input.selectedGroupIds ?? current.selectedGroupIds,
            columnAssignments: input.columnAssignments ?? current.columnAssignments,
            expectedRevision: input.expectedRevision,
          }
        : (() => {
            throw new Error("Roster mapping update requires the current mapping");
          })()
      : {
          templateId: (input as CreateRosterMappingInput).templateId,
          name: input.name,
          grain: input.grain,
          selectedProviderIds: input.selectedProviderIds,
          selectedFacilityIds: input.selectedFacilityIds ?? [],
          selectedGroupIds: input.selectedGroupIds ?? [],
          columnAssignments: [] as RosterColumnAssignment[],
          expectedRevision: 0,
        };
  if (merged.name.trim().length < 1 || merged.name.trim().length > 120)
    throw new Error("Roster mapping name must be 1–120 characters");
  if (
    merged.selectedProviderIds.length > ROSTER_SELECT_LIMIT ||
    merged.selectedFacilityIds.length > ROSTER_SELECT_LIMIT ||
    merged.selectedGroupIds.length > ROSTER_SELECT_LIMIT
  ) {
    throw new Error("Roster scope exceeds the 5,000 item limit");
  }
  const uniqueColumns = new Set<string>();
  for (const assignment of merged.columnAssignments) {
    if (uniqueColumns.has(assignment.columnKey))
      throw new Error("A template column can only be mapped once");
    uniqueColumns.add(assignment.columnKey);
    if (assignment.sourceField && !ROSTER_SOURCE_FIELD_NAMES.has(assignment.sourceField))
      throw new Error("Unsupported roster source field");
    if (assignment.transform && !ROSTER_TRANSFORMS.has(assignment.transform))
      throw new Error("Unsupported roster transform");
    if (
      assignment.transform?.startsWith("date_") &&
      !assignment.sourceField?.includes("date_of_birth") &&
      !assignment.sourceField?.includes("issue_date") &&
      !assignment.sourceField?.includes("expiration_date")
    ) {
      throw new Error("Date transforms require a date source field");
    }
    if (assignment.transform === "phone_strip" && assignment.sourceField !== "facility.phone")
      throw new Error("Phone transform requires a phone source field");
    if (
      assignment.transform === "npi_check" &&
      assignment.sourceField !== "provider.npi" &&
      assignment.sourceField !== "group.npi_type2"
    )
      throw new Error("NPI transform requires an NPI source field");
  }
  const template = await ctx.db
    .from("roster_templates")
    .select("id,grains,columns")
    .eq("id", merged.templateId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  failIf(template.error);
  if (!template.data || !(template.data.grains as string[]).includes(merged.grain))
    throw new Error("Roster template does not support that grain");
  const templateColumns = jsonArray(template.data.columns).map((column) => jsonObject(column));
  const columnTypes = new Map(
    templateColumns.map((column) => [str(column.key), str(column.targetType)]),
  );
  for (const assignment of merged.columnAssignments) {
    const targetType = columnTypes.get(assignment.columnKey) as
      RosterTemplateColumn["targetType"] | undefined;
    if (!targetType) throw new Error("Roster mapping references an unknown template column");
    if (
      assignment.sourceField &&
      !isRosterSourceCompatibleWithTarget(assignment.sourceField, targetType)
    ) {
      throw new Error("Roster source field does not match the template column type");
    }
    if (
      assignment.transform &&
      !getRosterTransformsForTarget(targetType).includes(assignment.transform)
    ) {
      throw new Error("Roster transform does not match the template column type");
    }
  }

  const { data, error } = await ctx.db.rpc("roster_engine_save_mapping", {
    p_org_id: ctx.orgId,
    p_actor_id: ctx.actorId,
    p_mapping_id: mappingId,
    p_expected_revision: merged.expectedRevision,
    p_template_id: merged.templateId,
    p_name: merged.name.trim(),
    p_grain: merged.grain,
    p_selected_provider_ids: merged.selectedProviderIds,
    p_selected_facility_ids: merged.selectedFacilityIds,
    p_selected_group_ids: merged.selectedGroupIds,
    p_column_assignments: merged.columnAssignments as unknown as Json,
  });
  failIf(error);
  if (!data) throw new Error("Roster mapping save returned no data");
  return mapMapping(jsonObject(data));
}

export async function getRosterSourceSnapshot(
  ctx: RosterEngineDataCtx,
  mappingId: string,
): Promise<RosterSourceSnapshot> {
  const { data, error } = await ctx.db.rpc("roster_engine_read_source", {
    p_org_id: ctx.orgId,
    p_mapping_id: mappingId,
    p_actor_id: ctx.actorId,
  });
  failIf(error);
  const result = jsonObject(data);
  const source = jsonObject(result.source);
  return {
    source: {
      mapping: mapMapping(jsonObject(source.mapping)),
      template: mapTemplate(jsonObject(source.template)),
      rows: jsonArray(source.rows),
      validation_date: str(source.validation_date),
      validator_version: str(source.validator_version),
    },
    input_fingerprint: str(result.input_fingerprint),
  };
}

export async function listRosterSourceOptions(ctx: RosterEngineDataCtx) {
  const [providers, facilities, groups] = await Promise.all([
    readBounded(
      (from, to) =>
        ctx.db
          .from("providers")
          .select("id,first_name,last_name,npi")
          .eq("org_id", ctx.orgId)
          .order("last_name")
          .order("first_name")
          .range(from, to),
      "Provider options",
    ),
    readBounded(
      (from, to) =>
        ctx.db
          .from("facilities")
          .select("id,name,state,group_id")
          .eq("org_id", ctx.orgId)
          .order("name")
          .range(from, to),
      "Facility options",
    ),
    readBounded(
      (from, to) =>
        ctx.db
          .from("provider_groups")
          .select("id,name,tin,npi_type2")
          .eq("org_id", ctx.orgId)
          .order("name")
          .range(from, to),
      "Group options",
    ),
  ]);
  const groupLabels = new Map(groups.map((row) => [row.id, row.name]));
  return {
    providers: providers.map((row) => ({
      id: row.id,
      label: `${row.last_name}, ${row.first_name}`,
      npi: row.npi,
    })),
    facilities: facilities.map((row) => ({
      id: row.id,
      label: row.name,
      state: row.state,
      groupId: row.group_id,
      groupLabel: row.group_id ? (groupLabels.get(row.group_id) ?? null) : null,
    })),
    groups: groups.map((row) => ({
      id: row.id,
      label: row.name,
      tin: row.tin,
      npi: row.npi_type2,
    })),
  };
}

export async function listRosterOverrides(
  ctx: RosterEngineDataCtx,
  mappingId: string,
  mappingRevision: number,
  fingerprint: string,
): Promise<RosterOverride[]> {
  const data = await readBounded(
    (from, to) =>
      ctx.db
        .from("roster_export_overrides")
        .select(
          "id,mapping_id,mapping_revision,input_fingerprint,row_key,rule_code,field_key,reason,created_at",
        )
        .eq("org_id", ctx.orgId)
        .eq("mapping_id", mappingId)
        .eq("mapping_revision", mappingRevision)
        .eq("input_fingerprint", fingerprint)
        .order("created_at", { ascending: true })
        .range(from, to),
    "Roster override history",
  );
  return data.map((row) => ({
    id: row.id,
    mappingId: row.mapping_id,
    revision: row.mapping_revision,
    inputFingerprint: row.input_fingerprint,
    rowKey: row.row_key,
    ruleCode: row.rule_code,
    fieldKey: row.field_key,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export async function recordRosterOverride(
  ctx: RosterEngineDataCtx,
  mappingId: string,
  input: SaveRosterOverrideInput,
): Promise<RosterOverride> {
  const reason = input.reason.trim();
  if (reason.length < 20) throw new Error("Override reason must contain at least 20 characters");
  const { data, error } = await ctx.db.rpc("roster_engine_record_override", {
    p_org_id: ctx.orgId,
    p_actor_id: ctx.actorId,
    p_mapping_id: mappingId,
    p_mapping_revision: input.expectedRevision,
    p_input_fingerprint: input.inputFingerprint,
    p_row_key: input.rowKey,
    p_rule_code: input.ruleCode,
    p_field_key: input.fieldKey,
    p_reason: reason,
  });
  failIf(error);
  const row = jsonObject(data);
  return {
    id: str(row.id),
    mappingId: str(row.mapping_id),
    revision: Number(row.mapping_revision),
    inputFingerprint: str(row.input_fingerprint),
    rowKey: str(row.row_key),
    ruleCode: str(row.rule_code),
    fieldKey: str(row.field_key),
    reason: str(row.reason),
    createdAt: str(row.created_at),
  };
}

function hexToBytes(hex: string): Uint8Array {
  const value = hex.startsWith("\\x") ? hex.slice(2) : hex;
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value))
    throw new Error("Stored roster artifact is malformed");
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1)
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return out;
}

export async function getRosterExportFile(ctx: RosterEngineDataCtx, snapshotId: string) {
  const { data, error } = await ctx.db
    .from("roster_export_snapshots")
    .select("file_name,format,file_bytes,sha256")
    .eq("org_id", ctx.orgId)
    .eq("id", snapshotId)
    .maybeSingle();
  failIf(error);
  if (!data) return null;
  const bytes = hexToBytes(data.file_bytes);
  const bytesBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(bytesBuffer).set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytesBuffer));
  const checksum = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (checksum !== data.sha256) throw new Error("Stored roster artifact checksum does not match");
  return { fileName: data.file_name, format: data.format as RosterExportFormat, bytes, checksum };
}

export async function getIdempotentRosterExport(
  ctx: RosterEngineDataCtx,
  mappingId: string,
  idempotencyKey: string,
  inputFingerprint: string,
  format: RosterExportFormat,
): Promise<RosterExportSnapshot | null> {
  const { data, error } = await ctx.db
    .from("roster_export_snapshots")
    .select(
      "id,mapping_id,template_id,mapping_name,template_name,template_is_verified,template_verification_status,exported_by,exported_at,format,file_name,total_rows,sha256,applied_overrides,expected_input_fingerprint",
    )
    .eq("org_id", ctx.orgId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  failIf(error);
  if (!data) return null;
  if (
    data.mapping_id !== mappingId ||
    data.exported_by !== ctx.actorId ||
    data.expected_input_fingerprint !== inputFingerprint ||
    data.format !== format
  ) {
    throw new Error("roster_idempotency_conflict");
  }
  return {
    id: data.id,
    mappingId: data.mapping_id,
    templateId: data.template_id,
    templateName: data.template_name,
    mappingName: data.mapping_name,
    templateVerified: data.template_is_verified,
    templateVerificationStatus:
      data.template_verification_status === "verified" ? "verified" : "draft_pending_payer_spec",
    format: data.format as RosterExportFormat,
    exportedAt: data.exported_at,
    exportedBy: data.exported_by,
    totalRows: data.total_rows,
    checksum: data.sha256,
    appliedOverrides: Array.isArray(data.applied_overrides) ? data.applied_overrides.length : 0,
    fileName: data.file_name,
    downloadPath: `/api/rosters/exports/${data.id}/download`,
  };
}

export async function listRosterExportSnapshots(
  ctx: RosterEngineDataCtx,
): Promise<RosterExportSnapshot[]> {
  const snapshots = await readBounded(
    (from, to) =>
      ctx.db
        .from("roster_export_snapshots")
        .select(
          "id,mapping_id,template_id,mapping_name,template_name,template_is_verified,template_verification_status,exported_by,exported_at,format,file_name,total_rows,sha256,applied_overrides",
        )
        .eq("org_id", ctx.orgId)
        .order("exported_at", { ascending: false })
        .range(from, to),
    "Roster export history",
  );
  return snapshots.map((row) => ({
    id: row.id,
    mappingId: row.mapping_id,
    templateId: row.template_id,
    templateName: row.template_name,
    mappingName: row.mapping_name,
    templateVerified: row.template_is_verified,
    templateVerificationStatus:
      row.template_verification_status === "verified" ? "verified" : "draft_pending_payer_spec",
    format: row.format as RosterExportFormat,
    exportedAt: row.exported_at,
    exportedBy: row.exported_by,
    totalRows: row.total_rows,
    checksum: row.sha256,
    appliedOverrides: Array.isArray(row.applied_overrides) ? row.applied_overrides.length : 0,
    fileName: row.file_name,
    downloadPath: `/api/rosters/exports/${row.id}/download`,
  }));
}

export async function commitRosterExport(
  ctx: RosterEngineDataCtx,
  input: {
    mappingId: string;
    mappingRevision: number;
    templateId: string;
    expectedInputFingerprint: string;
    idempotencyKey: string;
    format: RosterExportFormat;
    fileName: string;
    totalRows: number;
    bytesBase64: string;
    frozenSnapshot: Json;
    appliedOverrides: Json;
  },
) {
  const { data, error } = await ctx.db.rpc("roster_engine_commit_export", {
    p_org_id: ctx.orgId,
    p_actor_id: ctx.actorId,
    p_mapping_id: input.mappingId,
    p_mapping_revision: input.mappingRevision,
    p_template_id: input.templateId,
    p_expected_input_fingerprint: input.expectedInputFingerprint,
    p_idempotency_key: input.idempotencyKey,
    p_format: input.format,
    p_file_name: input.fileName,
    p_total_rows: input.totalRows,
    p_file_bytes_b64: input.bytesBase64,
    p_frozen_snapshot: input.frozenSnapshot,
    p_applied_overrides: input.appliedOverrides,
  });
  failIf(error);
  return jsonObject(data);
}
