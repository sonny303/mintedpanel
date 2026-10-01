import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSops } from "@/hooks/useAdmin";
import { useFacilities } from "@/hooks/useLookups";
import { useProviders } from "@/hooks/useProviders";
import {
  buildContractSopLaunchTuple,
  type ContractPortalConfiguration,
} from "@/lib/contractSopLaunch";
import {
  useAssignContractSop,
  useContractProviderIds,
  useContractSopAssignment,
} from "@/hooks/useContractSopAssignments";
import { eligibleContractProviderOptions } from "@/services/contractSopAssignments";
import { isAllStates, templateStates } from "@/lib/sopMatchKey";
import type { Contract } from "@/types";

interface ContractSopAssignmentPanelProps {
  contract: Contract | null;
  groupId: string;
  payerId: string;
  state: string;
  /** Injected by the Matrix once MINT-52's exact-key resolver is connected. */
  portalConfigurationForKey?: (portalKey: string) => ContractPortalConfiguration | null;
}

function compatibleContractSops<
  T extends {
    caseType?: string | null;
    archived?: boolean;
    currentVersion?: number;
    payerId: string | null;
    groupId: string | null;
    states?: readonly string[] | null;
    state: string | null;
  },
>(templates: T[], payerId: string, groupId: string, state: string): T[] {
  return templates.filter((template) => {
    const states = templateStates(template);
    return (
      template.caseType === "contract" &&
      !template.archived &&
      typeof template.currentVersion === "number" &&
      template.currentVersion > 0 &&
      template.payerId === payerId &&
      (template.groupId == null || template.groupId === groupId) &&
      (isAllStates(states) || states.includes(state.toUpperCase()))
    );
  });
}

