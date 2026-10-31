import {
  getRosterSourceValue,
  isValidNpi,
  isSsnLast4,
  isRosterSourceCompatibleWithTarget,
  isZipPlus4,
  transformRosterValue,
} from "@/lib/rosterTransforms";
import type {
  RosterColumnAssignment,
  RosterMapping,
  RosterPreview,
  RosterPreviewRow,
  RosterTemplate,
  RosterValidationIssue,
  RosterValidationResult,
} from "@/types";

export interface RosterEvaluation {
  mapping: RosterMapping;
  template: RosterTemplate;
  sourceRows: unknown[];
  inputFingerprint: string;
  validationDate: string;
}

export interface RosterEvaluationResult {
  preview: RosterPreview;
  validation: RosterValidationResult;
  headers: string[];
  outputRows: string[][];
}

type RowObject = Record<string, unknown>;

function object(value: unknown): RowObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RowObject) : {};
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function nonblank(value: string | null): value is string {
  return value != null && value.trim() !== "";
}

function fieldMappings(assignments: RosterColumnAssignment[]): Map<string, RosterColumnAssignment> {
  return new Map(assignments.map((assignment) => [assignment.columnKey, assignment]));
}

function mappingIsLocationDependent(assignments: RosterColumnAssignment[]): boolean {
  return assignments.some(
    (assignment) =>
      assignment.sourceField?.startsWith("facility.") ||
      assignment.sourceField?.startsWith("license."),
  );
}

function templateRequiresLocation(template: RosterTemplate): boolean {
  return template.columns.some((column) =>
    /address|street|city|state|zip|postal|practice|location|phone/i.test(
      `${column.key} ${column.header}`,
    ),
  );
}

function phoneHasUsLength(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^\d{10}$/.test(digits) || /^1\d{10}$/.test(digits);
}

function isValidNpiExportValue(value: string): boolean {
  return /^\d{10}$/.test(value) && isValidNpi(value);
}

function isCurrentLicense(
  raw: unknown,
  validationDate: string,
  targetState: string | null,
): boolean {
  const license = object(raw);
  const state = text(license.state)?.toUpperCase() ?? null;
  const licenseNumber = text(license.license_number)?.trim();
  const issueDate = text(license.issue_date);
  const expirationDate = text(license.expiration_date);
  return (
    license.status === "active" &&
    !!licenseNumber &&
    state === targetState?.toUpperCase() &&
    !!expirationDate &&
    expirationDate >= validationDate &&
    (!issueDate || issueDate <= validationDate)
  );
}

function selectRosterLicense(
  raw: RowObject,
  validationDate: string,
  state: string | null,
): RowObject | null {
  const licenses = Array.isArray(raw.licenses) ? raw.licenses.map(object) : [];
  return (
    licenses.find((license) => isCurrentLicense(license, validationDate, state)) ??
    licenses[0] ??
    null
  );
}

function appendIssue(
  issues: RosterValidationIssue[],
  rowKey: string,
  ruleCode: string,
  fieldKey: string,
  message: string,
  overrideable: boolean,
  severity: "hard_error" | "warning" = "hard_error",
): void {
  issues.push({
    rowKey,
    ruleCode,
    fieldKey,
    message,
    overrideable,
    severity,
    overrideId: null,
    overrideReason: null,
  });
}

function calculateCell(
  rawRow: RowObject,
  assignment: RosterColumnAssignment | undefined,
  validationDate: string,
): string | null {
  if (!assignment?.sourceField) return null;
  const value = getRosterSourceValue(rawRow, assignment.sourceField);
  return transformRosterValue(value, assignment.transform);
}

