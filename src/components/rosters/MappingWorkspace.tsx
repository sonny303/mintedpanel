import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRosterPreview, useUpdateRosterMapping } from "@/hooks/useRosterEngine";
import { useCanWrite } from "@/lib/permissions";
import {
  getRosterSourceFieldsForTarget,
  getRosterTransformsForTarget,
  ROSTER_GRAIN_LABELS,
  ROSTER_SOURCE_FIELDS,
  ROSTER_TRANSFORM_OPTIONS,
} from "@/lib/rosterTransforms";
import type {
  RosterColumnAssignment,
  RosterGrain,
  RosterMappingDetail,
  RosterSourceField,
  RosterTransform,
} from "@/types";
import { RosterEmpty, RosterError, RosterLoading, RosterStatus } from "./shared";

const NONE = "__none__";

type Draft = {
  name: string;
  grain: RosterGrain;
  selectedProviderIds: string[];
  selectedFacilityIds: string[];
  selectedGroupIds: string[];
  columnAssignments: RosterColumnAssignment[];
};

function draftFromDetail(detail: RosterMappingDetail): Draft {
  const { mapping, template } = detail;
  return {
    name: mapping.name,
    grain: mapping.grain,
    selectedProviderIds: mapping.selectedProviderIds,
    selectedFacilityIds: mapping.selectedFacilityIds,
    selectedGroupIds: mapping.selectedGroupIds,
    columnAssignments: template.columns.map(
      (column) =>
        mapping.columnAssignments.find((assignment) => assignment.columnKey === column.key) ?? {
          columnKey: column.key,
          sourceField: null,
          transform: null,
        },
    ),
  };
}

function toggleId(values: string[], id: string, checked: boolean) {
  return checked ? Array.from(new Set([...values, id])) : values.filter((value) => value !== id);
}

