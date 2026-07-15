// E2.1 F2.1.4 (TE-6) — the manual one-off "create case" escape hatch ([r4]
// Q2a) on the case-list surface, for combinations the generation preview
// cannot derive (e.g. a payer outside the attached list). Same 4-part key,
// same dedupe semantics, same SOP resolution tier as generated cases; the
// only downstream difference is the NULL generation_run_id (the "run-less"
// trail — creation audit rows come from the RPC as always).
//
// Dedupe mirrors the preview's TE-5/TE-6 two-branch rule regardless of
// status: an exact 4-part match blocks, and a legacy NULL-group case blocks
// every group at its 3-part key. The pre-check renders a block-with-link to
// the existing case; the swapped DB constraint stays the backstop (a 23505
// race surfaces the TE-4 duplicate message).
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pickTemplate } from "@/lib/pickTemplate";
import { resolveTemplate } from "@/lib/sopResolver";
import { stampTasks } from "@/lib/sopStamp";
import { US_STATES } from "@/lib/usStates";
import { useCases, useCreateCase } from "@/hooks/useCases";
import { useProviders, useProviderGroupAssignments } from "@/hooks/useProviders";
import { useProviderGroups } from "@/hooks/useLookups";
import { usePayers, useSops } from "@/hooks/useAdmin";
import { useOrgPayerAssignments } from "@/hooks/useOrgPayerAssignments";
import { isActiveAssignment } from "@/lib/payerCatalogActions";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";

interface ManualCaseModalProps {
  onClose: () => void;
}

const NONE = "__none__";

