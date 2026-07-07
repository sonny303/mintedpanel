// Admin → Import: CSV onboarding-package wizard (Epic 2c, P6). Admin-only.
// Three file inputs (facilities / providers / assignments) → a Parse step that
// runs the pure src/lib/csvImport core and shows a preview + a distinct
// line-numbered errors list → a reference_only toggle (default on) → a Commit
// step that writes through the existing create services and reports
// created/failed counts. No LLM/AI ingestion: the whole path is deterministic.
import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileWarning, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useIsAdmin } from "@/lib/permissions";
import { useActiveOrgId } from "@/lib/auth-store";
import { useProviderGroups } from "@/hooks/useLookups";
import { parseImportPackage, type CsvImportResult } from "@/lib/csvImport";
import { commitImport, type CommitSummary } from "@/services/importCommit";

export const Route = createFileRoute("/admin/import")({
  component: AdminImportPage,
});

type FileSlot = "facilitiesCsv" | "providersCsv" | "assignmentsCsv";

const FILE_SLOTS: { slot: FileSlot; label: string; hint: string }[] = [
  {
    slot: "facilitiesCsv",
    label: "facilities.csv",
    hint: "ref, name, group_name, street, city, state, zip",
  },
  {
    slot: "providersCsv",
    label: "providers.csv",
    hint: "ref, first_name, last_name, npi, email, home_state, license_state, license_states…",
  },
  {
    slot: "assignmentsCsv",
    label: "provider_facility_assignments.csv",
    hint: "provider_ref, facility_ref, is_primary",
  },
];

interface FileState {
  name: string;
  text: string;
}