export function evaluateRosterSource(
  input: RosterEvaluation,
  activeOverrides: Array<{
    id: string;
    rowKey: string;
    ruleCode: string;
    fieldKey: string;
    reason: string;
  }> = [],
): RosterEvaluationResult {
  const assignmentByColumn = fieldMappings(input.mapping.columnAssignments);
  const issues: RosterValidationIssue[] = [];
  const rawRows = input.sourceRows.map(object);
  const rows: RosterPreviewRow[] = [];
  const outputRows: string[][] = [];
  const locationDependent = mappingIsLocationDependent(input.mapping.columnAssignments);
  const locationRequired = locationDependent || templateRequiresLocation(input.template);

  if (input.mapping.selectedProviderIds.length === 0) {
    appendIssue(
      issues,
      "__scope__",
      "roster_scope_empty",
      "selected_provider_ids",
      "Select at least one provider before validating or exporting.",
      false,
    );
  }
  if (rawRows.length === 0 && input.mapping.selectedProviderIds.length > 0) {
    appendIssue(
      issues,
      "__scope__",
      "roster_rows_empty",
      "selected_provider_ids",
      "No provider rows match this saved scope. Review the selected location and assignments.",
      false,
    );
  }
  if (
    input.mapping.grain === "provider" &&
    locationRequired &&
    input.mapping.selectedFacilityIds.length !== 1
  ) {
    appendIssue(
      issues,
      "__mapping__",
      "provider_grain_location_ambiguous",
      "selected_facility_ids",
      "Provider grain needs exactly one explicit location to map address or license fields.",
      false,
    );
  }
  const hasGroupFields = input.mapping.columnAssignments.some((assignment) =>
    assignment.sourceField?.startsWith("group."),
  );
  if (
    (hasGroupFields || input.mapping.grain === "provider_location_tin") &&
    input.mapping.selectedGroupIds.length === 0
  ) {
    appendIssue(
      issues,
      "__mapping__",
      "group_scope_required",
      "selected_group_ids",
      "Select the group identity used by this roster mapping.",
      false,
    );
  }
  for (const column of input.template.columns) {
    const assignment = assignmentByColumn.get(column.key);
    if (column.required && !assignment?.sourceField) {
      appendIssue(
        issues,
        "__mapping__",
        "required_column_unmapped",
        column.key,
        `Required column “${column.header}” needs a source field.`,
        false,
      );
    }
    if (
      assignment?.sourceField &&
      !isRosterSourceCompatibleWithTarget(assignment.sourceField, column.targetType)
    ) {
      appendIssue(
        issues,
        "__mapping__",
        "source_type_mismatch",
        column.key,
        `The selected source does not match the ${column.targetType} column type.`,
        false,
      );
    }
  }
  if (!input.template.verified) {
    appendIssue(
      issues,
      "__template__",
      "draft_template_unverified",
      "template",
      "This payer schema is a draft and has not been checked against the payer’s current workbook.",
      false,
      "warning",
    );
  }

  for (const rawRow of rawRows) {
    const rowKey = text(rawRow.rowKey) ?? "unknown-row";
    const provider = object(rawRow.provider);
    const facility = Object.keys(object(rawRow.facility)).length ? object(rawRow.facility) : null;
    const group = Object.keys(object(rawRow.group)).length ? object(rawRow.group) : null;
    const state = text(facility?.state);
    const selectedLicense = selectRosterLicense(rawRow, input.validationDate, state);
    const rowSource = { ...rawRow, licenses: selectedLicense ? [selectedLicense] : [] };
    const providerLabel =
      [text(provider.first_name), text(provider.last_name)].filter(nonblank).join(" ") ||
      "Unnamed provider";
    const facilityLabel = text(facility?.name);
    const groupLabel = text(group?.name);
    const values: Record<string, string | null> = {};
    const ssnAssignment = input.mapping.columnAssignments.find(
      (assignment) => assignment.sourceField === "provider.ssn_last4",
    );
    const rawSsn = text(provider.ssn_last4);
    if (
      ssnAssignment &&
      (provider.ssn_last4_valid === false || (rawSsn !== null && !isSsnLast4(rawSsn)))
    ) {
      appendIssue(
        issues,
        rowKey,
        "ssn_last4_invalid",
        ssnAssignment.columnKey,
        "SSN last four must contain exactly four digits. The source value is redacted and cannot be overridden.",
        false,
      );
    }

    for (const column of input.template.columns) {
      const assignment = assignmentByColumn.get(column.key);
      const value = calculateCell(rowSource, assignment, input.validationDate);
      values[column.key] = value;
      if (column.required && !nonblank(value)) {
        appendIssue(
          issues,
          rowKey,
          "required_value_missing",
          column.key,
          `Required value for “${column.header}” is missing.`,
          true,
        );
      }
      if (value != null && column.targetType === "npi" && !isValidNpiExportValue(value)) {
        appendIssue(
          issues,
          rowKey,
          "npi_invalid",
          column.key,
          `“${column.header}” must be a 10 digit NPI with a valid check digit.`,
          true,
        );
      }
      if (
        assignment?.sourceField === "facility.phone" &&
        value != null &&
        !phoneHasUsLength(value)
      ) {
        appendIssue(
          issues,
          rowKey,
          "phone_invalid",
          column.key,
          `“${column.header}” must contain a 10 digit US phone number, optionally prefixed with 1.`,
          true,
        );
      }
      if (
        assignment?.sourceField &&
        assignment.transform?.startsWith("date_") &&
        text(getRosterSourceValue(rowSource, assignment.sourceField!))?.trim() &&
        value === null
      ) {
        appendIssue(
          issues,
          rowKey,
          "date_invalid",
          column.key,
          `“${column.header}” does not contain a valid calendar date.`,
          true,
        );
      }
    }

    if (!isValidNpi(text(provider.npi))) {
      appendIssue(
        issues,
        rowKey,
        "provider_npi_invalid",
        "provider.npi",
        "Provider NPI must be exactly 10 digits and pass the NPI Luhn check.",
        true,
      );
    }
    if (locationRequired && !facility) {
      appendIssue(
        issues,
        rowKey,
        "location_assignment_missing",
        "facility.id",
        "The provider is not assigned to a selected active location.",
        false,
      );
    }
    if (locationRequired && facility) {
      if (!nonblank(text(facility.street))) {
        appendIssue(
          issues,
          rowKey,
          "facility_street_missing",
          "facility.street",
          "The selected practice location needs a street address.",
          true,
        );
      }
      if (!nonblank(text(facility.city))) {
        appendIssue(
          issues,
          rowKey,
          "facility_city_missing",
          "facility.city",
          "The selected practice location needs a city.",
          true,
        );
      }
      if (!nonblank(text(facility.state))) {
        appendIssue(
          issues,
          rowKey,
          "facility_state_missing",
          "facility.state",
          "The selected practice location needs a state.",
          true,
        );
      }
      if (!isZipPlus4(text(facility.zip))) {
        appendIssue(
          issues,
          rowKey,
          "facility_zip_plus_4_invalid",
          "facility.zip",
          "The selected practice location needs a ZIP+4 value (12345-6789).",
          true,
        );
      }
    }
    if (facility?.is_active === false) {
      appendIssue(
        issues,
        rowKey,
        "location_inactive",
        "facility.id",
        "The selected location is inactive.",
        false,
      );
    }
    if (
      (hasGroupFields || input.mapping.grain === "provider_location_tin") &&
      (!group ||
        (facility && facility.group_id !== group.id) ||
        !input.mapping.selectedGroupIds.includes(String(group.id)))
    ) {
      appendIssue(
        issues,
        rowKey,
        "billing_group_unassigned",
        "group.tin",
        "The selected location has no active, selected provider group assignment for its billing identity.",
        false,
      );
    }
    if (group?.is_active === false) {
      appendIssue(
        issues,
        rowKey,
        "billing_group_inactive",
        "group.id",
        "The selected billing group is inactive.",
        false,
      );
    }
    if (
      facility &&
      locationRequired &&
      !isCurrentLicense(selectedLicense, input.validationDate, state)
    ) {
      appendIssue(
        issues,
        rowKey,
        "active_state_license_missing",
        "license.license_number",
        `No active state license matches the selected location’s ${state ?? "unknown"} state.`,
        true,
      );
    }

    rows.push({ rowKey, providerLabel, facilityLabel, groupLabel, values });
    outputRows.push(input.template.columns.map((column) => values[column.key] ?? ""));
  }

  for (const issue of issues) {
    if (issue.severity !== "hard_error" || !issue.overrideable) continue;
    const matching = activeOverrides.find(
      (override) =>
        override.rowKey === issue.rowKey &&
        override.ruleCode === issue.ruleCode &&
        override.fieldKey === issue.fieldKey,
    );
    if (matching) {
      issue.overrideId = matching.id;
      issue.overrideReason = matching.reason;
    }
  }
  const hardErrorCount = issues.filter(
    (issue) => issue.severity === "hard_error" && !issue.overrideId,
  ).length;
  const overriddenErrorCount = issues.filter(
    (issue) => issue.severity === "hard_error" && issue.overrideId,
  ).length;
  const preview: RosterPreview = {
    mappingId: input.mapping.id,
    revision: input.mapping.revision,
    inputFingerprint: input.inputFingerprint,
    rowCount: rows.length,
    rows,
  };
  const validation: RosterValidationResult = {
    mappingId: input.mapping.id,
    revision: input.mapping.revision,
    inputFingerprint: input.inputFingerprint,
    rowCount: rows.length,
    issues,
    hardErrorCount,
    overriddenErrorCount,
    exportable: rows.length > 0 && hardErrorCount === 0,
  };
  return {
    preview,
    validation,
    headers: input.template.columns.map((column) => column.header),
    outputRows,
  };
}
