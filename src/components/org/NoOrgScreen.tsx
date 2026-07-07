// Bootstrap screen for a signed-in user who belongs to NO organization yet.
// Rendered full-page by __root in place of the AppShell (so no org-scoped hook
// runs without an active org). Creating an org makes the caller its admin; the
// intake hook then switches to it and navigates Home, which flips __root back
// to the AppShell. A sign-out escape hatch is provided so the user isn't stuck.
import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
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
        <h1 className="text-[17px] font-semibold text-foreground">Create your organization</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          You're not part of any organization yet. Create one to get started — you'll be its admin.
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
          {createOrg.isPending ? "Creating…" : "Create organization"}
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