function FileInputRow({
  label,
  hint,
  file,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  file: FileState | null;
  onPick: (name: string, text: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-between gap-4 border border-[#E8E5E0] rounded-md bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="text-[12px] text-muted-foreground truncate">{file ? file.name : hint}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {file ? (
          <Button variant="outline" className="h-8" onClick={onClear}>
            Remove
          </Button>
        ) : null}
        <Button variant="outline" className="h-8" onClick={() => inputRef.current?.click()}>
          <Upload className="w-4 h-4 mr-1" />
          {file ? "Replace" : "Choose"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f.name, await f.text());
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function CountsBadge({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#E8E5E0] bg-[#FAFAF9] px-2.5 py-0.5 text-[12px] text-foreground">
      <span className="font-medium tabular-nums">{n}</span> {label}
    </span>
  );
}

function AdminImportPage() {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  const groupsQ = useProviderGroups();

  const [files, setFiles] = useState<Record<FileSlot, FileState | null>>({
    facilitiesCsv: null,
    providersCsv: null,
    assignmentsCsv: null,
  });
  const [parsed, setParsed] = useState<CsvImportResult | null>(null);
  const [referenceOnly, setReferenceOnly] = useState(true);
  const [summary, setSummary] = useState<CommitSummary | null>(null);

  const anyFile = Boolean(files.facilitiesCsv || files.providersCsv || files.assignmentsCsv);

  const commit = useMutation({
    mutationFn: () =>
      commitImport(parsed as CsvImportResult, {
        referenceOnly,
        groups: groupsQ.data ?? [],
      }),
    onSuccess: (result) => {
      setSummary(result);
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
      qc.invalidateQueries({ queryKey: ["facilities", orgId] });
      qc.invalidateQueries({ queryKey: ["facility-assignments", orgId] });
      const created =
        result.facilities.created + result.providers.created + result.assignments.created;
      const failed = result.facilities.failed + result.providers.failed + result.assignments.failed;
      if (failed === 0) toast.success(`Imported ${created} record${created === 1 ? "" : "s"}`);
      else toast.warning(`Imported ${created}, ${failed} failed — see the summary`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Import failed"),
  });

  const rowTotal = useMemo(
    () =>
      parsed ? parsed.facilities.length + parsed.providers.length + parsed.assignments.length : 0,
    [parsed],
  );

  function runParse() {
    setSummary(null);
    setParsed(
      parseImportPackage({
        facilitiesCsv: files.facilitiesCsv?.text ?? null,
        providersCsv: files.providersCsv?.text ?? null,
        assignmentsCsv: files.assignmentsCsv?.text ?? null,
      }),
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Import" />
        <div className="border border-[#E8E5E0] rounded-md bg-white p-6">
          <EmptyState
            message="Import is available to admins."
            description="Ask an admin if you need to onboard data."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Import"
        description="Onboard existing facilities, providers, and assignments from a CSV package."
      />

      {/* Step 1 — files */}
      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold text-foreground">1. Choose files</h2>
        {FILE_SLOTS.map(({ slot, label, hint }) => (
          <FileInputRow
            key={slot}
            label={label}
            hint={hint}
            file={files[slot]}
            onPick={(name, text) => {
              setFiles((f) => ({ ...f, [slot]: { name, text } }));
              setParsed(null);
              setSummary(null);
            }}
            onClear={() => {
              setFiles((f) => ({ ...f, [slot]: null }));
              setParsed(null);
              setSummary(null);
            }}
          />
        ))}
        <div>
          <Button
            onClick={runParse}
            disabled={!anyFile}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
          >
            Parse & preview
          </Button>
        </div>
      </section>

      {/* Step 2 — preview + errors */}
      {parsed ? (
        <section className="space-y-4">
          <h2 className="text-[14px] font-semibold text-foreground">2. Preview</h2>
          <div className="flex flex-wrap gap-2">
            <CountsBadge label="facilities" n={parsed.facilities.length} />
            <CountsBadge label="providers" n={parsed.providers.length} />
            <CountsBadge label="assignments" n={parsed.assignments.length} />
            <CountsBadge label="errors" n={parsed.errors.length} />
          </div>

          {parsed.errors.length > 0 ? (
            <div className="border border-[#FCA5A5] bg-[#FEF2F2] rounded-md overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-[#B91C1C] border-b border-[#FCA5A5]">
                <FileWarning className="w-4 h-4" />
                {parsed.errors.length} row{parsed.errors.length === 1 ? "" : "s"} need attention
              </div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#B91C1C]">
                      <th className="px-4 py-1.5 font-medium">File</th>
                      <th className="px-4 py-1.5 font-medium">Line</th>
                      <th className="px-4 py-1.5 font-medium">Column</th>
                      <th className="px-4 py-1.5 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.errors.map((e, i) => (
                      <tr key={i} className="border-t border-[#FCA5A5]/50 text-[#7F1D1D]">
                        <td className="px-4 py-1.5 whitespace-nowrap">{e.file}</td>
                        <td className="px-4 py-1.5 tabular-nums">{e.line}</td>
                        <td className="px-4 py-1.5 whitespace-nowrap">{e.column ?? "—"}</td>
                        <td className="px-4 py-1.5">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <PreviewTable
            title="Facilities"
            columns={["Name", "State", "Group", "Line"]}
            rows={parsed.facilities.map((f) => [
              f.input.name,
              f.input.state ?? "—",
              f.groupName ?? "—",
              String(f.line),
            ])}
          />
          <PreviewTable
            title="Providers"
            columns={["Name", "NPI", "Email", "Licenses", "Line"]}
            rows={parsed.providers.map((p) => [
              `${p.input.firstName} ${p.input.lastName}`,
              p.input.npi ?? "—",
              p.input.email ?? "—",
              String(p.licenses.length),
              String(p.line),
            ])}
          />
          <PreviewTable
            title="Assignments"
            columns={["Provider ref", "Facility ref", "Primary", "Line"]}
            rows={parsed.assignments.map((a) => [
              a.providerRef,
              a.facilityRef,
              a.isPrimary ? "Yes" : "No",
              String(a.line),
            ])}
          />
        </section>
      ) : null}

      {/* Step 3 — commit */}
      {parsed && rowTotal > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[14px] font-semibold text-foreground">3. Commit</h2>
          <div className="flex items-center justify-between gap-4 border border-[#E8E5E0] rounded-md bg-white px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor="reference-only" className="text-[13px] font-medium text-foreground">
                Mark imported rows as reference-only
              </Label>
              <p className="text-[12px] text-muted-foreground">
                Reference rows are visible but skipped by the action engine and Fix-it queue. Turn
                off to onboard rows you intend to actively work.
              </p>
            </div>
            <Switch
              id="reference-only"
              checked={referenceOnly}
              onCheckedChange={setReferenceOnly}
            />
          </div>

          {parsed.errors.length > 0 ? (
            <div className="border border-[#FDE68A] bg-[#FEF3C7] text-[#92400E] rounded-md px-4 py-3 text-[13px]">
              Rows with errors above are excluded from the import. Only the {rowTotal} previewed row
              {rowTotal === 1 ? "" : "s"} will be committed.
            </div>
          ) : null}

          <Button
            onClick={() => commit.mutate()}
            disabled={commit.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
          >
            {commit.isPending ? "Importing…" : `Import ${rowTotal} row${rowTotal === 1 ? "" : "s"}`}
          </Button>
        </section>
      ) : null}

      {/* Result summary */}
      {summary ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <CheckCircle2 className="w-4 h-4 text-[#1B4D3E]" /> Result
          </h2>
          <div className="flex flex-wrap gap-2">
            <CountsBadge label="facilities created" n={summary.facilities.created} />
            <CountsBadge label="providers created" n={summary.providers.created} />
            <CountsBadge label="assignments created" n={summary.assignments.created} />
            <CountsBadge
              label="failed"
              n={summary.facilities.failed + summary.providers.failed + summary.assignments.failed}
            />
          </div>
          {summary.failures.length > 0 ? (
            <div className="border border-[#FCA5A5] bg-[#FEF2F2] rounded-md overflow-hidden">
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#B91C1C]">
                      <th className="px-4 py-1.5 font-medium">File</th>
                      <th className="px-4 py-1.5 font-medium">Line</th>
                      <th className="px-4 py-1.5 font-medium">Row</th>
                      <th className="px-4 py-1.5 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.failures.map((f, i) => (
                      <tr key={i} className="border-t border-[#FCA5A5]/50 text-[#7F1D1D]">
                        <td className="px-4 py-1.5 whitespace-nowrap">{f.file}</td>
                        <td className="px-4 py-1.5 tabular-nums">{f.line}</td>
                        <td className="px-4 py-1.5">{f.label}</td>
                        <td className="px-4 py-1.5">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function PreviewTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: string[][];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="border border-[#E8E5E0] rounded-md overflow-hidden bg-white">
      <div className="px-4 py-2 text-[13px] font-medium text-foreground bg-[#FAFAF9] border-b border-[#E8E5E0]">
        {title}
        <span className="ml-1 text-muted-foreground tabular-nums">({rows.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0] text-left text-muted-foreground">
              {columns.map((c) => (
                <th key={c} className="px-4 py-1.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-[#E8E5E0]">
                {r.map((cell, j) => (
                  <td key={j} className="px-4 py-1.5 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
