// The Group Contracts Matrix controls (GCM-11 to GCM-15, GCM-29). Every
// control applies to every specialty table; the component only reports the
// operator's choices, and the derivation in src/lib/groupContractsMatrix.ts
// applies them.
import type { ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CONTRACT_SPECIALTY_LABELS,
  MATRIX_SPECIALTIES,
  type ContractSpecialty,
} from "@/lib/contractSpecialty";
import {
  CONTRACT_STATUS_SHORT_LABELS,
  CONTRACT_STATUS_TONES,
  MATRIX_STATUS_ORDER,
  NO_RECORD_FILTER,
  type ContractsMatrixArrangement,
  type ContractsMatrixGroup,
  type ContractsMatrixStatusFilter,
} from "@/lib/groupContractsMatrix";
import { cn } from "@/lib/utils";
import { ContractToneSwatch } from "./ContractsMatrixCell";

/** Up to this many groups show as chips; more use a checkbox dropdown (GCM-11). */
const GROUP_CHIP_LIMIT = 6;

const CONTROL_LABEL =
  "mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--mp-ink-secondary)]";

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--mp-focus)]",
        pressed
          ? "border-[var(--mp-primary)] bg-[var(--mp-primary-tint)] font-medium text-[var(--mp-primary)]"
          : "border-[var(--mp-border)] bg-[var(--mp-card)] text-[var(--mp-ink)] hover:border-[var(--mp-ink-faint)]",
      )}
    >
      {children}
    </button>
  );
}

export interface ContractsMatrixFiltersProps {
  specialties: readonly ContractSpecialty[];
  onToggleSpecialty: (specialty: ContractSpecialty) => void;
  groupOptions: readonly ContractsMatrixGroup[];
  onToggleGroup: (groupId: string) => void;
  stateOptions: readonly string[];
  /** null = every state. */
  selectedStates: readonly string[] | null;
  onToggleState: (state: string) => void;
  onAllStates: () => void;
  payerSearch: string;
  onPayerSearch: (value: string) => void;
  arrange: ContractsMatrixArrangement;
  onArrange: (value: ContractsMatrixArrangement) => void;
  statusFilter: ContractsMatrixStatusFilter;
  onStatusFilter: (value: ContractsMatrixStatusFilter) => void;
}

export function ContractsMatrixFilters(props: ContractsMatrixFiltersProps) {
  const {
    specialties,
    onToggleSpecialty,
    payerSearch,
    onPayerSearch,
    arrange,
    onArrange,
    statusFilter,
    onStatusFilter,
  } = props;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div role="group" aria-labelledby="contracts-matrix-specialties">
          <span id="contracts-matrix-specialties" className={CONTROL_LABEL}>
            Specialties
          </span>
          <div className="flex flex-wrap gap-2">
            {MATRIX_SPECIALTIES.map((specialty) => {
              const on = specialties.includes(specialty);
              return (
                <FilterChip
                  key={specialty}
                  pressed={on}
                  onClick={() => onToggleSpecialty(specialty)}
                >
                  {on ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                  {CONTRACT_SPECIALTY_LABELS[specialty]}
                </FilterChip>
              );
            })}
          </div>
        </div>

        <GroupsControl {...props} />
        <StatesControl {...props} />

        <div>
          <label htmlFor="contracts-matrix-payer-search" className={CONTROL_LABEL}>
            Payer
          </label>
          <div className="relative w-[220px]">
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--mp-ink-faint)]"
            />
            <Input
              id="contracts-matrix-payer-search"
              type="search"
              className="h-9 pl-8 text-[13px]"
              placeholder="Search payer…"
              value={payerSearch}
              onChange={(e) => onPayerSearch(e.target.value)}
            />
          </div>
        </div>

        <div>
          <span id="contracts-matrix-arrange" className={CONTROL_LABEL}>
            Arrange columns
          </span>
          <Tabs
            value={arrange}
            onValueChange={(value) => onArrange(value === "state" ? "state" : "group")}
          >
            <TabsList aria-labelledby="contracts-matrix-arrange">
              <TabsTrigger value="group">By group</TabsTrigger>
              <TabsTrigger value="state">By state</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div
        role="group"
        aria-labelledby="contracts-matrix-status"
        className="flex flex-wrap items-center gap-2"
      >
        <span
          id="contracts-matrix-status"
          className="mr-1 text-[11px] font-medium uppercase tracking-wider text-[var(--mp-ink-secondary)]"
        >
          Status
        </span>
        <FilterChip pressed={statusFilter === null} onClick={() => onStatusFilter(null)}>
          All
        </FilterChip>
        {MATRIX_STATUS_ORDER.map((label) => (
          <FilterChip
            key={label}
            pressed={statusFilter === label}
            onClick={() => onStatusFilter(statusFilter === label ? null : label)}
          >
            <ContractToneSwatch tone={CONTRACT_STATUS_TONES[label]} />
            {CONTRACT_STATUS_SHORT_LABELS[label]}
          </FilterChip>
        ))}
        <FilterChip
          pressed={statusFilter === NO_RECORD_FILTER}
          onClick={() =>
            onStatusFilter(statusFilter === NO_RECORD_FILTER ? null : NO_RECORD_FILTER)
          }
        >
          <span aria-hidden="true">—</span>
          No record
        </FilterChip>
      </div>
    </div>
  );
}

