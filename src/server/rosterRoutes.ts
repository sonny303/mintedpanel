// Org-guarded roster engine routes. Every response is private/no-store because
// previews and artifacts can contain provider demographics.
import {
  commitRosterExport,
  getIdempotentRosterExport,
  getRosterExportFile,
  getRosterMappingRecord,
  getRosterMappingTemplate,
  getRosterSourceSnapshot,
  listRosterExportSnapshots,
  listRosterMappings,
  listRosterOverrides,
  listRosterSourceOptions,
  listRosterTemplates,
  recordRosterOverride,
  saveRosterMapping,
  type RosterEngineDataCtx,
} from "@/services/rosterEngineData";
import { evaluateRosterSource } from "@/lib/rosterValidation";
import { isRosterSourceCompatibleWithTarget } from "@/lib/rosterTransforms";
import { serializeRosterFile } from "@/lib/rosterSpreadsheet";
import { fail, ok } from "./envelope";
import { isWriter, type AuthContext } from "./guard";
import type {
  CreateRosterMappingInput,
  RosterColumnAssignment,
  RosterExportFormat,
  RosterGrain,
  RosterTemplate,
  RosterTransform,
  RosterValueType,
  SaveRosterOverrideInput,
  UpdateRosterMappingInput,
} from "@/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA_RE = /^[0-9a-f]{64}$/i;
const GRAINS = new Set<RosterGrain>(["provider", "provider_location", "provider_location_tin"]);
const SOURCE_FIELDS = new Set([
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
const TRANSFORMS = new Set<RosterTransform>([
  "uppercase",
  "date_yyyy_mm_dd",
  "date_mm_dd_yyyy",
  "phone_strip",
  "npi_check",
]);

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store, private, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function dataCtx(ctx: AuthContext): RosterEngineDataCtx {
  return { db: ctx.db, orgId: ctx.orgId, actorId: ctx.userId };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function safeError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  if (/roster_(mapping_not_found|template_not_found)|PGRST116/.test(message))
    return noStore(fail(404, "Roster resource not found"));
  if (
    /roster_(input_fingerprint_stale|mapping_revision_conflict|idempotency_conflict)/.test(message)
  ) {
    return noStore(
      fail(
        409,
        "Roster inputs changed or this operation conflicts with a previous save. Refresh and retry.",
      ),
    );
  }
  if (
    /roster_(writer_membership_required|membership_required|scope_cross_org|template_unavailable)/.test(
      message,
    )
  ) {
    return noStore(fail(403, "Roster access is not permitted for this organization"));
  }
  if (/roster_(row_limit_exceeded|artifact_limit_exceeded)/.test(message))
    return noStore(fail(413, "Roster exceeds the 5,000 row or 3 MiB artifact limit"));
  if (
    /reason_too_short|mapping_invalid|location_scope_required|provider_grain_group_ambiguous/.test(
      message,
    )
  ) {
    return noStore(fail(422, "Roster request is incomplete or invalid"));
  }
  return noStore(fail(500, "Roster operation could not be completed"));
}

async function run<T>(
  operation: () => Promise<T>,
  respond: (value: T) => Response,
): Promise<Response> {
  try {
    return noStore(respond(await operation()));
  } catch (error) {
    // Roster failures stay out of shared API error logging: a database error
    // may contain source-derived values, and this feature handles PHI.
    return safeError(error);
  }
}

function requireWriter(ctx: AuthContext): Response | null {
  return isWriter(ctx) ? null : noStore(fail(403, "Your role cannot modify provider rosters"));
}

function validateAssignments(
  raw: unknown,
  template: RosterTemplate,
): RosterColumnAssignment[] | null {
  if (!Array.isArray(raw)) return null;
  const columns = new Map(template.columns.map((column) => [column.key, column]));
  const seen = new Set<string>();
  const result: RosterColumnAssignment[] = [];
  for (const entry of raw) {
    if (
      !isObject(entry) ||
      !string(entry.columnKey) ||
      !columns.has(entry.columnKey) ||
      seen.has(entry.columnKey)
    )
      return null;
    seen.add(entry.columnKey);
    const field = entry.sourceField;
    const transform = entry.transform;
    if (field !== null && (!string(field) || !SOURCE_FIELDS.has(field))) return null;
    if (transform !== null && (!string(transform) || !TRANSFORMS.has(transform as RosterTransform)))
      return null;
    const column = columns.get(entry.columnKey);
    if (!column) return null;
    if (transform && !transformFits(transform as RosterTransform, column.targetType)) return null;
    if (field && !fieldFits(field, column.targetType)) return null;
    result.push({
      columnKey: entry.columnKey,
      sourceField: field as RosterColumnAssignment["sourceField"],
      transform: transform as RosterColumnAssignment["transform"],
    });
  }
  return result;
}

function transformFits(transform: RosterTransform, target: RosterValueType): boolean {
  if (transform === "uppercase") return target === "text";
  if (transform.startsWith("date_")) return target === "date";
  if (transform === "phone_strip") return target === "phone";
  return target === "npi";
}

function fieldFits(field: string, target: RosterValueType): boolean {
  return isRosterSourceCompatibleWithTarget(
    field as NonNullable<RosterColumnAssignment["sourceField"]>,
    target,
  );
}

function validateCreateBody(body: unknown): CreateRosterMappingInput | null {
  if (
    !isObject(body) ||
    !string(body.templateId) ||
    !UUID_RE.test(body.templateId) ||
    !string(body.name) ||
    !string(body.grain) ||
    !GRAINS.has(body.grain as RosterGrain)
  )
    return null;
  const providerIds = strings(body.selectedProviderIds);
  const facilityIds =
    body.selectedFacilityIds === undefined ? [] : strings(body.selectedFacilityIds);
  const groupIds = body.selectedGroupIds === undefined ? [] : strings(body.selectedGroupIds);
  if (
    !providerIds ||
    !facilityIds ||
    !groupIds ||
    [...providerIds, ...facilityIds, ...groupIds].some((id) => !UUID_RE.test(id))
  )
    return null;
  return {
    templateId: body.templateId,
    name: body.name,
    grain: body.grain as RosterGrain,
    selectedProviderIds: providerIds,
    selectedFacilityIds: facilityIds,
    selectedGroupIds: groupIds,
  };
}

function validateUpdateBody(body: unknown): UpdateRosterMappingInput | null {
  if (
    !isObject(body) ||
    !Number.isInteger(body.expectedRevision) ||
    Number(body.expectedRevision) < 1
  )
    return null;
  const input: UpdateRosterMappingInput = { expectedRevision: Number(body.expectedRevision) };
  if (body.name !== undefined) {
    if (!string(body.name)) return null;
    input.name = body.name;
  }
  if (body.grain !== undefined) {
    if (!string(body.grain) || !GRAINS.has(body.grain as RosterGrain)) return null;
    input.grain = body.grain as RosterGrain;
  }
  for (const key of ["selectedProviderIds", "selectedFacilityIds", "selectedGroupIds"] as const) {
    if (body[key] !== undefined) {
      const ids = strings(body[key]);
      if (!ids || ids.some((id) => !UUID_RE.test(id))) return null;
      input[key] = ids;
    }
  }
  if (body.columnAssignments !== undefined) {
    if (!Array.isArray(body.columnAssignments)) return null;
    input.columnAssignments = body.columnAssignments as RosterColumnAssignment[];
  }
  return input;
}

async function getMappingDetail(ctx: AuthContext, id: string) {
  const service = dataCtx(ctx);
  const mapping = await getRosterMappingRecord(service, id);
  if (!mapping) return null;
  const [template, sourceOptions] = await Promise.all([
    getRosterMappingTemplate(service, mapping.templateId),
    listRosterSourceOptions(service),
  ]);
  if (!template) return null;
  return { mapping, template, sourceOptions };
}

async function evaluateCurrent(ctx: AuthContext, mappingId: string) {
  const service = dataCtx(ctx);
  const snapshot = await getRosterSourceSnapshot(service, mappingId);
  const overrides = await listRosterOverrides(
    service,
    mappingId,
    snapshot.source.mapping.revision,
    snapshot.input_fingerprint,
  );
  const result = evaluateRosterSource(
    {
      mapping: snapshot.source.mapping,
      template: snapshot.source.template,
      sourceRows: snapshot.source.rows,
      inputFingerprint: snapshot.input_fingerprint,
      validationDate: snapshot.source.validation_date,
    },
    overrides.map((override) => ({
      id: override.id,
      rowKey: override.rowKey,
      ruleCode: override.ruleCode,
      fieldKey: override.fieldKey,
      reason: override.reason,
    })),
  );
  return { service, snapshot, overrides, result };
}

export function handleListRosterTemplates(ctx: AuthContext): Promise<Response> {
  return run(
    () => listRosterTemplates(dataCtx(ctx)),
    (templates) => ok(templates),
  );
}

export function handleListRosterMappings(ctx: AuthContext): Promise<Response> {
  return run(
    () => listRosterMappings(dataCtx(ctx)),
    (mappings) => ok(mappings),
  );
}

export function handleCreateRosterMapping(body: unknown, ctx: AuthContext): Promise<Response> {
  const blocked = requireWriter(ctx);
  if (blocked) return Promise.resolve(blocked);
  const input = validateCreateBody(body);
  if (!input) return Promise.resolve(noStore(fail(422, "Roster mapping request is invalid")));
  return run(
    async () => {
      const template = await getRosterMappingTemplate(dataCtx(ctx), input.templateId);
      if (!template || !template.grains.includes(input.grain))
        throw new Error("roster_template_unavailable");
      const mapping = await saveRosterMapping(dataCtx(ctx), input, null, null);
      const detail = await getMappingDetail(ctx, mapping.id);
      if (!detail) throw new Error("roster_mapping_not_found");
      return detail;
    },
    (detail) => ok(detail, null, 201),
  );
}

export function handleGetRosterMapping(id: string, ctx: AuthContext): Promise<Response> {
  if (!UUID_RE.test(id)) return Promise.resolve(noStore(fail(404, "Roster mapping not found")));
  return run(
    async () => {
      const detail = await getMappingDetail(ctx, id);
      if (!detail) throw new Error("roster_mapping_not_found");
      return detail;
    },
    (detail) => ok(detail),
  );
}

export function handleUpdateRosterMapping(
  id: string,
  body: unknown,
  ctx: AuthContext,
): Promise<Response> {
  const blocked = requireWriter(ctx);
  if (blocked) return Promise.resolve(blocked);
  if (!UUID_RE.test(id)) return Promise.resolve(noStore(fail(404, "Roster mapping not found")));
  const input = validateUpdateBody(body);
  if (!input) return Promise.resolve(noStore(fail(422, "Roster mapping request is invalid")));
  return run(
    async () => {
      const service = dataCtx(ctx);
      const current = await getRosterMappingRecord(service, id);
      if (!current) throw new Error("roster_mapping_not_found");
      if (current.revision !== input.expectedRevision)
        throw new Error("roster_mapping_revision_conflict");
      const template = await getRosterMappingTemplate(service, current.templateId);
      if (!template) throw new Error("roster_template_not_found");
      if (input.grain && !template.grains.includes(input.grain))
        throw new Error("roster_mapping_invalid");
      if (input.columnAssignments) {
        const assignments = validateAssignments(input.columnAssignments, template);
        if (!assignments) throw new Error("roster_mapping_invalid");
        input.columnAssignments = assignments;
      }
      const mapping = await saveRosterMapping(service, input, id, current);
      const detail = await getMappingDetail(ctx, mapping.id);
      if (!detail) throw new Error("roster_mapping_not_found");
      return detail;
    },
    (detail) => ok(detail),
  );
}

export function handleRosterPreview(id: string, ctx: AuthContext): Promise<Response> {
  if (!UUID_RE.test(id)) return Promise.resolve(noStore(fail(404, "Roster mapping not found")));
  return run(
    async () => (await evaluateCurrent(ctx, id)).result.preview,
    (preview) => ok(preview),
  );
}

export function handleRosterValidation(id: string, ctx: AuthContext): Promise<Response> {
  if (!UUID_RE.test(id)) return Promise.resolve(noStore(fail(404, "Roster mapping not found")));
  return run(
    async () => (await evaluateCurrent(ctx, id)).result.validation,
    (validation) => ok(validation),
  );
}

export function handleSaveRosterOverride(
  id: string,
  body: unknown,
  ctx: AuthContext,
): Promise<Response> {
  const blocked = requireWriter(ctx);
  if (blocked) return Promise.resolve(blocked);
  if (
    !UUID_RE.test(id) ||
    !isObject(body) ||
    !Number.isInteger(body.expectedRevision) ||
    !string(body.inputFingerprint) ||
    !HEX_SHA_RE.test(body.inputFingerprint) ||
    !string(body.rowKey) ||
    !string(body.ruleCode) ||
    !string(body.fieldKey) ||
    !string(body.reason)
  ) {
    return Promise.resolve(noStore(fail(422, "Roster override request is invalid")));
  }
  const input: SaveRosterOverrideInput = {
    expectedRevision: Number(body.expectedRevision),
    inputFingerprint: body.inputFingerprint,
    rowKey: body.rowKey,
    ruleCode: body.ruleCode,
    fieldKey: body.fieldKey,
    reason: body.reason,
  };
  if (input.reason.trim().length < 20)
    return Promise.resolve(
      noStore(fail(422, "Override reason must contain at least 20 characters")),
    );
  return run(
    async () => {
      const { service, snapshot, result } = await evaluateCurrent(ctx, id);
      if (
        snapshot.source.mapping.revision !== input.expectedRevision ||
        snapshot.input_fingerprint !== input.inputFingerprint
      ) {
        throw new Error("roster_input_fingerprint_stale");
      }
      const issue = result.validation.issues.find(
        (candidate) =>
          candidate.rowKey === input.rowKey &&
          candidate.ruleCode === input.ruleCode &&
          candidate.fieldKey === input.fieldKey,
      );
      if (!issue || issue.severity !== "hard_error" || !issue.overrideable)
        throw new Error("roster_mapping_invalid");
      return recordRosterOverride(service, id, input);
    },
    (override) => ok(override, null, 201),
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function safeFileStem(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "provider-roster"
  );
}

function parseExportBody(body: unknown): {
  format: RosterExportFormat;
  expectedInputFingerprint: string;
  idempotencyKey: string;
} | null {
  if (
    !isObject(body) ||
    (body.format !== "csv" && body.format !== "xlsx") ||
    !string(body.expectedInputFingerprint) ||
    !HEX_SHA_RE.test(body.expectedInputFingerprint) ||
    !string(body.idempotencyKey) ||
    !UUID_RE.test(body.idempotencyKey)
  )
    return null;
  return {
    format: body.format,
    expectedInputFingerprint: body.expectedInputFingerprint,
    idempotencyKey: body.idempotencyKey,
  };
}

export function handleRosterExport(id: string, body: unknown, ctx: AuthContext): Promise<Response> {
  const blocked = requireWriter(ctx);
  if (blocked) return Promise.resolve(blocked);
  if (!UUID_RE.test(id)) return Promise.resolve(noStore(fail(404, "Roster mapping not found")));
  const input = parseExportBody(body);
  if (!input) return Promise.resolve(noStore(fail(422, "Roster export request is invalid")));
  return run(
    async () => {
      const prior = await getIdempotentRosterExport(
        dataCtx(ctx),
        id,
        input.idempotencyKey,
        input.expectedInputFingerprint,
        input.format,
      );
      if (prior) return { snapshot: prior, replayed: true };
      const { service, snapshot, overrides, result } = await evaluateCurrent(ctx, id);
      if (snapshot.input_fingerprint !== input.expectedInputFingerprint)
        throw new Error("roster_input_fingerprint_stale");
      if (!result.validation.exportable) throw new Error("roster_mapping_invalid");
      const bytes = serializeRosterFile(result.headers, result.outputRows, input.format);
      if (bytes.byteLength > 3 * 1024 * 1024) throw new Error("roster_artifact_limit_exceeded");
      const fileName = `${safeFileStem(snapshot.source.mapping.name)}-${snapshot.source.validation_date}.${input.format}`;
      const appliedOverrides = result.validation.issues
        .filter((issue) => issue.overrideId)
        .map((issue) => {
          const override = overrides.find((candidate) => candidate.id === issue.overrideId);
          return override
            ? {
                id: override.id,
                rowKey: override.rowKey,
                ruleCode: override.ruleCode,
                fieldKey: override.fieldKey,
                reason: override.reason,
                createdAt: override.createdAt,
              }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      const frozenSnapshot = {
        template: snapshot.source.template,
        mapping: snapshot.source.mapping,
        validationDate: snapshot.source.validation_date,
        validatorVersion: snapshot.source.validator_version,
        inputFingerprint: snapshot.input_fingerprint,
        sourceRows: snapshot.source.rows,
        previewRows: result.preview.rows,
        headers: result.headers,
        outputRows: result.outputRows,
      };
      const committed = await commitRosterExport(service, {
        mappingId: id,
        mappingRevision: snapshot.source.mapping.revision,
        templateId: snapshot.source.template.id,
        expectedInputFingerprint: input.expectedInputFingerprint,
        idempotencyKey: input.idempotencyKey,
        format: input.format,
        fileName,
        totalRows: result.preview.rowCount,
        bytesBase64: base64(bytes),
        frozenSnapshot: frozenSnapshot as never,
        appliedOverrides: appliedOverrides as never,
      });
      const exportSnapshot = {
        id: String(committed.id),
        mappingId: id,
        templateId: snapshot.source.template.id,
        templateName: snapshot.source.template.name,
        mappingName: snapshot.source.mapping.name,
        templateVerified: snapshot.source.template.verified,
        templateVerificationStatus: snapshot.source.template.verificationStatus,
        format: input.format,
        exportedAt: String(committed.exported_at),
        exportedBy: ctx.userId,
        totalRows: result.preview.rowCount,
        checksum: String(committed.sha256),
        appliedOverrides: appliedOverrides.length,
        fileName: String(committed.file_name),
        downloadPath: `/api/rosters/exports/${String(committed.id)}/download`,
      };
      return { snapshot: exportSnapshot, replayed: false };
    },
    ({ snapshot, replayed }) => ok(snapshot, null, replayed ? 200 : 201),
  );
}

export function handleRosterHistory(ctx: AuthContext): Promise<Response> {
  return run(
    () => listRosterExportSnapshots(dataCtx(ctx)),
    (history) => ok(history),
  );
}

export async function handleRosterDownload(id: string, ctx: AuthContext): Promise<Response> {
  if (!UUID_RE.test(id)) return noStore(fail(404, "Roster export not found"));
  try {
    const file = await getRosterExportFile(dataCtx(ctx), id);
    if (!file) return noStore(fail(404, "Roster export not found"));
    const contentType =
      file.format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const bytesBuffer = new ArrayBuffer(file.bytes.byteLength);
    new Uint8Array(bytesBuffer).set(file.bytes);
    const response = new Response(bytesBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
        "Content-Length": String(file.bytes.byteLength),
        "X-Content-SHA256": file.checksum,
      },
    });
    return noStore(response);
  } catch {
    return noStore(fail(500, "Roster download could not be completed"));
  }
}
