// First-run Portfolio state (redesign E0.0 F0.0.6 / E0.1 F0.1.2). Rendered
// full-page by __root in place of the AppShell when the signed-in user belongs
// to NO organization yet (so no org-scoped hook runs without an active org). No
// login or landing gate precedes it — the session simply persists beneath. It
// is the empty Portfolio: it guides the Credentialing Manager straight to
// creating her first organization (with required owner capture, E0.1), handing
// to the create_organization RPC. On success the intake hook switches to the new
// org and lands inside its workspace (/get-started). A sign-out escape hatch
// keeps her from being stuck. Built only from existing primitives.
import { useNavigate } from "@tanstack/react-router";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/auth-store";
import { useOrgCreateForm } from "@/hooks/useOrgCreateForm";
import { OrgCreateFields } from "@/components/org/OrgCreateFields";

export function NoOrgScreen() {
  const navigate = useNavigate();
  const signOut = useAuthStore((s) => s.signOut);
  const form = useOrgCreateForm();

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
        <p className="mt-2 mb-4 text-[13px] text-muted-foreground">
          You don't have any organizations yet. Create your first one to start tracking
          credentialing work — you'll be its admin.
        </p>
        <OrgCreateFields form={form} />
        <Button
          onClick={form.submit}
          disabled={form.isPending || !form.canSubmit}
          className="mt-4 w-full bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
        >
          {form.isPending ? "Creating…" : "Create your first organization"}
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
