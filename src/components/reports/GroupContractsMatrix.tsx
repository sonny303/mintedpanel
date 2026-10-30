// Group Contracts Matrix — the organization view (spec "Group Contracts
// Matrix: Organization View", Oct 29, 2026). Every provider group's contracts
// sit under the organization's name, one table per specialty, with payers down
// the side and each group's states across the top. The whole derivation is
// buildContractsMatrix (src/lib/groupContractsMatrix.ts); this component wires
// the hooks, holds the view's choices, and renders the result.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";
import { AddButton } from "@/components/providers/RecordSectionCard";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { localTodayIso, useProviderReadinessFacts } from "@/hooks/useEnrollmentReadiness";
import { useFacilities, useOrgStateLicenses, useProviderGroups } from "@/hooks/useLookups";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { useProviderAssignments, useProviderGroupAssignments } from "@/hooks/useProviders";
import { useActiveMembership } from "@/lib/auth-store";
import {
  CONTRACT_SPECIALTY_LABELS,
  MATRIX_SPECIALTIES,
  contractSpecialtyKeyOf,
  contractTripleKey,
  type ContractSpecialty,
} from "@/lib/contractSpecialty";
import {
  buildContractsMatrix,
  locateMatrixCell,
  specialtiesShowingContract,
  type ContractsMatrixAddedColumn,
  type ContractsMatrixArrangement,
  type ContractsMatrixCell,
  type ContractsMatrixRow,
  type ContractsMatrixStatusFilter,
  type ContractsMatrixTable as MatrixTable,
} from "@/lib/groupContractsMatrix";
import { useCanWrite } from "@/lib/permissions";
import type { Contract } from "@/types";
import { ContractDetailDrawer } from "./ContractDetailDrawer";
import { AddPayerDialog, AddStateDialog } from "./ContractsMatrixAddDialogs";
import { SharedTag } from "./ContractsMatrixCell";
import { ContractsMatrixFilters } from "./ContractsMatrixFilters";
import { ContractsMatrixTable } from "./ContractsMatrixTable";
import type { AlsoApplyTarget } from "./contractDetailPlan";
import { contractsMatrixCellDomId, countLabel } from "./contractsMatrixView";

interface ContractsMatrixContext {
  groupId?: string;
  payerId?: string;
  state?: string;
  /** The case's specialty, when the link knows it: its table is preferred. */
  specialty?: ContractSpecialty;
}

