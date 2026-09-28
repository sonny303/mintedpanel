import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  useCreateRosterMapping,
  useRosterFacilityOptions,
  useRosterMappings,
  useRosterTemplates,
} from "@/hooks/useRosterEngine";
import { useActiveOrgId } from "@/lib/auth-store";
import { useCanWrite } from "@/lib/permissions";
import { formatRosterDisplayDate } from "@/lib/rosterDisplay";
import { ROSTER_GRAIN_LABELS } from "@/lib/rosterTransforms";
import type { RosterGrain, RosterMapping } from "@/types";
import {
  NoRosterOrganization,
  RosterEmpty,
  RosterError,
  RosterLoading,
  RosterStatus,
} from "./shared";

export function TemplateCatalog() {
  const orgId = useActiveOrgId();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const templatesQ = useRosterTemplates();
  const mappingsQ = useRosterMappings();
  const createMapping = useCreateRosterMapping();
  const facilitiesQ = useRosterFacilityOptions();
  const [grains, setGrains] = useState<Record<string, RosterGrain>>({});
  const [facilityIdsByTemplate, setFacilityIdsByTemplate] = useState<Record<string, string[]>>({});

  function startMapping(templateId: string, templateName: string, grain: RosterGrain) {
    const selectedFacilityIds =
      grain === "provider"
        ? []
        : (facilityIdsByTemplate[templateId] ?? []).filter((id) =>
            facilitiesQ.data?.some((facility) => facility.id === id),
          );
    if (
      grain !== "provider" &&
      (facilitiesQ.isFetching || facilitiesQ.isError || selectedFacilityIds.length === 0)
    )
      return;
    createMapping.mutate(
      {
        templateId,
        name: `${templateName} mapping`,
        grain,
        selectedProviderIds: [],
        selectedFacilityIds,
      },
      {
        onSuccess: (detail) =>
          navigate({ to: "/reporting/rosters/mapping/$id", params: { id: detail.mapping.id } }),
      },
    );
  }

  if (!orgId) return <NoRosterOrganization />;
  if (templatesQ.isLoading) return <RosterLoading />;
  if (templatesQ.isError)
    return <RosterError error={templatesQ.error} retry={() => void templatesQ.refetch()} />;
  const templates = templatesQ.data ?? [];

  if (templates.length === 0) {
    return (
      <RosterEmpty
        title="No roster templates are available"
        description="Template schemas are provisioned by the roster service. Refresh after the catalog is seeded for this organization."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
        <p className="text-[12px] text-muted-foreground">
          Starter schemas are draft references. Confirm each payer’s current workbook before
          submission.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ to: "/reporting/rosters/history" })}
        >
          Export history <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <SavedMappings
        mappings={mappingsQ.data ?? []}
        templates={templates}
        loading={mappingsQ.isLoading}
        error={mappingsQ.error}
        retry={() => void mappingsQ.refetch()}
      />

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 min-w-64">Payer template</TableHead>
              <TableHead className="h-9">Columns</TableHead>
              <TableHead className="h-9 min-w-44">Export grain</TableHead>
              <TableHead className="h-9 min-w-48">Locations</TableHead>
              <TableHead className="h-9 min-w-48">Schema status</TableHead>
              <TableHead className="h-9 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => {
              const grain = grains[template.id] ?? template.grains[0];
              const selectedFacilityIds = facilityIdsByTemplate[template.id] ?? [];
              const validFacilityIds = selectedFacilityIds.filter((id) =>
                facilitiesQ.data?.some((facility) => facility.id === id),
              );
              const isPending =
                createMapping.isPending && createMapping.variables?.templateId === template.id;
              return (
                <TableRow key={template.id} className="h-12">
                  <TableCell>
                    <div className="text-[13px] font-medium">{template.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {template.payerName} · v{template.schemaVersion}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{template.columns.length}</TableCell>
                  <TableCell>
                    <Select
                      value={grain}
                      onValueChange={(value) =>
                        setGrains((current) => ({
                          ...current,
                          [template.id]: value as RosterGrain,
                        }))
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-full max-w-52 text-[12px]"
                        aria-label={`Grain for ${template.name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {template.grains.map((option) => (
                          <SelectItem key={option} value={option}>
                            {ROSTER_GRAIN_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {grain === "provider" ? (
                      <span className="text-[11px] text-muted-foreground">
                        Set in mapping if needed
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!canWrite || facilitiesQ.isFetching || facilitiesQ.isError}
                              aria-label={`Locations for ${template.name}`}
                            >
                              {validFacilityIds.length > 0
                                ? `${validFacilityIds.length} location${validFacilityIds.length === 1 ? "" : "s"} selected`
                                : "Select locations"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="max-h-64 space-y-1 overflow-y-auto p-2 shadow-none"
                          >
                            {(facilitiesQ.data ?? []).length === 0 ? (
                              <p className="p-2 text-[11px] text-muted-foreground">
                                No locations are available in this organization.
                              </p>
                            ) : (
                              facilitiesQ.data?.map((facility) => (
                                <label
                                  key={facility.id}
                                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted"
                                >
                                  <Checkbox
                                    checked={selectedFacilityIds.includes(facility.id)}
                                    onCheckedChange={(checked) =>
                                      setFacilityIdsByTemplate((current) => ({
                                        ...current,
                                        [template.id]:
                                          checked === true
                                            ? [...(current[template.id] ?? []), facility.id]
                                            : (current[template.id] ?? []).filter(
                                                (id) => id !== facility.id,
                                              ),
                                      }))
                                    }
                                  />
                                  <span className="min-w-0 flex-1 truncate text-[12px]">
                                    {facility.name}
                                  </span>
                                  {facility.state ? (
                                    <span className="text-[10px] text-muted-foreground">
                                      {facility.state}
                                    </span>
                                  ) : null}
                                </label>
                              ))
                            )}
                          </PopoverContent>
                        </Popover>
                        {validFacilityIds.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            Select at least one location
                          </p>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {template.verified ? (
                      <RosterStatus tone="success">Payer schema verified</RosterStatus>
                    ) : (
                      <RosterStatus tone="warning">Draft · payer spec pending</RosterStatus>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      disabled={
                        !canWrite ||
                        !grain ||
                        createMapping.isPending ||
                        (grain !== "provider" &&
                          (facilitiesQ.isFetching ||
                            facilitiesQ.isError ||
                            validFacilityIds.length === 0))
                      }
                      onClick={() => grain && startMapping(template.id, template.name, grain)}
                      title={canWrite ? undefined : "Billing members have read-only access."}
                    >
                      {isPending ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <>
                          Map fields <ArrowRight />
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {createMapping.isError ? <RosterError error={createMapping.error} /> : null}
      {facilitiesQ.isError &&
      templates.some((template) => (grains[template.id] ?? template.grains[0]) !== "provider") ? (
        <RosterError error={facilitiesQ.error} retry={() => void facilitiesQ.refetch()} />
      ) : null}
      {!canWrite ? (
        <p className="text-[12px] text-muted-foreground">
          Billing members can review templates and export history. Mapping requires a specialist or
          admin role.
        </p>
      ) : null}
    </div>
  );
}

function SavedMappings({
  mappings,
  templates,
  loading,
  error,
  retry,
}: {
  mappings: RosterMapping[];
  templates: NonNullable<ReturnType<typeof useRosterTemplates>["data"]>;
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const navigate = useNavigate();
  const templateNames = new Map(templates.map((template) => [template.id, template.name]));
  if (error) return <RosterError error={error} retry={retry} />;
  if (loading) return <RosterLoading />;
  if (mappings.length === 0) return null;

  const sortedMappings = [...mappings].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[14px] font-semibold">Saved mappings</h2>
        <p className="text-[12px] text-muted-foreground">
          Continue editing a saved scope and field assignment.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 min-w-64">Mapping</TableHead>
              <TableHead className="h-9 min-w-44">Grain</TableHead>
              <TableHead className="h-9">Providers</TableHead>
              <TableHead className="h-9 min-w-40">Updated</TableHead>
              <TableHead className="h-9 text-right">Continue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedMappings.map((mapping) => (
              <TableRow key={mapping.id} className="h-11">
                <TableCell>
                  <div className="text-[12px] font-medium">{mapping.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {templateNames.get(mapping.templateId) ?? "Roster template"} · revision{" "}
                    {mapping.revision}
                  </div>
                </TableCell>
                <TableCell>
                  <RosterStatus>{ROSTER_GRAIN_LABELS[mapping.grain]}</RosterStatus>
                </TableCell>
                <TableCell className="tabular-nums">{mapping.selectedProviderIds.length}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground">
                  {formatRosterDisplayDate(mapping.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate({ to: "/reporting/rosters/mapping/$id", params: { id: mapping.id } })
                    }
                  >
                    Open <ArrowRight />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