function SourceChecklist({
  title,
  description,
  options,
  selected,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  options: Array<{ id: string; label: string; details?: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter((option) =>
    `${option.label} ${option.details ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <section className="min-w-0 rounded-md border border-border p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">{title}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        <RosterStatus>{selected.length} selected</RosterStatus>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={`Search ${title.toLowerCase()}`}
        aria-label={`Search ${title.toLowerCase()}`}
        className="mb-2 h-8 text-[12px]"
        disabled={disabled}
      />
      <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-muted-foreground">
            {options.length === 0 ? "No records are available." : "No records match this search."}
          </p>
        ) : (
          filtered.map((option) => (
            <label
              key={option.id}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <Checkbox
                checked={selected.includes(option.id)}
                onCheckedChange={(checked) =>
                  onChange(toggleId(selected, option.id, checked === true))
                }
                disabled={disabled}
              />
              <span className="min-w-0 flex-1 truncate text-[12px]">{option.label}</span>
              {option.details ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">{option.details}</span>
              ) : null}
            </label>
          ))
        )}
      </div>
    </section>
  );
}

export function MappingWorkspace({ detail }: { detail: RosterMappingDetail }) {
  const canWrite = useCanWrite();
  const update = useUpdateRosterMapping(detail.mapping.id);
  const previewQ = useRosterPreview(detail.mapping.id);
  const [draft, setDraft] = useState(() => draftFromDetail(detail));
  const savedDraft = useMemo(() => draftFromDetail(detail), [detail]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const template = detail.template;
  const hasFacilityFields = draft.columnAssignments.some((item) =>
    item.sourceField?.startsWith("facility."),
  );
  const hasLicenseFields = draft.columnAssignments.some((item) =>
    item.sourceField?.startsWith("license."),
  );
  const hasGroupFields = draft.columnAssignments.some((item) =>
    item.sourceField?.startsWith("group."),
  );
  const grainNeedsLocation = draft.grain !== "provider";
  const needsLocation = grainNeedsLocation || hasFacilityFields || hasLicenseFields;
  const needsGroup = draft.grain === "provider_location_tin" || hasGroupFields;
  const canPreviewMapping =
    draft.selectedProviderIds.length > 0 &&
    (!needsLocation || draft.selectedFacilityIds.length > 0) &&
    (!needsGroup || draft.selectedGroupIds.length > 0);

  function patch(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateColumn(columnKey: string, patchValue: Partial<RosterColumnAssignment>) {
    setDraft((current) => ({
      ...current,
      columnAssignments: current.columnAssignments.map((assignment) =>
        assignment.columnKey === columnKey ? { ...assignment, ...patchValue } : assignment,
      ),
    }));
  }

  function save() {
    update.mutate({
      expectedRevision: detail.mapping.revision,
      name: draft.name.trim(),
      grain: draft.grain,
      selectedProviderIds: draft.selectedProviderIds,
      selectedFacilityIds: draft.selectedFacilityIds,
      selectedGroupIds: draft.selectedGroupIds,
      columnAssignments: draft.columnAssignments,
    });
  }

  const providerOptions = detail.sourceOptions.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    details: provider.npi ? `NPI ${provider.npi}` : undefined,
  }));
  const facilityOptions = detail.sourceOptions.facilities.map((facility) => ({
    id: facility.id,
    label: facility.label,
    details: [facility.state, facility.groupLabel].filter(Boolean).join(" · ") || undefined,
  }));
  const groupOptions = detail.sourceOptions.groups.map((group) => ({
    id: group.id,
    label: group.label,
    details: group.tin ? `TIN ····${group.tin.slice(-4)}` : undefined,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="mapping-name" className="text-[11px] text-muted-foreground">
            Mapping name
          </Label>
          <Input
            id="mapping-name"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            className="mt-1 h-9 max-w-lg text-[13px]"
            disabled={!canWrite}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RosterStatus>{ROSTER_GRAIN_LABELS[draft.grain]}</RosterStatus>
          <RosterStatus>Revision {detail.mapping.revision}</RosterStatus>
          <Button
            disabled={!canWrite || !dirty || !draft.name.trim() || update.isPending}
            onClick={save}
            size="sm"
            title={canWrite ? undefined : "Billing members have read-only access."}
          >
            {update.isPending ? (
              "Saving…"
            ) : update.isSuccess && !dirty ? (
              <>
                <Check /> Saved
              </>
            ) : (
              <>
                <Save /> Save mapping
              </>
            )}
          </Button>
        </div>
      </div>
      {update.isError ? <RosterError error={update.error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="min-w-0 space-y-4">
          <section className="space-y-2">
            <div>
              <h2 className="text-[14px] font-semibold">Source scope</h2>
              <p className="text-[12px] text-muted-foreground">
                Choose the exact providers and relationships included. Locations follow their owning
                provider group; they are never cross-multiplied.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="roster-output-grain" className="text-[11px] text-muted-foreground">
                  Output grain
                </Label>
                <Select
                  value={draft.grain}
                  onValueChange={(value) => patch({ grain: value as RosterGrain })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="roster-output-grain" className="h-9 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {template.grains.map((grain) => (
                      <SelectItem key={grain} value={grain}>
                        {ROSTER_GRAIN_LABELS[grain]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <SourceChecklist
                title="Providers"
                description="Required at every grain"
                options={providerOptions}
                selected={draft.selectedProviderIds}
                onChange={(selectedProviderIds) => patch({ selectedProviderIds })}
                disabled={!canWrite}
              />
              <SourceChecklist
                title="Groups"
                description={
                  needsGroup
                    ? "Required to scope the selected group and TIN/NPI"
                    : "Optional group scope for group columns"
                }
                options={groupOptions}
                selected={draft.selectedGroupIds}
                onChange={(selectedGroupIds) => patch({ selectedGroupIds })}
                disabled={!canWrite}
              />
              <SourceChecklist
                title="Locations"
                description={
                  needsLocation
                    ? "Required for this grain or mapped fields"
                    : "Optional facility scope"
                }
                options={facilityOptions}
                selected={draft.selectedFacilityIds}
                onChange={(selectedFacilityIds) => patch({ selectedFacilityIds })}
                disabled={!canWrite}
              />
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-semibold">Field mapping</h2>
                <p className="text-[12px] text-muted-foreground">
                  Connect each payer column to one internal source and an optional deterministic
                  transform.
                </p>
              </div>
              {hasFacilityFields && !grainNeedsLocation ? (
                <RosterStatus tone="warning">
                  Provider grain checks one selected location per provider
                </RosterStatus>
              ) : null}
              {hasLicenseFields && !grainNeedsLocation ? (
                <RosterStatus tone="warning">
                  License validation uses the selected location state
                </RosterStatus>
              ) : null}
              {draft.grain === "provider_location_tin" && draft.selectedGroupIds.length === 0 ? (
                <RosterStatus tone="warning">Select a group to scope the TIN grain</RosterStatus>
              ) : null}
              {hasGroupFields && draft.selectedGroupIds.length === 0 ? (
                <RosterStatus tone="warning">
                  Select a group before mapping group fields
                </RosterStatus>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 min-w-56">Template column</TableHead>
                    <TableHead className="h-9 min-w-[280px]">Source field</TableHead>
                    <TableHead className="h-9 min-w-52">Transform</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {template.columns.map((column) => {
                    const assignment = draft.columnAssignments.find(
                      (item) => item.columnKey === column.key,
                    );
                    return (
                      <TableRow key={column.key} className="h-12">
                        <TableCell>
                          <div className="text-[12px] font-medium">{column.header}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {column.required ? "Required" : "Optional"} · {column.targetType}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={assignment?.sourceField ?? NONE}
                            onValueChange={(value) =>
                              updateColumn(column.key, {
                                sourceField: value === NONE ? null : (value as RosterSourceField),
                              })
                            }
                            disabled={!canWrite}
                          >
                            <SelectTrigger
                              aria-label={`Source for ${column.header}`}
                              className="h-8 w-full text-[12px]"
                            >
                              <SelectValue placeholder="Choose a source field" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Unmapped</SelectItem>
                              {ROSTER_SOURCE_FIELDS.filter((field) =>
                                getRosterSourceFieldsForTarget(column.targetType).includes(
                                  field.value,
                                ),
                              ).map((field) => (
                                <SelectItem key={field.value} value={field.value}>
                                  {field.label}{" "}
                                  <span className="text-muted-foreground">· {field.source}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={assignment?.transform ?? NONE}
                            onValueChange={(value) =>
                              updateColumn(column.key, {
                                transform: value === NONE ? null : (value as RosterTransform),
                              })
                            }
                            disabled={!canWrite}
                          >
                            <SelectTrigger
                              aria-label={`Transform for ${column.header}`}
                              className="h-8 w-full text-[12px]"
                            >
                              <SelectValue placeholder="No transform" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No transform</SelectItem>
                              {ROSTER_TRANSFORM_OPTIONS.filter((transform) =>
                                getRosterTransformsForTarget(column.targetType).includes(
                                  transform.value,
                                ),
                              ).map((transform) => (
                                <SelectItem key={transform.value} value={transform.value}>
                                  {transform.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>

          {!canWrite ? (
            <p className="text-[12px] text-muted-foreground">
              Billing members can inspect mappings and previews; changes require a specialist or
              admin role.
            </p>
          ) : null}

          {dirty ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[12px]">
              <span className="text-muted-foreground">
                Unsaved changes must be saved before preview or validation can use them.
              </span>
              <Button
                size="sm"
                onClick={save}
                disabled={!canWrite || !draft.name.trim() || update.isPending}
              >
                Save mapping <ChevronRight />
              </Button>
            </div>
          ) : null}
        </div>
        <aside className="h-fit min-w-0 xl:sticky xl:top-4">
          <MappingPreview
            detail={detail}
            canPreviewMapping={canPreviewMapping}
            isDirty={dirty}
            previewQ={previewQ}
          />
        </aside>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {dirty ? (
          <Button variant="outline" disabled>
            Review validation <ArrowRight />
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link to="/reporting/rosters/validation/$id" params={{ id: detail.mapping.id }}>
              Review validation <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function MappingPreview({
  detail,
  canPreviewMapping,
  isDirty,
  previewQ,
}: {
  detail: RosterMappingDetail;
  canPreviewMapping: boolean;
  isDirty: boolean;
  previewQ: ReturnType<typeof useRosterPreview>;
}) {
  if (isDirty) {
    return (
      <section className="rounded-md border border-border p-3">
        <h2 className="text-[14px] font-semibold">Output preview</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Save this mapping to refresh the row count and sample.
        </p>
      </section>
    );
  }
  if (!canPreviewMapping) {
    return (
      <section className="rounded-md border border-border p-3">
        <h2 className="text-[14px] font-semibold">Output preview</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Select at least one provider
          {detail.mapping.grain !== "provider" ||
          detail.mapping.columnAssignments.some(
            (assignment) =>
              assignment.sourceField?.startsWith("facility.") ||
              assignment.sourceField?.startsWith("license."),
          )
            ? " and an assigned location for each provider"
            : ""}
          {detail.mapping.grain === "provider_location_tin" ||
          detail.mapping.columnAssignments.some((assignment) =>
            assignment.sourceField?.startsWith("group."),
          )
            ? " and a group for mapped group fields or TIN grain"
            : ""}{" "}
          to calculate the output rows.
        </p>
      </section>
    );
  }
  if (previewQ.isLoading) return <RosterLoading />;
  if (previewQ.isError)
    return <RosterError error={previewQ.error} retry={() => void previewQ.refetch()} />;
  const preview = previewQ.data;
  if (!preview || preview.rowCount === 0) {
    return (
      <RosterEmpty
        title="No output rows for this scope"
        description="Review the selected providers, groups, locations, and grain."
      />
    );
  }
  const displayedColumns = detail.template.columns;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold">Output preview</h2>
          <p className="text-[12px] text-muted-foreground">
            {detail.mapping.selectedProviderIds.length} selected providers produce{" "}
            {preview.rowCount} output rows at {ROSTER_GRAIN_LABELS[detail.mapping.grain]} grain.
          </p>
        </div>
        <RosterStatus>
          {preview.rows.length < preview.rowCount
            ? `Showing ${preview.rows.length} of ${preview.rowCount}`
            : `${preview.rowCount} rows`}
        </RosterStatus>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 min-w-44">Provider / location</TableHead>
              {displayedColumns.map((column) => (
                <TableHead key={column.key} className="h-9 min-w-36">
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.slice(0, 8).map((row) => (
              <TableRow key={row.rowKey} className="h-10">
                <TableCell>
                  <div className="text-[12px] font-medium">{row.providerLabel}</div>
                  {row.facilityLabel || row.groupLabel ? (
                    <div className="text-[10px] text-muted-foreground">
                      {[row.facilityLabel, row.groupLabel].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </TableCell>
                {displayedColumns.map((column) => (
                  <TableCell key={column.key} className="max-w-56 truncate text-[12px]">
                    {row.values[column.key] ?? "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