interface OpenCell {
  specialty: ContractSpecialty;
  groupId: string;
  groupName: string;
  groupTin: string | null;
  payerId: string;
  payerName: string;
  state: string;
  contract: Contract | null;
  alsoApplyTargets: AlsoApplyTarget[];
  /** Tables showing `contract` right now (only when it is the shared record). */
  sharedIn: ContractSpecialty[];
  allRecordExists: boolean;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function GroupContractsMatrix({
  initialContext,
}: {
  initialContext?: ContractsMatrixContext;
}) {
  const canWrite = useCanWrite();
  const membership = useActiveMembership();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const contractsQ = useContracts();
  const statusesQ = useStatusConfigs("contracting");
  const facilitiesQ = useFacilities();
  const targetsQ = usePayerNetworkTargets();
  const facilityAssignmentsQ = useProviderAssignments();
  const licensesQ = useOrgStateLicenses();
  const groupAssignmentsQ = useProviderGroupAssignments();
  const providerFactsQ = useProviderReadinessFacts();
  const queries = [
    groupsQ,
    payersQ,
    contractsQ,
    statusesQ,
    facilitiesQ,
    targetsQ,
    facilityAssignmentsQ,
    licensesQ,
    groupAssignmentsQ,
    providerFactsQ,
  ];

  const [specialties, setSpecialties] = useState<ContractSpecialty[]>([...MATRIX_SPECIALTIES]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(null);
  const [selectedStates, setSelectedStates] = useState<string[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<ContractsMatrixStatusFilter>(null);
  const [payerSearch, setPayerSearch] = useState("");
  const [arrange, setArrange] = useState<ContractsMatrixArrangement>("group");
  const [addedPayerIds, setAddedPayerIds] = useState<string[]>([]);
  const [addedColumns, setAddedColumns] = useState<ContractsMatrixAddedColumn[]>([]);
  const [openCell, setOpenCell] = useState<OpenCell | null>(null);
  const [addPayerOpen, setAddPayerOpen] = useState(false);
  const [addStateFor, setAddStateFor] = useState<ContractSpecialty | null>(null);

  // Date-only, read once per mount; the derivation never reads a clock.
  const today = useMemo(() => localTodayIso(), []);
  const contracts = useMemo(() => contractsQ.data ?? [], [contractsQ.data]);

  const providers = useMemo(
    () =>
      (providerFactsQ.data ?? []).map((fact) => ({
        id: fact.providerId,
        taxonomyCode: fact.taxonomyCode ?? null,
      })),
    [providerFactsQ.data],
  );

  const matrix = useMemo(
    () =>
      buildContractsMatrix<Contract>(
        {
          today,
          groups: groupsQ.data ?? [],
          payers: payersQ.data ?? [],
          contracts,
          targets: targetsQ.data ?? [],
          statuses: statusesQ.data ?? [],
          facilities: facilitiesQ.data ?? [],
          facilityAssignments: facilityAssignmentsQ.data ?? [],
          licenses: licensesQ.data ?? [],
          providers,
          groupAssignments: groupAssignmentsQ.data ?? [],
        },
        {
          specialties,
          selectedGroupIds,
          selectedStates,
          statusFilter,
          payerSearch,
          arrange,
          addedPayerIds,
          addedColumns,
          // GCM-20: a case link's group is shown even when inactive; the link
          // never narrows the selection.
          contextGroupId: initialContext?.groupId ?? null,
        },
      ),
    [
      today,
      groupsQ.data,
      payersQ.data,
      contracts,
      targetsQ.data,
      statusesQ.data,
      facilitiesQ.data,
      facilityAssignmentsQ.data,
      licensesQ.data,
      providers,
      groupAssignmentsQ.data,
      specialties,
      selectedGroupIds,
      selectedStates,
      statusFilter,
      payerSearch,
      arrange,
      addedPayerIds,
      addedColumns,
      initialContext?.groupId,
    ],
  );

  // GCM-20: a case link opens the full view and only highlights its cell.
  const linkGroupId = initialContext?.groupId;
  const linkPayerId = initialContext?.payerId;
  const linkState = initialContext?.state;
  const linkSpecialty = initialContext?.specialty ?? null;
  const link = useMemo(
    () =>
      linkGroupId && linkPayerId && linkState
        ? {
            groupId: linkGroupId,
            payerId: linkPayerId,
            state: linkState,
            specialty: linkSpecialty,
          }
        : null,
    [linkGroupId, linkPayerId, linkState, linkSpecialty],
  );
  const hasLink = link !== null;
  const location = useMemo(() => (link ? locateMatrixCell(matrix, link) : null), [link, matrix]);
  const scrolledToLink = useRef(false);
  useEffect(() => {
    if (!location || scrolledToLink.current) return;
    const element = document.getElementById(
      contractsMatrixCellDomId(location.specialty, location.columnKey, location.payerId),
    );
    if (!element) return;
    scrolledToLink.current = true;
    element.scrollIntoView({ block: "center", inline: "center" });
  }, [location]);

  const allRecordKeys = useMemo(
    () =>
      new Set(
        contracts
          .filter((contract) => contractSpecialtyKeyOf(contract) === "all")
          .map((contract) => contractTripleKey(contract)),
      ),
    [contracts],
  );

  const handleOpenCell = useCallback(
    (
      table: MatrixTable<Contract>,
      row: ContractsMatrixRow<Contract>,
      cell: ContractsMatrixCell<Contract>,
    ) => {
      if (cell.kind === "outside") return;
      if (cell.kind === "empty" && !canWrite) return;
      const column = table.columns.find((candidate) => candidate.key === cell.columnKey);
      // GCM-27: the payer's other open states for this group in this table,
      // with what each cell shows now, so "Also apply" changes that cell.
      const alsoApplyTargets = row.cells.flatMap<AlsoApplyTarget>((other) =>
        other.groupId !== cell.groupId || other.state === cell.state || other.kind === "outside"
          ? []
          : [
              {
                state: other.state,
                current: other.kind === "record" ? (other.shared ? "shared" : "own") : "empty",
              },
            ],
      );
      setOpenCell({
        specialty: table.specialty,
        groupId: cell.groupId,
        groupName: column?.groupName ?? "",
        groupTin: column?.groupTin ?? null,
        payerId: cell.payerId,
        payerName: row.payerName,
        state: cell.state,
        contract: cell.kind === "record" ? cell.contract : null,
        alsoApplyTargets,
        sharedIn:
          cell.kind === "record" && cell.shared
            ? specialtiesShowingContract(matrix, cell.contract.id)
            : [],
        allRecordExists: allRecordKeys.has(
          contractTripleKey({ groupId: cell.groupId, payerId: cell.payerId, state: cell.state }),
        ),
      });
    },
    [allRecordKeys, canWrite, matrix],
  );

  const isLoading = queries.some((query) => query.isLoading);
  const isError = queries.some((query) => query.isError);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">Loading the contracts matrix…</span>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-[var(--mp-border)] bg-[var(--mp-card)] p-8">
        <EmptyState
          message="The contracts matrix could not load."
          description="Check your connection and try again."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                for (const query of queries) {
                  if (query.isError) void query.refetch();
                }
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const orgName = membership?.orgName ?? "Organization";

  if ((groupsQ.data ?? []).length === 0) {
    return (
      <div className="rounded-md border border-[var(--mp-border)] bg-[var(--mp-card)] p-8">
        <EmptyState
          message={`${orgName} has no provider groups yet.`}
          description="Add a provider group to start tracking its payer contracts."
        />
      </div>
    );
  }

  const { counts } = matrix;
  const selectedGroups = matrix.groupOptions.filter((group) => group.selected);
  const anyOutside = matrix.tables.some((table) =>
    table.rows.some((row) => row.cells.some((cell) => cell.kind === "outside")),
  );
  const anyShared = matrix.tables.some((table) =>
    table.rows.some((row) => row.cells.some((cell) => cell.kind === "record" && cell.shared)),
  );
  const unplacedSpecialties = [
    ...new Set(
      matrix.unplacedRecords.map(
        (contract) => CONTRACT_SPECIALTY_LABELS[contractSpecialtyKeyOf(contract)],
      ),
    ),
  ].sort();

  let emptyView: { message: string; description?: string } | null = null;
  if (matrix.selectedGroupIds.length === 0) {
    emptyView = { message: "Select at least one group to see its contracts." };
  } else if (specialties.length === 0) {
    emptyView = { message: "Turn on at least one specialty to see its table." };
  } else if (selectedStates !== null && selectedStates.length === 0) {
    emptyView = { message: "Select at least one state to see its columns." };
  } else if (matrix.tables.length === 0) {
    emptyView = {
      message: "No contract tables to show yet.",
      description:
        "A specialty's table appears once a selected group has a provider of that specialty with a clinic or license in a state, or holds a contract record there.",
    };
  }

  const emptyRowsMessage = payerSearch.trim()
    ? "No payers in this table match the search."
    : statusFilter !== null
      ? "No payers in this table match the status filter."
      : "No payers yet. Add a network target for one of these groups, or add a payer.";

  const linkBanner = hasLink
    ? location
      ? `Opened from a case: ${[location.payerName, location.specialtyLabel, location.groupName, location.state].join(" · ")}. The cell is highlighted below.`
      : `Opened from a case: ${[
          (payersQ.data ?? []).find((payer) => payer.id === initialContext?.payerId)?.name ??
            "Payer",
          (groupsQ.data ?? []).find((group) => group.id === initialContext?.groupId)?.name ??
            "Group",
          initialContext?.state ?? "",
        ].join(" · ")}. That cell is not in the tables shown.`
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <section
          aria-labelledby="contracts-matrix-org"
          className="rounded-md border border-[var(--mp-border)] bg-[var(--mp-card)]"
        >
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--mp-border)] p-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--mp-ink-secondary)]">
                Organization
              </p>
              <h2
                id="contracts-matrix-org"
                className="truncate text-[20px] font-semibold text-[var(--mp-ink)]"
              >
                {orgName}
              </h2>
              <p className="text-[13px] text-[var(--mp-ink-secondary)]" data-testid="matrix-scope">
                {[
                  countLabel(counts.groups, "group"),
                  countLabel(counts.specialties, "specialty", "specialties"),
                  countLabel(counts.states, "state"),
                  countLabel(counts.payers, "payer"),
                ].join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-[var(--mp-ink-secondary)]" data-testid="matrix-totals">
                <span className="font-semibold text-[var(--mp-ink)]">{counts.records}</span>{" "}
                {counts.records === 1 ? "contract record" : "contract records"} ·{" "}
                <span className="font-semibold text-[var(--mp-ok-ink)]">{counts.inNetwork}</span> in
                network
              </p>
              {canWrite ? (
                <AddButton label="Add payer" onClick={() => setAddPayerOpen(true)} />
              ) : null}
            </div>
          </header>

          <div className="space-y-4 p-4">
            <ContractsMatrixFilters
              specialties={specialties}
              onToggleSpecialty={(specialty) =>
                setSpecialties((current) =>
                  current.includes(specialty)
                    ? current.filter((s) => s !== specialty)
                    : MATRIX_SPECIALTIES.filter((s) => s === specialty || current.includes(s)),
                )
              }
              groupOptions={matrix.groupOptions}
              onToggleGroup={(groupId) => {
                const current = matrix.selectedGroupIds;
                setSelectedGroupIds(
                  current.includes(groupId)
                    ? current.filter((id) => id !== groupId)
                    : [...current, groupId],
                );
              }}
              stateOptions={matrix.stateOptions}
              selectedStates={selectedStates}
              onToggleState={(state) => {
                const current = selectedStates ?? matrix.stateOptions;
                const next = current.includes(state)
                  ? current.filter((s) => s !== state)
                  : [...current, state];
                const coversAll = matrix.stateOptions.every((s) => next.includes(s));
                setSelectedStates(coversAll ? null : next);
              }}
              onAllStates={() => setSelectedStates(null)}
              payerSearch={payerSearch}
              onPayerSearch={setPayerSearch}
              arrange={arrange}
              onArrange={setArrange}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
            />

            {linkBanner ? (
              <p
                role="status"
                className="rounded-md border border-[var(--mp-border)] bg-[var(--mp-primary-tint)] px-3 py-2 text-[13px] text-[var(--mp-ink)]"
              >
                {linkBanner}
              </p>
            ) : null}

            {matrix.groupsWithoutColumns.length > 0 ? (
              <p className="text-[13px] text-[var(--mp-ink-secondary)]">
                Not shown: {joinNames(matrix.groupsWithoutColumns.map((group) => group.name))}{" "}
                {matrix.groupsWithoutColumns.length === 1 ? "has" : "have"} no states yet.
              </p>
            ) : null}

            {matrix.unplacedRecords.length > 0 ? (
              <p className="text-[13px] text-[var(--mp-ink-secondary)]">
                {countLabel(matrix.unplacedRecords.length, "contract record")}{" "}
                {matrix.unplacedRecords.length === 1 ? "belongs" : "belong"} to{" "}
                {joinNames(unplacedSpecialties)}, which{" "}
                {unplacedSpecialties.length === 1 ? "has" : "have"} no table yet.
              </p>
            ) : null}

            {matrix.supersededSharedRecords.length > 0 ? (
              <p className="text-[13px] text-[var(--mp-ink-secondary)]">
                Not shown:{" "}
                {countLabel(
                  matrix.supersededSharedRecords.length,
                  "all-specialties agreement",
                  "all-specialties agreements",
                )}{" "}
                where Physical therapy and Nutrition each have their own record (
                {joinNames(matrix.supersededSharedRecords.map((record) => record.label))}).{" "}
                {matrix.supersededSharedRecords.length === 1
                  ? "It still applies"
                  : "They still apply"}{" "}
                to other specialties.
              </p>
            ) : null}

            {emptyView ? (
              <div className="rounded-md border border-[var(--mp-border)] p-8">
                <EmptyState message={emptyView.message} description={emptyView.description} />
              </div>
            ) : (
              <div className="space-y-6">
                {matrix.tables.map((table) => (
                  <ContractsMatrixTable
                    key={table.specialty}
                    table={table}
                    canWrite={canWrite}
                    highlight={location}
                    emptyRowsMessage={emptyRowsMessage}
                    onOpenCell={handleOpenCell}
                    onAddState={canWrite ? () => setAddStateFor(table.specialty) : undefined}
                  />
                ))}
              </div>
            )}

            {!emptyView && (anyShared || anyOutside) ? (
              <div className="space-y-1.5 text-[13px] text-[var(--mp-ink-secondary)]">
                {anyShared ? (
                  <p className="flex items-start gap-2">
                    <SharedTag />
                    <span>
                      One agreement that covers every specialty for that group and state. It shows
                      in each specialty&apos;s table, and changing it changes it in all of them.
                    </span>
                  </p>
                ) : null}
                {anyOutside ? (
                  <p className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-block h-3.5 w-5 shrink-0 rounded-[2px] border border-[var(--mp-border)] bg-[var(--mp-muted)]"
                    />
                    <span>
                      Shaded cells are states the plan does not serve (from the payer catalog). They
                      cannot be edited and are left out of the totals.
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section
          aria-labelledby="contracts-matrix-notes"
          className="rounded-md border border-[var(--mp-border)] bg-[var(--mp-card)] p-4"
        >
          <h2
            id="contracts-matrix-notes"
            className="text-[11px] font-medium uppercase tracking-wider text-[var(--mp-ink-secondary)]"
          >
            Cross-payer dependencies &amp; contract notes
          </h2>
          {matrix.notes.length === 0 ? (
            <p className="mt-2 text-[13px] text-[var(--mp-ink-secondary)]">
              No notes on the contracts shown. Notes saved in a contract&apos;s dialog appear here.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--mp-border-subtle)]">
              {matrix.notes.map((note) => (
                <li
                  key={note.contract.id}
                  className="flex flex-col gap-1 py-2 text-[13px] sm:flex-row sm:gap-3"
                >
                  <span className="shrink-0 font-semibold text-[var(--mp-ink)]">{note.label}</span>
                  <span className="whitespace-pre-wrap break-words text-[var(--mp-ink-secondary)]">
                    {note.note}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {openCell ? (
          <ContractDetailDrawer
            open
            onClose={() => setOpenCell(null)}
            contract={openCell.contract}
            groupId={openCell.groupId}
            payerId={openCell.payerId}
            state={openCell.state}
            groupName={openCell.groupName}
            groupTin={openCell.groupTin}
            payerName={openCell.payerName}
            specialty={openCell.specialty}
            allRecordExists={openCell.allRecordExists}
            alsoApplyTargets={openCell.alsoApplyTargets}
            sharedIn={openCell.sharedIn}
          />
        ) : null}

        {addPayerOpen ? (
          <AddPayerDialog
            payers={matrix.addablePayers}
            onAdd={(payerId) =>
              setAddedPayerIds((current) =>
                current.includes(payerId) ? current : [...current, payerId],
              )
            }
            onClose={() => setAddPayerOpen(false)}
          />
        ) : null}

        {addStateFor ? (
          <AddStateDialog
            specialtyLabel={CONTRACT_SPECIALTY_LABELS[addStateFor]}
            groups={selectedGroups}
            onAdd={(groupId, state) =>
              setAddedColumns((current) => [...current, { specialty: addStateFor, groupId, state }])
            }
            onClose={() => setAddStateFor(null)}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
