import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useRosterPreview,
  useRosterValidation,
  useSaveRosterOverride,
} from "@/hooks/useRosterEngine";
import { useCanWrite } from "@/lib/permissions";
import type { RosterMappingDetail, RosterPreviewRow, RosterValidationIssue } from "@/types";
import { RosterEmpty, RosterError, RosterLoading, RosterStatus } from "./shared";

function issueKey(issue: RosterValidationIssue) {
  return `${issue.rowKey}:${issue.ruleCode}:${issue.fieldKey}`;
}

function issueRowLabel(rowKey: string, rowsByKey: Map<string, RosterPreviewRow>) {
  const row = rowsByKey.get(rowKey);
  if (row) {
    const label = [row.providerLabel, row.facilityLabel, row.groupLabel]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" · ");
    if (label) return label;
  }
  if (rowKey === "__scope__") return "Roster scope";
  if (rowKey === "__mapping__") return "Mapping scope";
  if (rowKey === "__template__") return "Template schema";
  return rowKey || "Roster row";
}

export function RosterValidationWorkspace({ detail }: { detail: RosterMappingDetail }) {
  const canWrite = useCanWrite();
  const validationQ = useRosterValidation(detail.mapping.id);
  const previewQ = useRosterPreview(detail.mapping.id);
  const saveOverride = useSaveRosterOverride(detail.mapping.id);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const validation = validationQ.data;
  const preview = previewQ.data;
  const current = Boolean(
    validation &&
    validation.revision === detail.mapping.revision &&
    preview &&
    preview.revision === validation.revision &&
    preview.inputFingerprint === validation.inputFingerprint,
  );

  const filteredIssues = useMemo(
    () =>
      (validation?.issues ?? []).filter((issue) => !errorsOnly || issue.severity === "hard_error"),
    [errorsOnly, validation?.issues],
  );
  const selectedIssue =
    filteredIssues.find((issue) => issueKey(issue) === selectedKey) ?? filteredIssues[0];
  const rowsByKey = useMemo(
    () => new Map((preview?.rows ?? []).map((row) => [row.rowKey, row])),
    [preview?.rows],
  );
  const reasonLength = reason.trim().length;
  const canOverride = Boolean(
    canWrite &&
    current &&
    selectedIssue &&
    selectedIssue.severity === "hard_error" &&
    selectedIssue.overrideable &&
    !selectedIssue.overrideId &&
    reasonLength >= 20 &&
    !saveOverride.isPending,
  );

  if (validationQ.isLoading || previewQ.isLoading) return <RosterLoading />;
  if (validationQ.isError) {
    return <RosterError error={validationQ.error} retry={() => void validationQ.refetch()} />;
  }
  if (!validation)
    return (
      <RosterEmpty
        title="Validation is unavailable"
        description="Run validation again after confirming the mapping scope."
      />
    );

  function refreshCurrentInputs() {
    void Promise.all([previewQ.refetch(), validationQ.refetch()]);
  }

  function recordOverride() {
    if (!canOverride || !selectedIssue || !validation) return;
    saveOverride.mutate(
      {
        expectedRevision: validation.revision,
        inputFingerprint: validation.inputFingerprint,
        rowKey: selectedIssue.rowKey,
        ruleCode: selectedIssue.ruleCode,
        fieldKey: selectedIssue.fieldKey,
        reason: reason.trim(),
      },
      {
        onSuccess: () => setReason(""),
      },
    );
  }

  const canExport = current && validation.exportable;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <div className="text-[13px] font-semibold">{detail.mapping.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {validation.rowCount} output rows · revision {validation.revision}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RosterStatus tone={canExport ? "success" : "danger"}>
            {canExport ? "Export ready" : current ? "Export blocked" : "Validation stale"}
          </RosterStatus>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshCurrentInputs}
            disabled={validationQ.isFetching || previewQ.isFetching}
          >
            <RefreshCw
              className={validationQ.isFetching || previewQ.isFetching ? "animate-spin" : ""}
            />
            Refresh validation
          </Button>
          {canExport ? (
            <Button asChild size="sm">
              <Link to="/reporting/rosters/export/$id" params={{ id: detail.mapping.id }}>
                Export <ArrowRight />
              </Link>
            </Button>
          ) : (
            <Button size="sm" disabled>
              Export <ArrowRight />
            </Button>
          )}
        </div>
      </div>

      {previewQ.isError ? (
        <RosterError error={previewQ.error} retry={() => void previewQ.refetch()} />
      ) : null}
      {!current ? (
        <div className="rounded-md border border-border p-3 text-[12px] text-muted-foreground">
          The mapping or source rows changed while validation was loading. Refresh validation before
          recording an override or exporting.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Count label="Rows" value={validation.rowCount} />
        <Count
          label="Hard errors"
          value={validation.hardErrorCount}
          tone={validation.hardErrorCount > 0 ? "danger" : "success"}
        />
        <Count label="Overrides" value={validation.overriddenErrorCount} />
        <Count label="All issues" value={validation.issues.length} />
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border py-2">
        <div>
          <h2 className="text-[14px] font-semibold">Validation issues</h2>
          <p className="text-[12px] text-muted-foreground">
            Select an issue to inspect its row, field, and override history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="errors-only" className="text-[12px]">
            Errors only
          </Label>
          <Switch id="errors-only" checked={errorsOnly} onCheckedChange={setErrorsOnly} />
        </div>
      </div>

      {validation.issues.length === 0 ? (
        <RosterEmpty
          title="No validation issues"
          description="The current output rows passed the configured roster checks."
        />
      ) : filteredIssues.length === 0 ? (
        <RosterEmpty
          title="No hard errors"
          description="Turn off Errors only to inspect warnings for this roster."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 min-w-36">Provider row</TableHead>
                  <TableHead className="h-9 min-w-28">Field</TableHead>
                  <TableHead className="h-9 min-w-24">Severity</TableHead>
                  <TableHead className="h-9 min-w-64">Issue</TableHead>
                  <TableHead className="h-9 min-w-32">Resolution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredIssues.map((issue) => {
                  const key = issueKey(issue);
                  const isSelected = selectedIssue ? issueKey(selectedIssue) === key : false;
                  return (
                    <TableRow
                      key={key}
                      className={`h-10 cursor-pointer ${isSelected ? "bg-muted" : ""}`}
                      onClick={() => setSelectedKey(key)}
                      aria-selected={isSelected}
                    >
                      <TableCell className="max-w-48 truncate text-[12px]">
                        {issueRowLabel(issue.rowKey, rowsByKey)}
                      </TableCell>
                      <TableCell className="text-[12px]">{issue.fieldKey}</TableCell>
                      <TableCell>
                        <RosterStatus tone={issue.severity === "hard_error" ? "danger" : "warning"}>
                          {issue.severity === "hard_error" ? "Error" : "Warning"}
                        </RosterStatus>
                      </TableCell>
                      <TableCell className="max-w-80 truncate text-[12px]">
                        {issue.message}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {issue.overrideId
                          ? "Override recorded"
                          : issue.overrideable
                            ? "Reason required"
                            : "Blocked"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {selectedIssue ? (
            <aside className="h-fit rounded-md border border-border p-3 lg:sticky lg:top-4">
              <div className="mb-3 flex items-start gap-2">
                {selectedIssue.severity === "hard_error" ? (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-warn-ink)]" />
                )}
                <div>
                  <h3 className="text-[13px] font-semibold">Issue details</h3>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    {selectedIssue.message}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-1 border-y border-border py-2 text-[11px]">
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="truncate">{issueRowLabel(selectedIssue.rowKey, rowsByKey)}</dd>
                <dt className="text-muted-foreground">Field</dt>
                <dd className="break-all">{selectedIssue.fieldKey}</dd>
                <dt className="text-muted-foreground">Rule</dt>
                <dd>{selectedIssue.ruleCode}</dd>
                <dt className="text-muted-foreground">Severity</dt>
                <dd>{selectedIssue.severity === "hard_error" ? "Hard error" : "Warning"}</dd>
              </dl>
              {selectedIssue.overrideId ? (
                <div className="mt-3 rounded-md border border-border p-2 text-[12px]">
                  <div className="flex items-center gap-1.5 font-medium text-[var(--mp-ok-ink)]">
                    <CheckCircle2 className="h-4 w-4" /> Override recorded
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {selectedIssue.overrideReason}
                  </p>
                </div>
              ) : selectedIssue.severity === "hard_error" && selectedIssue.overrideable ? (
                <div className="mt-3 space-y-2">
                  <Label htmlFor="override-reason" className="text-[12px] font-medium">
                    Audited override reason
                  </Label>
                  <Textarea
                    id="override-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain why this specific hard error is accepted for this export."
                    className="min-h-24 text-[12px]"
                    disabled={!canWrite || !current || saveOverride.isPending}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[11px] ${reasonLength < 20 ? "text-muted-foreground" : "text-[var(--mp-ok-ink)]"}`}
                    >
                      {reasonLength}/20 characters minimum
                    </span>
                    <Button size="sm" onClick={recordOverride} disabled={!canOverride}>
                      {saveOverride.isPending ? "Recording…" : "Record override"}
                    </Button>
                  </div>
                  {!canWrite ? (
                    <p className="text-[11px] text-muted-foreground">
                      Billing members cannot record overrides.
                    </p>
                  ) : null}
                  {saveOverride.isError ? (
                    <p role="alert" className="text-[11px] text-destructive">
                      {saveOverride.error.message}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  This issue does not allow an override. Resolve the source data or mapping before
                  export.
                </p>
              )}
            </aside>
          ) : null}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button asChild variant="outline">
          <Link to="/reporting/rosters/mapping/$id" params={{ id: detail.mapping.id }}>
            Back to mapping
          </Link>
        </Button>
        {canExport ? (
          <Button asChild>
            <Link to="/reporting/rosters/export/$id" params={{ id: detail.mapping.id }}>
              Continue to export <ArrowRight />
            </Link>
          </Button>
        ) : (
          <Button disabled>
            Continue to export <ArrowRight />
          </Button>
        )}
      </div>
      {!canWrite ? (
        <p className="text-[12px] text-muted-foreground">
          Billing members can review validation results but cannot record overrides or export files.
        </p>
      ) : null}
    </div>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "success";
}) {
  const color =
    tone === "danger"
      ? "text-destructive"
      : tone === "success"
        ? "text-[var(--mp-ok-ink)]"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-[18px] font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
