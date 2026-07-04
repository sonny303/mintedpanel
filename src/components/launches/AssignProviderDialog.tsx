// Provider assignment from a launch row (launch PRD v2.1). Two paths: link a
// provider already in the system, or jump to the existing new-provider flow
// with the location pre-selected so onboarding and the launch run in parallel.
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssignProviderToFacility, useFacilityAssignments } from "@/hooks/useLaunches";
import { useProviders } from "@/hooks/useProviders";
import { useCanWrite } from "@/lib/permissions";
import type { Facility } from "@/types";

const NONE = "__none__";

export function AssignProviderDialog({
  location,
  onClose,
}: {
  location: Facility;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const providersQ = useProviders();
  const assignmentsQ = useFacilityAssignments();
  const assign = useAssignProviderToFacility();
  const [providerId, setProviderId] = useState(NONE);

  const candidates = useMemo(() => {
    const assigned = new Set(
      (assignmentsQ.data ?? [])
        .filter((a) => a.facilityId === location.id && a.providerId)
        .map((a) => a.providerId as string),
    );
    return (providersQ.data ?? []).filter((p) => !assigned.has(p.id) && p.status !== "terminated");
  }, [assignmentsQ.data, providersQ.data, location.id]);

  // Defense in depth: never render a write surface to a read-only role, even
  // if a caller mounts this dialog without gating its trigger.
  if (!canWrite) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign provider to {location.name}</DialogTitle>
        </DialogHeader>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger>
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Select provider…</SelectItem>
            {candidates.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          className="flex items-center gap-1.5 text-[length:var(--mp-text-xs)] font-medium text-[color:var(--mp-primary)] hover:underline"
          onClick={() => navigate({ to: "/providers/new", search: { locationId: location.id } })}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Not in the system yet? Create a new provider
        </button>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={providerId === NONE || assign.isPending}
            onClick={async () => {
              try {
                await assign.mutateAsync({ providerId, facilityId: location.id });
                toast.success("Provider linked");
                onClose();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not link provider");
              }
            }}
          >
            {assign.isPending ? "Linking…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
