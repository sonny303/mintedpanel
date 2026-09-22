// Admin hard-delete affordance on case detail. Controlled carve-out via the
// delete_case RPC — frees the 4-part key so generation can recreate the case.
import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeleteCase } from "@/hooks/useCases";
import type { CaseDetail } from "@/types";

interface DeleteCaseActionProps {
  c: CaseDetail;
  isAdmin: boolean;
}

export function DeleteCaseAction({ c, isAdmin }: DeleteCaseActionProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const deleteCaseM = useDeleteCase();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isAdmin) return null;

  const run = () => {
    deleteCaseM.mutate(c.id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success("Case deleted");
        if (router.history.canGoBack()) {
          router.history.back();
        } else {
          void navigate({ to: "/cases" });
        }
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete this case."),
    });
  };

  return (
    <div className="rounded-md border border-[#E8E5E0] p-3 flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-muted-foreground">
        Permanently remove this case and its activity. Generation can recreate it if the provider
        still qualifies.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto h-8 text-destructive border-destructive/40 hover:bg-destructive/5"
        onClick={() => setConfirmOpen(true)}
        disabled={deleteCaseM.isPending}
      >
        <Trash2 className="w-4 h-4 mr-1" /> Delete case
      </Button>

      {confirmOpen ? (
        <Dialog open onOpenChange={(o) => !o && !deleteCaseM.isPending && setConfirmOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this case?</DialogTitle>
              <DialogDescription>
                Permanently delete this case and all related activity (tasks, touch log, notes,
                status history)? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {c.caseStatus === "approved" ? (
              <p role="alert" className="text-[13px] text-foreground">
                This case is Approved — the matching live enrollment fact will be expired so
                generation can recreate the case if the provider still qualifies.
              </p>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={deleteCaseM.isPending}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={run} disabled={deleteCaseM.isPending}>
                {deleteCaseM.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