export function ManualCaseModal({ onClose }: ManualCaseModalProps) {
  const navigate = useNavigate();

  const providersQ = useProviders();
  const groupsQ = useProviderGroups();
  const providerAssignmentsQ = useProviderGroupAssignments();
  const payersQ = usePayers();
  const payerAssignmentsQ = useOrgPayerAssignments();
  const templatesQ = useSops();
  const casesQ = useCases();
  const createCase = useCreateCase();
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();

  const [providerId, setProviderId] = useState(NONE);
  const [groupId, setGroupId] = useState(NONE);
  const [payerId, setPayerId] = useState(NONE);
  const [state, setState] = useState(NONE);

  const providers = useMemo(
    () => (providersQ.data ?? []).filter((p) => p.status !== "terminated"),
    [providersQ.data],
  );
  const payers = useMemo(() => {
    const assigned = new Set(
      (payerAssignmentsQ.data ?? []).filter(isActiveAssignment).map((a) => a.payerId),
    );
    return (payersQ.data ?? []).filter(
      (p) => assigned.has(p.id) && (p.status ?? "active") === "active",
    );
  }, [payersQ.data, payerAssignmentsQ.data]);

  // TE-6: the group select offers the provider's groups from
  // provider_group_assignments (un-ended memberships, the E1.3 semantic).
  const todayIso = new Date().toISOString().slice(0, 10);
  const providerGroups = useMemo(() => {
    if (providerId === NONE) return [];
    const groupById = new Map((groupsQ.data ?? []).map((g) => [g.id, g]));
    return (providerAssignmentsQ.data ?? [])
      .filter(
        (a) =>
          a.providerId === providerId && (a.endDate == null || a.endDate.slice(0, 10) >= todayIso),
      )
      .map((a) => groupById.get(a.groupId))
      .filter((g): g is NonNullable<typeof g> => Boolean(g));
  }, [providerId, providerAssignmentsQ.data, groupsQ.data, todayIso]);

  const selection = useMemo(
    () =>
      providerId !== NONE && groupId !== NONE && payerId !== NONE && state !== NONE
        ? { providerId, groupId, payerId, state }
        : null,
    [providerId, groupId, payerId, state],
  );

  // The TE-5 dedupe read: the full key set regardless of status — a denied
  // case still occupies its key.
  const blockingCase = useMemo(() => {
    if (!selection) return null;
    return (
      (casesQ.data ?? []).find(
        (c) =>
          c.providerId === selection.providerId &&
          c.payerId === selection.payerId &&
          c.state === selection.state &&
          (c.groupId === selection.groupId || c.groupId === null),
      ) ?? null
    );
  }, [selection, casesQ.data]);

  const loading =
    providersQ.isLoading ||
    groupsQ.isLoading ||
    providerAssignmentsQ.isLoading ||
    payersQ.isLoading ||
    payerAssignmentsQ.isLoading ||
    templatesQ.isLoading ||
    casesQ.isLoading;
  const failed =
    providersQ.isError ||
    groupsQ.isError ||
    providerAssignmentsQ.isError ||
    payersQ.isError ||
    payerAssignmentsQ.isError ||
    templatesQ.isError ||
    casesQ.isError;
  const prerequisitesReady = providers.length > 0 && payers.length > 0;

  const retry = () => {
    void providersQ.refetch();
    void groupsQ.refetch();
    void providerAssignmentsQ.refetch();
    void payersQ.refetch();
    void payerAssignmentsQ.refetch();
    void templatesQ.refetch();
    void casesQ.refetch();
  };

  const submit = () => {
    if (!selection || blockingCase) return;
    const provider = providers.find((p) => p.id === selection.providerId);
    if (!provider) return;
    const group = (groupsQ.data ?? []).find((g) => g.id === selection.groupId) ?? null;
    const template = pickTemplate(
      templatesQ.data ?? [],
      selection.payerId,
      selection.state,
      selection.groupId,
    );
    // E2.2 F2.2.1: stamp the version resolved here (same head row, TE-2).
    const tasks = template
      ? stampTasks(resolveTemplate(template, provider, group, null, null), template)
      : [];

    createCase.mutate(
      {
        input: {
          providerId: selection.providerId,
          payerId: selection.payerId,
          state: selection.state,
          groupId: selection.groupId,
          // generationRunId stays unset — the F2.1.4 run-less trail.
        },
        tasks,
      },
      {
        onSuccess: (created) => {
          toast.success("Case created.");
          onClose();
          navigate({ to: "/cases/$id", params: { id: created.id } });
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create the case."),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New case</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground" aria-live="polite">
            Loading case prerequisites…
          </div>
        ) : failed ? (
          <div
            className="space-y-3 rounded-md border border-destructive/30 p-4 text-sm"
            role="alert"
          >
            <div>
              <p className="font-medium">Couldn&apos;t load case prerequisites.</p>
              <p className="mt-1 text-muted-foreground">
                No case was created. Retry before selecting a provider or payer.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : !prerequisitesReady ? (
          <div className="space-y-3">
            {providers.length === 0 ? (
              <div className="rounded-md border p-4 text-sm">
                <p className="font-medium">Add a provider first</p>
                <p className="mt-1 text-muted-foreground">
                  A provider with at least one group assignment is required to create a case.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/onboarding/wizard" search={{ section: "providers" }} onClick={onClose}>
                    {canWrite ? "Add provider" : "View providers"}
                  </Link>
                </Button>
              </div>
            ) : null}
            {payers.length === 0 ? (
              <div className="rounded-md border p-4 text-sm">
                <p className="font-medium">Add a payer to this organization</p>
                <p className="mt-1 text-muted-foreground">
                  {isAdmin
                    ? "Select a canonical payer before creating a case."
                    : "An administrator must add a canonical payer before a case can be created."}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/payer-directory" onClick={onClose}>
                    {isAdmin ? "Open payer catalog" : "View payer catalog"}
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-case-provider">Provider</Label>
              <Select
                value={providerId}
                onValueChange={(v) => {
                  setProviderId(v);
                  setGroupId(NONE);
                }}
              >
                <SelectTrigger id="manual-case-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-case-group">Group</Label>
              <Select value={groupId} onValueChange={setGroupId} disabled={providerId === NONE}>
                <SelectTrigger id="manual-case-group">
                  <SelectValue
                    placeholder={
                      providerId === NONE
                        ? "Select a provider first"
                        : providerGroups.length === 0
                          ? "No group assignments for this provider"
                          : "Select a group"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {providerGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-case-payer">Payer</Label>
              <Select value={payerId} onValueChange={setPayerId}>
                <SelectTrigger id="manual-case-payer">
                  <SelectValue placeholder="Select a payer" />
                </SelectTrigger>
                <SelectContent>
                  {payers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-case-state">State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger id="manual-case-state">
                  <SelectValue placeholder="Select a state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {blockingCase ? (
              <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[13px] text-[#92400E]">
                A case already exists at this key
                {blockingCase.groupId === null ? " (legacy case, all groups)" : ""} —{" "}
                <Link
                  to="/cases/$id"
                  params={{ id: blockingCase.id }}
                  className="font-medium underline underline-offset-2"
                  onClick={onClose}
                >
                  open the existing case
                </Link>
                . Reapplications continue there, never as a second case.
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={
              !prerequisitesReady ||
              !selection ||
              Boolean(blockingCase) ||
              loading ||
              failed ||
              createCase.isPending
            }
            onClick={submit}
          >
            {createCase.isPending ? "Creating…" : "Create case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
