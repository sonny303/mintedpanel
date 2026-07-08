// First-run Portfolio state (redesign E0.0, feature F0.0.6 / enabler TE-7).
// Rendered full-page by __root in place of the AppShell when the signed-in user
// belongs to NO organization yet (so no org-scoped hook runs without an active
// org). No login or landing gate precedes it — the session simply persists
// beneath. It is the empty Portfolio: it guides the Credentialing Manager
// straight to creating her first organization, handing to E0.1 via the existing
// create_organization path (making the caller its admin; the intake hook then
// switches to it and navigates to the Portfolio, flipping __root to the
// AppShell). A sign-out escape hatch keeps her from being stuck. Built only from
// existing primitives (button/input/label) + a lucide icon.
import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";
import { useCreateOrganization } from "@/hooks/useOrganizations";

export function NoOrgScreen() {
  const navigate = useNavigate();
  const signOut = useAuthStore((s) => s.signOut);
  const createOrg = useCreateOrganization();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Organization name is required");
      return;
    }
    setError(null);
    createOrg.mutate(trimmed, {
      onSuccess: () => toast.success("Organization created"),
      onError: (e) => {
        const msg = e instanceof Error ? e.message : "Couldn't create organization";
        setError(msg);
        toast.error(msg);
      },
    });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-md border border-[#E8E5E0] bg-white p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <LayoutGrid className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[17px] font-semibold text-foreground">
          Welcome to your Portfolio
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          You don't have any organizations yet. Create your first one to start tracking
          credentialing work — you'll be its admin.
        </p>
        <div className="mt-4">
          <Label className="text-[12px]">Organization name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            className="h-9"
          />
        </div>
        {error ? (
          <div className="mt-2 text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
            {error}
          </div>
        ) : null}
        <Button
          onClick={handleCreate}
          disabled={createOrg.isPending || !name.trim()}
          className="mt-4 w-full bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
        >
          {createOrg.isPending ? "Creating…" : "Create your first organization"}
        </Button>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 w-full text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