export function ContractSopAssignmentPanel({
  contract,
  groupId,
  payerId,
  state,
  portalConfigurationForKey,
}: ContractSopAssignmentPanelProps) {
  const sopsQ = useSops();
  const assignmentQ = useContractSopAssignment(contract?.id);
  const assignSopM = useAssignContractSop();
  const providerIdsQ = useContractProviderIds(groupId);
  const providersQ = useProviders();
  const facilitiesQ = useFacilities(groupId);
  const [selectedSopId, setSelectedSopId] = useState<string>("");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>("");

  const compatibleSops = compatibleContractSops(sopsQ.data ?? [], payerId, groupId, state);
  const selectedSop = compatibleSops.find((sop) => sop.id === selectedSopId);
  const eligibleProviderIds = new Set(providerIdsQ.data ?? []);
  const eligibleProviders = eligibleContractProviderOptions(
    providersQ.data ?? [],
    eligibleProviderIds,
  );
  const eligibleFacilities = (facilitiesQ.data ?? []).filter(
    (facility) =>
      facility.isActive &&
      !facility.referenceOnly &&
      facility.groupId === groupId &&
      facility.state?.toUpperCase() === state.toUpperCase(),
  );

  useEffect(() => {
    setSelectedSopId(assignmentQ.data?.assignment.sopTemplateId ?? "");
  }, [assignmentQ.data?.assignment.id, assignmentQ.data?.assignment.sopTemplateId]);

  useEffect(() => {
    setSelectedProviderId("");
    setSelectedFacilityId("");
  }, [contract?.id]);

  async function handleAssignSop() {
    if (!contract?.id || !selectedSop || typeof selectedSop.currentVersion !== "number") return;
    try {
      await assignSopM.mutateAsync({
        contractId: contract.id,
        sopTemplateId: selectedSop.id,
        sopVersion: selectedSop.currentVersion,
        expectedContextVersion: assignmentQ.data?.assignment.contextVersion ?? null,
      });
      toast.success("Contract SOP assignment saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign Contract SOP.");
    }
  }

  return (
    <section aria-label="Contract SOP assignment" className="space-y-3 rounded-md border p-3">
      <div>
        <h3 className="font-medium">Contract SOP</h3>
        <p className="text-xs text-muted-foreground">
          Assign one published Contract SOP to this group, payer, and state. Provider and location
          choices are launch inputs and are not required to save the assignment.
        </p>
      </div>

      {!contract?.id ? (
        <p className="text-xs text-muted-foreground">
          Save the contract row before assigning its SOP.
        </p>
      ) : assignmentQ.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading assigned SOP…</p>
      ) : (
        <>
          {assignmentQ.data ? (
            <div className="rounded bg-muted/50 p-2 text-xs" data-testid="assigned-contract-sop">
              <span className="font-medium">Assigned version:</span> {assignmentQ.data.version.name}{" "}
              · v{assignmentQ.data.assignment.sopVersion}
              {assignmentQ.data.hasRecordedActivity ? (
                <span className="ml-2 text-amber-700">
                  Filling has started; replacement is locked.
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              {assignmentQ.data
                ? "Replace with current version"
                : "Choose a published Contract SOP"}
            </Label>
            <Select value={selectedSopId} onValueChange={setSelectedSopId}>
              <SelectTrigger aria-label="Contract SOP">
                <SelectValue placeholder="Select a Contract SOP" />
              </SelectTrigger>
              <SelectContent>
                {compatibleSops.map((sop) => (
                  <SelectItem key={sop.id} value={sop.id}>
                    {sop.name} · v{sop.currentVersion}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {compatibleSops.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No published Contract SOP matches this payer and state.
              </p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAssignSop}
              disabled={
                !selectedSop ||
                assignSopM.isPending ||
                assignmentQ.data?.hasRecordedActivity === true ||
                (assignmentQ.data?.assignment.sopTemplateId === selectedSop?.id &&
                  assignmentQ.data.assignment.sopVersion === selectedSop?.currentVersion)
              }
            >
              {assignSopM.isPending
                ? "Saving assignment…"
                : assignmentQ.data
                  ? "Replace Contract SOP"
                  : "Assign Contract SOP"}
            </Button>
          </div>

          {assignmentQ.data ? (
            <div className="space-y-3 border-t pt-3" data-testid="contract-sop-instructions">
              {assignmentQ.data.version.taskDefinitions.map((task, taskIndex) => (
                <div key={`${taskIndex}-${task.title}`} className="space-y-1">
                  <h4 className="font-medium">{task.title}</h4>
                  {task.description ? (
                    <p className="text-xs text-muted-foreground">{task.description}</p>
                  ) : null}
                  <ol className="list-decimal space-y-1 pl-5 text-xs">
                    {task.steps.map((step, stepIndex) => {
                      const launchTuple =
                        step.stepType === "online_form" && assignmentQ.data?.assignment
                          ? buildContractSopLaunchTuple({
                              contractId: assignmentQ.data.assignment.contractId,
                              orgId: contract?.orgId ?? "",
                              payerId,
                              assignment: assignmentQ.data.assignment,
                              taskIndex,
                              stepIndex,
                              step,
                              providerId: selectedProviderId || null,
                              facilityId: selectedFacilityId || null,
                              configuration: step.portalKey
                                ? (portalConfigurationForKey?.(step.portalKey) ?? null)
                                : null,
                            })
                          : null;
                      return (
                        <li key={`${taskIndex}-${stepIndex}`}>
                          <span>{step.label}</span>
                          {step.detail ? (
                            <span className="text-muted-foreground"> — {step.detail}</span>
                          ) : null}
                          {step.stepType === "online_form" && step.portalKey ? (
                            <div className="mt-1 rounded bg-muted/50 px-2 py-1 text-muted-foreground">
                              Form configuration: <code>{step.portalKey}</code>
                              {launchTuple ? (
                                <div
                                  className="mt-1 space-y-0.5"
                                  data-testid="contract-launch-tuple"
                                  data-step-identity={launchTuple.stepIdentity}
                                >
                                  <div>
                                    Step tuple: task {launchTuple.taskIndex}, step{" "}
                                    {launchTuple.stepIndex}· assignment {launchTuple.assignmentId} ·
                                    context v{launchTuple.contextVersion} · SOP{" "}
                                    {launchTuple.sopTemplateId} v{launchTuple.sopVersion}
                                  </div>
                                  <div>
                                    Configuration: {launchTuple.portalId ?? "unresolved"}
                                    {launchTuple.mappingGeneration == null
                                      ? ""
                                      : ` · map generation ${launchTuple.mappingGeneration}`}
                                  </div>
                                  <div>
                                    Provider: {launchTuple.providerId ?? "not selected"} · Location:{" "}
                                    {launchTuple.facilityId ?? "none"}
                                  </div>
                                  <div>
                                    Launch readiness: {launchTuple.readiness.outcome} —{" "}
                                    {launchTuple.readiness.reason}
                                  </div>
                                </div>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled
                                className="mt-2"
                                title="Live portal handoff is deferred; this tuple prepares context only."
                              >
                                Work in portal
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}

              <div className="grid gap-2 border-t pt-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">First provider for form work</Label>
                  <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                    <SelectTrigger aria-label="First provider for form work">
                      <SelectValue placeholder="Choose a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.firstName} {provider.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Location (when needed)</Label>
                  <Select
                    value={selectedFacilityId || "none"}
                    onValueChange={(value) => setSelectedFacilityId(value === "none" ? "" : value)}
                  >
                    <SelectTrigger aria-label="Location for form work">
                      <SelectValue placeholder="Choose a location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No location selected</SelectItem>
                      {eligibleFacilities.map((facility) => (
                        <SelectItem key={facility.id} value={facility.id}>
                          {facility.name} · {facility.state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Provider and location remain in this drawer session. The selected Contract SOP
                  version stays assigned independently.
                </p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