function groupChipLabel(group: ContractsMatrixGroup): string {
  return group.isActive ? group.name : `${group.name} (inactive)`;
}

function GroupsControl({ groupOptions, onToggleGroup }: ContractsMatrixFiltersProps) {
  const selected = groupOptions.filter((group) => group.selected);
  if (groupOptions.length <= GROUP_CHIP_LIMIT) {
    return (
      <div role="group" aria-labelledby="contracts-matrix-groups">
        <span id="contracts-matrix-groups" className={CONTROL_LABEL}>
          Groups
        </span>
        <div className="flex flex-wrap gap-2">
          {groupOptions.map((group) => (
            <FilterChip
              key={group.id}
              pressed={group.selected}
              onClick={() => onToggleGroup(group.id)}
            >
              {group.selected ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
              {groupChipLabel(group)}
            </FilterChip>
          ))}
        </div>
      </div>
    );
  }
  const activeCount = groupOptions.filter((group) => group.isActive).length;
  const triggerText =
    selected.length === 0
      ? "No groups"
      : selected.length === 1
        ? selected[0].name
        : selected.length === activeCount && selected.every((group) => group.isActive)
          ? `All ${activeCount} active groups`
          : `${selected.length} of ${groupOptions.length} groups`;
  return (
    <div>
      <span id="contracts-matrix-groups" className={CONTROL_LABEL}>
        Groups
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-labelledby="contracts-matrix-groups contracts-matrix-groups-value"
            className="h-9 w-[220px] justify-between text-[13px] font-normal"
          >
            <span id="contracts-matrix-groups-value" className="truncate">
              {triggerText}
            </span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-[280px] overflow-y-auto">
          {groupOptions.map((group) => (
            <DropdownMenuCheckboxItem
              key={group.id}
              checked={group.selected}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onToggleGroup(group.id)}
            >
              <span className="truncate">{groupChipLabel(group)}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StatesControl({
  stateOptions,
  selectedStates,
  onToggleState,
  onAllStates,
}: ContractsMatrixFiltersProps) {
  const isOn = (state: string) => selectedStates === null || selectedStates.includes(state);
  const onCount = stateOptions.filter(isOn).length;
  const triggerText =
    selectedStates === null
      ? "All states"
      : onCount === 1
        ? (stateOptions.find(isOn) ?? "1 state")
        : `${onCount} of ${stateOptions.length} states`;
  return (
    <div>
      <span id="contracts-matrix-states" className={CONTROL_LABEL}>
        States
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-labelledby="contracts-matrix-states contracts-matrix-states-value"
            disabled={stateOptions.length === 0}
            className="h-9 w-[160px] justify-between text-[13px] font-normal"
          >
            <span id="contracts-matrix-states-value" className="truncate">
              {triggerText}
            </span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-[180px] overflow-y-auto">
          <DropdownMenuItem disabled={selectedStates === null} onSelect={() => onAllStates()}>
            All states
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {stateOptions.map((state) => (
            <DropdownMenuCheckboxItem
              key={state}
              checked={isOn(state)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onToggleState(state)}
            >
              {state}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
