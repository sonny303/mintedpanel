import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EnrollmentReportFilterChoices, EnrollmentReportFilters as Filters } from "@/types";

const DISCIPLINES = ["PT", "PTA", "OT", "OTA", "SLP", "Other", "Unknown"] as const;
const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  in_review: "In review",
  action_required: "Action required",
  approved: "Approved",
  denied: "Denied",
  not_pursuing: "Not pursuing",
  terminated: "Terminated",
  needs_verification: "Needs verification",
};

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-32 gap-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <Select value={value ?? "all"} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-9 bg-background text-[12px]">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  );
}

export function EnrollmentReportFilters({
  filters,
  choices,
  onChange,
}: {
  filters: Filters;
  choices?: EnrollmentReportFilterChoices;
  onChange: (filters: Filters) => void;
}) {
  const [search, setSearch] = useState(filters.search ?? "");
  useEffect(() => setSearch(filters.search ?? ""), [filters.search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== (filters.search ?? "")) onChange({ ...filters, search: search || undefined });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters, onChange, search]);

  const set = (key: keyof Filters, value: string) =>
    onChange({ ...filters, [key]: value === "all" ? undefined : value });

  return (
    <section aria-label="Enrollment report filters" className="mb-4 rounded-md border bg-card p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <label className="grid gap-1 text-[11px] font-medium text-muted-foreground sm:col-span-2">
          Search providers
          <Input
            aria-label="Search providers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or NPI"
            className="h-9 text-[12px]"
          />
        </label>
        <FilterSelect
          label="Group"
          value={filters.groupId}
          onChange={(value) => set("groupId", value)}
        >
          <SelectItem value="all">All groups</SelectItem>
          {(choices?.groups ?? []).map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect label="State" value={filters.state} onChange={(value) => set("state", value)}>
          <SelectItem value="all">All states</SelectItem>
          {(choices?.states ?? []).map((state) => (
            <SelectItem key={state} value={state}>
              {state}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Facility"
          value={filters.facilityId}
          onChange={(value) => set("facilityId", value)}
        >
          <SelectItem value="all">All facilities</SelectItem>
          {(choices?.facilities ?? [])
            .filter((item) => !filters.groupId || item.groupId === filters.groupId)
            .filter((item) => !filters.state || item.state === filters.state)
            .map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
        </FilterSelect>
        <FilterSelect
          label="Product"
          value={filters.productId}
          onChange={(value) => set("productId", value)}
        >
          <SelectItem value="all">All products</SelectItem>
          {(choices?.products ?? []).map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.payerLabel} · {item.label}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Discipline"
          value={filters.discipline}
          onChange={(value) => set("discipline", value)}
        >
          <SelectItem value="all">All disciplines</SelectItem>
          {DISCIPLINES.map((discipline) => (
            <SelectItem key={discipline} value={discipline}>
              {discipline}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Enrollment status"
          value={filters.status}
          onChange={(value) => set("status", value)}
        >
          <SelectItem value="all">All statuses</SelectItem>
          {(choices?.statuses ?? []).map((status) => (
            <SelectItem key={status} value={status}>
              {STATUS_LABELS[status] ?? status}
            </SelectItem>
          ))}
        </FilterSelect>
      </div>
      <label className="mt-3 inline-flex items-center gap-2 text-[12px] text-foreground">
        <input
          aria-label="Include historical publications"
          type="checkbox"
          checked={Boolean(filters.historical)}
          onChange={(event) =>
            onChange({ ...filters, historical: event.target.checked || undefined })
          }
        />
        Include historical publications
      </label>
    </section>
  );
}
