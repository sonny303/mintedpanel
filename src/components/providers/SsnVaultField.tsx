// E4.4 — the SSN row on the provider Identity card. Renders at most the mask
// (***--1234), plus role-gated vault actions: admins can Click-to-Reveal (only
// when an SSN is on file), writers can enter it securely or send a secure intake
// link. Non-writers see the mask alone, with no controls.
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import { maskSsn } from "@/lib/ssnMask";
import { useSsnIntakeLink } from "@/hooks/useSsnVault";
import type { Provider } from "@/types";
import { SsnRevealDialog } from "./SsnRevealDialog";
import { SsnStoreDialog } from "./SsnStoreDialog";
import { SsnIntakeLinkDialog } from "./SsnIntakeLinkDialog";

type VaultDialog = "reveal" | "store" | "link" | null;

export function SsnVaultField({ provider }: { provider: Provider }) {
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();
  const hasSsn = Boolean(provider.ssnLast4);
  const providerName = `${provider.firstName} ${provider.lastName}`.trim();
  const [dialog, setDialog] = useState<VaultDialog>(null);

  // Operator status: an outstanding intake link the recipient hasn't used yet.
  const linkQ = useSsnIntakeLink(provider.id);
  const pendingLink = canWrite && linkQ.data?.state === "active";

  const showMenu = canWrite || (isAdmin && hasSsn);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="tabular-nums">{maskSsn(provider.ssnLast4)}</span>
        {showMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Manage SSN">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {isAdmin && hasSsn ? (
                <DropdownMenuItem onSelect={() => setDialog("reveal")}>
                  Reveal full SSN
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem onSelect={() => setDialog("store")}>
                  {hasSsn ? "Update full SSN" : "Enter full SSN securely"}
                </DropdownMenuItem>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem onSelect={() => setDialog("link")}>
                  Send secure intake link
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {pendingLink ? (
        <span className="text-[11px] text-muted-foreground">Secure intake link pending</span>
      ) : null}

      {isAdmin ? (
        <SsnRevealDialog
          providerId={provider.id}
          providerName={providerName}
          open={dialog === "reveal"}
          onOpenChange={(o) => setDialog(o ? "reveal" : null)}
        />
      ) : null}
      {canWrite ? (
        <>
          <SsnStoreDialog
            providerId={provider.id}
            providerName={providerName}
            hasSsn={hasSsn}
            open={dialog === "store"}
            onOpenChange={(o) => setDialog(o ? "store" : null)}
          />
          <SsnIntakeLinkDialog
            providerId={provider.id}
            providerName={providerName}
            open={dialog === "link"}
            onOpenChange={(o) => setDialog(o ? "link" : null)}
          />
        </>
      ) : null}
    </div>
  );
}
