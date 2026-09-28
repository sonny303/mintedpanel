import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import {
  useProviderAssignments,
  useProviderGroupAssignments,
  useProviders,
} from "@/hooks/useProviders";
import { usePayers } from "@/hooks/useAdmin";
import { useEnrollmentReportContext } from "@/hooks/useEnrollmentReport";
import {
  curateEnrollmentProduct,
  fetchEnrollmentCatalog,
  fetchUnresolvedEnrollmentPage,
  saveEnrollmentScope,
  setEnrollmentProductTarget,
} from "@/lib/enrollmentExplorerApi";
import { useAuthStore } from "@/lib/auth-store";
import { EnrollmentScopeDrawer } from "@/components/reporting/enrollment-explorer/EnrollmentScopeDrawer";
import type {
  EnrollmentActionOwner,
  EnrollmentReportFilters,
  EnrollmentRevisionDraft,
  EnrollmentScopeSaveInput,
  EnrollmentSourceLink,
  EnrollmentUnresolvedCursor,
} from "@/types";

type WorkspaceTab = "capture" | "unresolved" | "catalog";

function activeOn(date: string | null | undefined): boolean {
  return !date || date >= new Date().toISOString().slice(0, 10);
}

export function EnrollmentStaffWorkspace({ filters }: { filters: EnrollmentReportFilters }) {
  const context = useEnrollmentReportContext();
  const accessContext = useAuthStore((state) => state.accessContext);
  const canCurate = Boolean(
    context &&
    accessContext?.staffOrgs.some((org) => org.orgId === context.orgId && org.role === "admin"),
  );
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<WorkspaceTab>("capture");
  const [groupId, setGroupId] = useState(filters.groupId ?? "");
  const [providerId, setProviderId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [payerProductId, setPayerProductId] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<EnrollmentRevisionDraft["status"]>("not_started");
  const [owner, setOwner] = useState<EnrollmentActionOwner>("Minted");
  const [retroStatus, setRetroStatus] = useState<EnrollmentRevisionDraft["retroStatus"]>("unknown");
  const [dates, setDates] = useState({
    intakeDate: "",
    completeToSubmitDate: "",
    submittedDate: "",
    payerAcknowledgedDate: "",
    approvedDate: "",
    effectiveDate: "",
    terminationDate: "",
  });
  const [retroDays, setRetroDays] = useState("");
  const [retroDate, setRetroDate] = useState("");
  const [retroBasis, setRetroBasis] = useState("");
  const [clientSafeBlocker, setClientSafeBlocker] = useState("");
  const [payerReference, setPayerReference] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [selectedSources, setSelectedSources] = useState<
    Record<string, EnrollmentSourceLink & { sourceSnapshot: Record<string, unknown> }>
  >({});
  const [productKey, setProductKey] = useState("");
  const [productName, setProductName] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [targetProductId, setTargetProductId] = useState("");
  const [targetState, setTargetState] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [savedScope, setSavedScope] = useState<{
    id: string;
    providerName: string;
    facilityLabel: string;
  } | null>(null);
  const saveDraftButtonRef = useRef<HTMLButtonElement>(null);
  const syncedFilterGroup = useRef(filters.groupId);

  const groupsQ = useProviderGroups();
  const providersQ = useProviders();
  const groupAssignmentsQ = useProviderGroupAssignments();
  const facilityAssignmentsQ = useProviderAssignments();
  const facilitiesQ = useFacilities(groupId || undefined);
  const payersQ = usePayers();
  const catalogQ = useQuery({
    queryKey: ["enrollment-catalog", context?.orgId, context?.contextRevision, groupId || null],
    enabled: Boolean(context?.audience === "staff"),
    queryFn: ({ signal }) => {
      if (!context) throw new Error("Staff context is unavailable");
      return fetchEnrollmentCatalog(context, groupId || null, { signal });
    },
  });
  const unresolvedQ = useInfiniteQuery({
    queryKey: [
      "enrollment-unresolved",
      context?.orgId,
      context?.audience,
      context?.contextRevision,
      groupId || null,
    ],
    enabled: Boolean(context?.audience === "staff"),
    initialPageParam: null as EnrollmentUnresolvedCursor | null,
    queryFn: ({ pageParam, signal }) => {
      if (!context) throw new Error("Staff context is unavailable");
      return fetchUnresolvedEnrollmentPage(
        context,
        { groupId: groupId || null, cursor: pageParam, limit: 30 },
        { signal },
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const providers = providersQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const providerGroupAssignments = groupAssignmentsQ.data ?? [];
  const facilityAssignments = facilityAssignmentsQ.data ?? [];
  const facilities = facilitiesQ.data ?? [];
  const catalog = catalogQ.data;
  const unresolved = unresolvedQ.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const assignedGroups = useMemo(() => {
    const assignmentGroupIds = new Set(
      providerGroupAssignments
        .filter(
          (assignment) =>
            assignment.providerId === providerId &&
            activeOn(assignment.endDate) &&
            (!assignment.startDate ||
              assignment.startDate <= new Date().toISOString().slice(0, 10)),
        )
        .map((assignment) => assignment.groupId),
    );
    return groups.filter((group) => assignmentGroupIds.has(group.id));
  }, [groups, providerGroupAssignments, providerId]);
  const assignedFacilities = useMemo(() => {
    const assignmentFacilityIds = new Set(
      facilityAssignments
        .filter((assignment) => assignment.providerId === providerId && assignment.facilityId)
        .map((assignment) => assignment.facilityId),
    );
    return facilities.filter(
      (facility) => assignmentFacilityIds.has(facility.id) && facility.groupId === groupId,
    );
  }, [facilityAssignments, facilities, groupId, providerId]);
  const groupTargets = (catalog?.targets ?? []).filter(
    (target) => target.groupId === groupId && target.isActive,
  );
  const targetProducts = (catalog?.products ?? []).filter(
    (product) =>
      product.isActive &&
      groupTargets.some(
        (target) =>
          target.payerProductId === product.productId && (!state || target.state === state),
      ),
  );
  const selectedFacility = assignedFacilities.find((facility) => facility.id === facilityId);
  const eligibleStates = selectedFacility?.state
    ? [selectedFacility.state]
    : [
        ...new Set([
          ...(groups.find((group) => group.id === groupId)?.states ?? []),
          ...facilities
            .filter((facility) => facility.groupId === groupId && facility.state)
            .map((facility) => facility.state!),
          ...groupTargets.map((target) => target.state),
        ]),
      ].sort();

  useEffect(() => {
    if (filters.groupId !== syncedFilterGroup.current) {
      syncedFilterGroup.current = filters.groupId;
      setGroupId(filters.groupId ?? "");
      setFacilityId("");
      setPayerProductId("");
      setState("");
    }
  }, [filters.groupId]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["enrollment-report-page"] }),
      queryClient.invalidateQueries({ queryKey: ["enrollment-catalog"] }),
      queryClient.invalidateQueries({ queryKey: ["enrollment-unresolved"] }),
    ]);
  };

  const submitScope = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context || !providerId || !groupId || !facilityId || !payerProductId || !state) {
      setMessage("Choose a provider, its assigned group and facility, payer product, and state.");
      return;
    }
    if (
      !assignedGroups.some((group) => group.id === groupId) ||
      !assignedFacilities.some((facility) => facility.id === facilityId) ||
      !groupTargets.some(
        (target) => target.payerProductId === payerProductId && target.state === state,
      ) ||
      (selectedFacility?.state && selectedFacility.state !== state)
    ) {
      setMessage("The selected group and facility must be actual assignments for this provider.");
      return;
    }
    const sources: EnrollmentSourceLink[] = Object.values(selectedSources).map(
      ({ sourceKind, sourceId, sourceFingerprint }) => ({
        sourceKind,
        sourceId,
        sourceFingerprint,
      }),
    );
    const revision: EnrollmentRevisionDraft = {
      status,
      ...Object.fromEntries(Object.entries(dates).map(([key, value]) => [key, value || null])),
      payerReference: payerReference || null,
      clientSafeBlocker: clientSafeBlocker || null,
      owner,
      retroStatus,
      retroDays: retroDays ? Number(retroDays) : null,
      retroDate: retroDate || null,
      retroBasis: retroBasis || null,
      staffNote: staffNote || null,
    };
    const input: EnrollmentScopeSaveInput = {
      providerId,
      groupId,
      facilityId,
      payerProductId,
      state,
      revision,
      sources,
    };
    setWorking(true);
    setMessage("");
    try {
      const result = await saveEnrollmentScope(context, input);
      if (typeof result.scopeId !== "string")
        throw new Error("Scope was saved but its review identity was not returned.");
      setSavedScope({
        id: result.scopeId,
        providerName: selectedProvider
          ? `${selectedProvider.firstName} ${selectedProvider.lastName}`
          : "Provider",
        facilityLabel: `${groups.find((group) => group.id === groupId)?.name ?? "Group"} · ${state} · ${catalog?.products.find((product) => product.productId === payerProductId)?.displayName ?? "Product"} · ${assignedFacilities.find((facility) => facility.id === facilityId)?.name ?? "Facility"}`,
      });
      setMessage(
        `Draft revision ${String(result.revisionNo ?? "")} saved. Review the saved scope before publishing.`,
      );
      setSelectedSources({});
      await invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scope draft could not be saved.");
    } finally {
      setWorking(false);
    }
  };

  const addProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context || !canCurate || !productKey.trim() || !productName.trim()) return;
    setWorking(true);
    try {
      const payerId = new FormData(event.currentTarget).get("payerId");
      if (typeof payerId !== "string" || !payerId) throw new Error("Choose a payer.");
      await curateEnrollmentProduct(context, {
        payerId,
        productKey: productKey.trim(),
        displayName: productName.trim(),
      });
      setProductKey("");
      setProductName("");
      setMessage("Curated product saved.");
      await invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Product could not be saved.");
    } finally {
      setWorking(false);
    }
  };

  const addTarget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context || !canCurate || !targetGroupId || !targetProductId || !targetState) return;
    setWorking(true);
    try {
      await setEnrollmentProductTarget(context, {
        groupId: targetGroupId,
        payerProductId: targetProductId,
        state: targetState,
      });
      setMessage("Group product target saved.");
      await invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Target could not be saved.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      id="staff-enrollment-capture"
      aria-label="Staff enrollment capture and review"
      className="mt-8 rounded-md border bg-card p-3 sm:p-4"
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">Staff enrollment workspace</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Capture an explicit scope, review unresolved legacy evidence, and manage catalog
            targets.
          </p>
        </div>
        {canCurate ? (
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
            Organization admin
          </span>
        ) : null}
      </header>
      <div
        className="mb-4 flex flex-wrap gap-1 border-b"
        role="tablist"
        aria-label="Staff enrollment tools"
      >
        {(["capture", "unresolved", "catalog"] as WorkspaceTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="rounded-t px-3 py-2 text-[12px] capitalize aria-selected:border aria-selected:border-b-card aria-selected:bg-card aria-selected:font-semibold"
          >
            {key === "capture"
              ? "Capture a scope"
              : key === "unresolved"
                ? "Source triage"
                : "Catalog and targets"}
          </button>
        ))}
      </div>
      {tab === "capture" ? (
        <form
          onSubmit={(event) => void submitScope(event)}
          className="space-y-4"
          data-testid="enrollment-capture-form"
        >
          <p className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            Choose all six scope coordinates yourself. The selected secondary facility is saved
            exactly; no primary location is substituted. Source links are optional evidence
            references and never create missing coordinates.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Provider
              <select
                aria-label="Scope provider"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setGroupId("");
                  setFacilityId("");
                }}
                required
              >
                <option value="">Select provider</option>
                {providers
                  .filter((provider) => !provider.isTestProvider)
                  .map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.firstName} {provider.lastName}
                      {provider.npi ? ` · ${provider.npi}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Assigned group
              <select
                aria-label="Scope group"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value);
                  setFacilityId("");
                  setPayerProductId("");
                  setState("");
                }}
                required
              >
                <option value="">Select assigned group</option>
                {assignedGroups
                  .filter((group) => group.isActive)
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Assigned facility
              <select
                aria-label="Scope facility"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={facilityId}
                onChange={(event) => {
                  setFacilityId(event.target.value);
                  setState("");
                  setPayerProductId("");
                }}
                required
              >
                <option value="">Select exact facility</option>
                {assignedFacilities
                  .filter((facility) => facility.isActive)
                  .map((facility) => (
                    <option key={facility.id} value={facility.id}>
                      {facility.name}
                      {facility.state ? ` · ${facility.state}` : ""}
                    </option>
                  ))}
              </select>
              {providerId && groupId && assignedFacilities.length === 0 ? (
                <span className="text-[10px]">
                  No assigned facility for this provider and group. Assign the intended location
                  first.
                </span>
              ) : null}
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Payer product target
              <select
                aria-label="Scope payer product"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={payerProductId}
                onChange={(event) => setPayerProductId(event.target.value)}
                required
              >
                <option value="">Select a configured target</option>
                {targetProducts.map((product) => (
                  <option key={product.productId} value={product.productId}>
                    {product.payerName} · {product.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              State
              <select
                aria-label="Scope state"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={state}
                onChange={(event) => {
                  setState(event.target.value);
                  setPayerProductId("");
                }}
                required
              >
                <option value="">Select state</option>
                {eligibleStates.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Current enrollment status
              <select
                aria-label="Scope enrollment status"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as EnrollmentRevisionDraft["status"])
                }
              >
                {[
                  "not_started",
                  "in_progress",
                  "submitted",
                  "in_review",
                  "action_required",
                  "approved",
                  "denied",
                  "not_pursuing",
                  "terminated",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Action owner
              <select
                aria-label="Scope action owner"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={owner}
                onChange={(event) => setOwner(event.target.value as EnrollmentActionOwner)}
              >
                {["Minted", "Client", "Payer", "Complete", "Unassigned"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Retroactive status
              <select
                aria-label="Scope retroactive status"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={retroStatus}
                onChange={(event) =>
                  setRetroStatus(event.target.value as EnrollmentRevisionDraft["retroStatus"])
                }
              >
                {["unknown", "not_supported", "documented"].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
              Payer reference
              <Input
                aria-label="Scope payer reference"
                value={payerReference}
                onChange={(event) => setPayerReference(event.target.value)}
                className="h-9 text-[12px]"
              />
            </label>
          </div>
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-[11px] font-medium">Enrollment milestones</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(dates).map(([key, value]) => (
                <label
                  key={key}
                  className="grid gap-1 text-[10px] font-medium capitalize text-muted-foreground"
                >
                  {key.replace(/([A-Z])/g, " $1")}
                  <Input
                    aria-label={key.replace(/([A-Z])/g, " $1")}
                    type="date"
                    value={value}
                    onChange={(event) =>
                      setDates((current) => ({ ...current, [key]: event.target.value }))
                    }
                    className="h-9 text-[12px]"
                  />
                </label>
              ))}
            </div>
          </fieldset>
          {retroStatus === "documented" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Retroactive days
                <Input
                  aria-label="Retroactive days"
                  type="number"
                  min="0"
                  value={retroDays}
                  onChange={(event) => setRetroDays(event.target.value)}
                  className="h-9 text-[12px]"
                />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Retroactive date
                <Input
                  aria-label="Retroactive date"
                  type="date"
                  value={retroDate}
                  onChange={(event) => setRetroDate(event.target.value)}
                  className="h-9 text-[12px]"
                />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Retroactive basis
                <Input
                  aria-label="Retroactive basis"
                  value={retroBasis}
                  onChange={(event) => setRetroBasis(event.target.value)}
                  className="h-9 text-[12px]"
                />
              </label>
            </div>
          ) : null}
          <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            Client-safe next step
            <Input
              aria-label="Client-safe next step"
              value={clientSafeBlocker}
              onChange={(event) => setClientSafeBlocker(event.target.value)}
              className="h-9 text-[12px]"
            />
          </label>
          <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
            Staff note
            <textarea
              aria-label="Scope staff note"
              value={staffNote}
              onChange={(event) => setStaffNote(event.target.value)}
              rows={2}
              className="rounded-md border bg-background p-2 text-[12px]"
            />
          </label>
          <fieldset className="rounded-md border p-3">
            <legend className="px-1 text-[11px] font-medium">
              Link source evidence for review
            </legend>
            <p className="mb-2 text-[10px] text-muted-foreground">
              Each checked source is linked to the six coordinates above. Confirm the source
              snapshot; partial or unknown coordinates remain unresolved.
            </p>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {unresolved.map((item) => {
                const key = `${item.sourceKind}:${item.sourceId}`;
                const captured = selectedSources[key];
                const changedAfterReview = Boolean(
                  captured && captured.sourceFingerprint !== item.sourceFingerprint,
                );
                return (
                  <label key={key} className="flex gap-2 rounded border p-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={Boolean(captured)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelectedSources((current) => {
                          if (!checked) {
                            const next = { ...current };
                            delete next[key];
                            return next;
                          }
                          return {
                            ...current,
                            [key]: {
                              sourceKind: item.sourceKind,
                              sourceId: item.sourceId,
                              sourceFingerprint: item.sourceFingerprint,
                              sourceSnapshot: item.sourceSnapshot,
                            },
                          };
                        });
                      }}
                    />
                    <span className="min-w-0">
                      <strong>
                        {item.sourceKind} · {item.sourceId}
                      </strong>{" "}
                      · {item.triageState.replaceAll("_", " ")}
                      {changedAfterReview ? (
                        <span className="block font-medium text-amber-800">
                          Source changed after selection. Uncheck and recheck only after reviewing
                          the current snapshot.
                        </span>
                      ) : null}
                      <span className="block break-all text-muted-foreground">
                        {JSON.stringify(captured?.sourceSnapshot ?? item.sourceSnapshot)}
                      </span>
                      {item.unmappedCoordinates.length || item.unmappedFacilityIds.length ? (
                        <span className="block text-amber-800">
                          Incomplete mapping: {item.unmappedCoordinates.length} coordinate(s),{" "}
                          {item.unmappedFacilityIds.length} facility(ies) still unresolved.
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
              {!unresolved.length ? (
                <p className="text-[11px] text-muted-foreground">
                  No unresolved sources are available in this selected group.
                </p>
              ) : null}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={saveDraftButtonRef}
              type="submit"
              size="sm"
              disabled={
                working ||
                !context ||
                !providerId ||
                !groupId ||
                !facilityId ||
                !payerProductId ||
                !state
              }
            >
              {working ? "Saving…" : "Save draft revision"}
            </Button>
            <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
              {message}
            </p>
          </div>
        </form>
      ) : null}
      {tab === "unresolved" ? (
        <div className="space-y-3" data-testid="enrollment-unresolved-queue">
          <div className="flex flex-wrap items-center gap-3">
            <label className="grid min-w-56 gap-1 text-[11px] font-medium text-muted-foreground">
              Selected group (optional for org triage)
              <select
                aria-label="Triage group"
                className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                <option value="">All groups / unassigned</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-[11px] text-muted-foreground">
              {unresolved.length} source records loaded
            </span>
          </div>
          {unresolved.map((item) => (
            <article key={`${item.sourceKind}:${item.sourceId}`} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[12px]">
                  {item.sourceKind} · {item.sourceId}
                </strong>
                <span className="rounded bg-amber-100 px-2 py-1 text-[10px] capitalize text-amber-900">
                  {item.triageState.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Observed {new Date(item.observedAt).toLocaleString()} · {item.mappedScopeIds.length}{" "}
                existing link(s)
              </p>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[10px]">
                {JSON.stringify(item.sourceSnapshot, null, 2)}
              </pre>
              {item.mappingNeedsConfiguration ||
              item.unmappedCoordinates.length ||
              item.unmappedFacilityIds.length ? (
                <p className="mt-2 text-[11px] text-amber-900">
                  Partial mapping remains unresolved: {item.unmappedCoordinates.length}{" "}
                  product/location coordinate(s), {item.unmappedFacilityIds.length} facility
                  mapping(s). Configure every true coordinate explicitly before linking.
                </p>
              ) : null}
            </article>
          ))}
          {unresolvedQ.hasNextPage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={unresolvedQ.isFetchingNextPage}
              onClick={() => void unresolvedQ.fetchNextPage()}
            >
              {unresolvedQ.isFetchingNextPage ? "Loading…" : "Load more sources"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {tab === "catalog" ? (
        <div className="grid gap-5 lg:grid-cols-2" data-testid="enrollment-catalog-tools">
          {canCurate ? (
            <form
              onSubmit={(event) => void addProduct(event)}
              className="space-y-3 rounded-md border p-4"
            >
              <h3 className="text-[13px] font-semibold">Curate payer product</h3>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Payer
                <select
                  name="payerId"
                  aria-label="Catalog payer"
                  className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                  defaultValue=""
                >
                  <option value="">Select payer</option>
                  {(payersQ.data ?? [])
                    .filter((payer) => payer.isActive && payer.status !== "retired")
                    .map((payer) => (
                      <option key={payer.id} value={payer.id}>
                        {payer.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Stable product key
                <Input
                  aria-label="Product key"
                  value={productKey}
                  onChange={(event) => setProductKey(event.target.value)}
                  required
                  className="h-9 text-[12px]"
                />
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Display name
                <Input
                  aria-label="Product display name"
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  required
                  className="h-9 text-[12px]"
                />
              </label>
              <Button size="sm" disabled={working}>
                Save curated product
              </Button>
            </form>
          ) : (
            <p className="rounded-md bg-muted p-4 text-[12px]">
              Only an organization admin can change curated products or targets.
            </p>
          )}
          {canCurate ? (
            <form
              onSubmit={(event) => void addTarget(event)}
              className="space-y-3 rounded-md border p-4"
            >
              <h3 className="text-[13px] font-semibold">Configure group product target</h3>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Group
                <select
                  aria-label="Target group"
                  className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                  value={targetGroupId}
                  onChange={(event) => setTargetGroupId(event.target.value)}
                  required
                >
                  <option value="">Select group</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                Curated product
                <select
                  aria-label="Target product"
                  className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                  value={targetProductId}
                  onChange={(event) => setTargetProductId(event.target.value)}
                  required
                >
                  <option value="">Select product</option>
                  {(catalog?.products ?? [])
                    .filter((product) => product.isActive)
                    .map((product) => (
                      <option key={product.productId} value={product.productId}>
                        {product.payerName} · {product.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                State
                <select
                  aria-label="Target state"
                  className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
                  value={targetState}
                  onChange={(event) => setTargetState(event.target.value)}
                  required
                >
                  <option value="">Select state</option>
                  {[...new Set(groups.find((group) => group.id === targetGroupId)?.states ?? [])]
                    .sort()
                    .map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                </select>
              </label>
              <Button size="sm" disabled={working}>
                Save group target
              </Button>
            </form>
          ) : null}
          <div className="rounded-md border p-4 lg:col-span-2">
            <h3 className="text-[13px] font-semibold">Current catalog and targets</h3>
            <ul className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
              {(catalog?.products ?? []).map((product) => (
                <li key={product.productId} className="rounded border p-2">
                  {product.payerName} · {product.displayName}{" "}
                  <span className="text-muted-foreground">({product.productKey})</span>
                </li>
              ))}
              {(catalog?.targets ?? []).map((target) => (
                <li key={target.targetId} className="rounded border p-2">
                  {groups.find((group) => group.id === target.groupId)?.name ?? "Group"} ·{" "}
                  {catalog?.products.find((product) => product.productId === target.payerProductId)
                    ?.displayName ?? "Product"}{" "}
                  · {target.state}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {tab === "catalog" || tab === "capture" ? (
        <p role="status" aria-live="polite" className="mt-3 text-[11px] text-muted-foreground">
          {message}
        </p>
      ) : null}
      {unresolvedQ.error || catalogQ.error ? (
        <p role="alert" className="mt-3 text-[11px] text-destructive">
          Staff enrollment data could not be loaded in this access context.
        </p>
      ) : null}
      {savedScope ? (
        <EnrollmentScopeDrawer
          scopeId={savedScope.id}
          providerName={savedScope.providerName}
          facilityLabel={savedScope.facilityLabel}
          open={Boolean(savedScope)}
          onOpenChange={(open) => {
            if (!open) setSavedScope(null);
          }}
          onRestoreFocus={() => saveDraftButtonRef.current?.focus()}
        />
      ) : null}
    </section>
  );
}
