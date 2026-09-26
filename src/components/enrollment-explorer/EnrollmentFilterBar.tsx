import React, { useEffect, useState } from "react";
import { Search, X, Download, Users, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EnrollmentCatalogFacility, EnrollmentCatalogGroup, EnrollmentMatrixStats } from "@/types";
import { CLINICAL_DISCIPLINES, DISCIPLINE_LABELS, type ProviderDiscipline } from "@/lib/providerDiscipline";

export interface EnrollmentFiltersState {
  search: string;
  groupId: string;
  facilityId: string;
  discipline: string;
  statusBucket: string;
}

interface EnrollmentFilterBarProps {
  filters: EnrollmentFiltersState;
  onFiltersChange: (newFilters: EnrollmentFiltersState) => void;
  groups: EnrollmentCatalogGroup[];
  facilities: EnrollmentCatalogFacility[];
  stats: EnrollmentMatrixStats;
  isClient: boolean;
  onExportCsv: () => void;
  exporting?: boolean;
}

export const STATUS_BUCKET_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "approved", label: "In Network / Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "action_required", label: "Action Required / Blocked" },
] as const;

export function EnrollmentFilterBar({
  filters,
  onFiltersChange,
  groups,
  facilities,
  stats,
  isClient,
  onExportCsv,
  exporting = false,
}: EnrollmentFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search);

  // 200ms debounce on search query input
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput !== filters.search) {
        onFiltersChange({ ...filters, search: searchInput });
      }
    }, 200);
    return () => clearTimeout(handler);
  }, [searchInput, filters, onFiltersChange]);

  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (filters.groupId && filters.groupId !== "all" ? 1 : 0) +
    (filters.facilityId && filters.facilityId !== "all" ? 1 : 0) +
    (filters.discipline && filters.discipline !== "all" ? 1 : 0) +
    (filters.statusBucket && filters.statusBucket !== "all" ? 1 : 0);

  const clearAllFilters = () => {
    setSearchInput("");
    onFiltersChange({
      search: "",
      groupId: isClient && groups.length === 1 ? groups[0].id : "all",
      facilityId: "all",
      discipline: "all",
      statusBucket: "all",
    });
  };

  return (
    <div className="space-y-4">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total Clinicians */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Total Clinicians
            </div>
            <div className="text-[18px] font-semibold tracking-tight text-foreground" data-testid="kpi-total-clinicians">
              {(stats?.totalClinicians ?? 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Active Enrollments */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Active In-Network
            </div>
            <div className="text-[18px] font-semibold tracking-tight text-foreground" data-testid="kpi-active-enrollments">
              {(stats?.activeEnrollments ?? 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Pending Payer Action */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--mp-info-tint)] text-[var(--mp-info-ink)]">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Pending Payer
            </div>
            <div className="text-[18px] font-semibold tracking-tight text-foreground" data-testid="kpi-pending-payer">
              {(stats?.pendingPayerAction ?? 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Actionable Client Blockers */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Action Required
            </div>
            <div className="text-[18px] font-semibold tracking-tight text-foreground" data-testid="kpi-actionable-blockers">
              {(stats?.actionableClientBlockers ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border bg-card p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[300px]">
          {/* Quick Search */}
          <div className="relative w-full sm:w-[240px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search clinician or NPI…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8 pr-7 h-9 text-[13px]"
              data-testid="filter-search-input"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  onFiltersChange({ ...filters, search: "" });
                }}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {/* Provider Group Selector */}
          <Select
            value={filters.groupId}
            onValueChange={(val) => onFiltersChange({ ...filters, groupId: val })}
            disabled={isClient && groups.length <= 1}
          >
            <SelectTrigger className="h-9 w-[180px] text-[13px]" data-testid="filter-group-select">
              <SelectValue placeholder="All Provider Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Provider Groups</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Facility Selector */}
          <Select
            value={filters.facilityId}
            onValueChange={(val) => onFiltersChange({ ...filters, facilityId: val })}
          >
            <SelectTrigger className="h-9 w-[180px] text-[13px]" data-testid="filter-facility-select">
              <SelectValue placeholder="All Facilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Facilities</SelectItem>
              {facilities.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Discipline Selector */}
          <Select
            value={filters.discipline}
            onValueChange={(val) => onFiltersChange({ ...filters, discipline: val })}
          >
            <SelectTrigger className="h-9 w-[150px] text-[13px]" data-testid="filter-discipline-select">
              <SelectValue placeholder="All Disciplines" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Disciplines</SelectItem>
              {CLINICAL_DISCIPLINES.map((d: ProviderDiscipline) => (
                <SelectItem key={d} value={d}>
                  {DISCIPLINE_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Bucket Selector */}
          <Select
            value={filters.statusBucket}
            onValueChange={(val) => onFiltersChange({ ...filters, statusBucket: val })}
          >
            <SelectTrigger className="h-9 w-[180px] text-[13px]" data-testid="filter-status-select">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_BUCKET_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Active Filter Clear */}
          {activeFilterCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="h-9 px-2 text-[12px] text-muted-foreground hover:text-foreground"
              data-testid="filter-clear-all"
            >
              Clear all ({activeFilterCount})
            </Button>
          ) : null}
        </div>

        {/* CSV Export Action */}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-[12px] font-medium"
          onClick={onExportCsv}
          disabled={exporting}
          data-testid="export-csv-button"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
    </div>
  );
}
