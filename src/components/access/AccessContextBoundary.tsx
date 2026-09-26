import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/auth-store";
import type { EnrollmentClientOrg, EnrollmentStaffOrg } from "@/services/clientAccess";

interface AccessContextBoundaryProps {
  children: ReactNode;
}

function BoundaryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-lg">{children}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <BoundaryFrame>
      <div className="rounded-md border border-border bg-card p-6 text-[13px] text-muted-foreground">
        Resolving your access context…
      </div>
    </BoundaryFrame>
  );
}

function FailureState({ message }: { message: string }) {
  const loadAccessContext = useAuthStore((state) => state.loadAccessContext);
  return (
    <BoundaryFrame>
      <div className="rounded-md border border-destructive/30 bg-card p-6">
        <h1 className="text-[16px] font-semibold">Access context unavailable</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">{message}</p>
        <Button
          className="mt-4 h-9"
          onClick={() => void loadAccessContext().catch(() => undefined)}
        >
          Retry
        </Button>
      </div>
    </BoundaryFrame>
  );
}

function DeniedState({ title, message }: { title: string; message: string }) {
  const signOut = useAuthStore((state) => state.signOut);
  return (
    <BoundaryFrame>
      <div className="rounded-md border border-destructive/30 bg-card p-6">
        <h1 className="text-[16px] font-semibold">{title}</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">{message}</p>
        <Button className="mt-4 h-9" variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </BoundaryFrame>
  );
}

function AudienceChooser({
  staffOrgs,
  clientOrgs,
}: {
  staffOrgs: EnrollmentStaffOrg[];
  clientOrgs: EnrollmentClientOrg[];
}) {
  const selectAccessContext = useAuthStore((state) => state.selectAccessContext);
  const setActiveOrg = useAuthStore((state) => state.setActiveOrg);
  const [pending, setPending] = useState<"staff" | "client" | null>(null);

  async function choose(audience: "staff" | "client", orgId: string) {
    setPending(audience);
    try {
      await selectAccessContext({ audience, orgId });
      if (audience === "staff") setActiveOrg(orgId);
    } finally {
      setPending(null);
    }
  }

  return (
    <BoundaryFrame>
      <div className="rounded-md border border-border bg-card p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[17px] font-semibold">Choose an access context</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          This account has internal and client access. Choose one before data loads.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[12px] font-semibold text-muted-foreground">
              Internal workspace
            </div>
            <div className="mt-2 grid gap-2">
              {staffOrgs.map((org) => (
                <button
                  key={org.orgId}
                  type="button"
                  className="rounded-md border border-border p-3 text-left text-[13px] transition-colors hover:bg-muted disabled:opacity-50"
                  disabled={pending !== null}
                  onClick={() => void choose("staff", org.orgId).catch(() => undefined)}
                >
                  {org.orgName}
                  {pending === "staff" ? <span className="ml-2 text-[11px]">Loading…</span> : null}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-muted-foreground">Client context</div>
            <div className="mt-2 grid gap-2">
              {clientOrgs.map((org) => (
                <button
                  key={org.orgId}
                  type="button"
                  className="rounded-md border border-border p-3 text-left text-[13px] transition-colors hover:bg-muted disabled:opacity-50"
                  disabled={pending !== null}
                  onClick={() => void choose("client", org.orgId).catch(() => undefined)}
                >
                  {org.orgName}
                  {pending === "client" ? <span className="ml-2 text-[11px]">Loading…</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </BoundaryFrame>
  );
}

function ClientOrgChooser({ orgs }: { orgs: EnrollmentClientOrg[] }) {
  const selectAccessContext = useAuthStore((state) => state.selectAccessContext);
  const [pending, setPending] = useState(false);

  return (
    <BoundaryFrame>
      <div className="rounded-md border border-border bg-card p-6">
        <h1 className="text-[17px] font-semibold">Choose a client organization</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Select the organization whose assigned provider groups you want to view.
        </p>
        <div className="mt-5 grid gap-2">
          {orgs.map((org) => (
            <button
              key={org.orgId}
              type="button"
              className="rounded-md border border-border p-3 text-left text-[13px] transition-colors hover:bg-muted disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                setPending(true);
                void selectAccessContext({ audience: "client", orgId: org.orgId })
                  .catch(() => undefined)
                  .finally(() => setPending(false));
              }}
            >
              <span className="font-semibold">{org.orgName}</span>
              <span className="ml-2 text-muted-foreground">
                {org.groups.length} group{org.groups.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </BoundaryFrame>
  );
}

function ClientContextSurface({
  orgs,
  canSwitchToStaff,
  staffOrgs,
}: {
  orgs: EnrollmentClientOrg[];
  canSwitchToStaff: boolean;
  staffOrgs: EnrollmentStaffOrg[];
}) {
  const loadAccessContext = useAuthStore((state) => state.loadAccessContext);
  const signOut = useAuthStore((state) => state.signOut);
  const setActiveOrg = useAuthStore((state) => state.setActiveOrg);
  const selectedOrgId = useAuthStore((state) => state.accessContext?.selectedOrgId);
  const [switching, setSwitching] = useState(false);
  const selected = orgs.find((org) => org.orgId === selectedOrgId);

  async function switchToStaff(orgId: string) {
    setSwitching(true);
    try {
      await loadAccessContext({ audience: "staff", orgId });
      setActiveOrg(orgId);
    } finally {
      setSwitching(false);
    }
  }

  if (!selected) {
    return (
      <DeniedState
        title="Client organization is unavailable"
        message="Refresh your access context before viewing client data."
      />
    );
  }

  return (
    <BoundaryFrame>
      <div className="rounded-md border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
        <h1 className="mt-4 text-[17px] font-semibold">Client access context ready</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Access is limited to the verified organization and provider groups below. The report
          surface is enabled by the later enrollment explorer slice.
        </p>
        <div className="mt-5 rounded-md border border-border bg-muted/40 p-4">
          <div className="text-[13px] font-semibold">{selected.orgName}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.groups.map((group) => (
              <span
                key={group.groupId}
                className="rounded-full bg-background px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                {group.groupName}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button asChild className="h-9">
            <Link to="/reporting/enrollment-explorer">Open Enrollment Explorer</Link>
          </Button>
        </div>
        {canSwitchToStaff ? (
          <div className="mt-5">
            <div className="text-[12px] font-semibold text-muted-foreground">
              Switch to internal workspace
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {staffOrgs.map((org) => (
                <Button
                  key={org.orgId}
                  variant="outline"
                  className="h-9"
                  disabled={switching}
                  onClick={() => void switchToStaff(org.orgId).catch(() => undefined)}
                >
                  {switching ? "Switching…" : org.orgName}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </BoundaryFrame>
  );
}

export function AccessContextBoundary({ children }: AccessContextBoundaryProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = useAuthStore((state) => state.session);
  const context = useAuthStore((state) => state.accessContext);
  const loading = useAuthStore((state) => state.accessContextLoading);
  const membershipsLoading = useAuthStore((state) => state.membershipsLoading);
  const error = useAuthStore((state) => state.accessContextError);

  if (!session) return <>{children}</>;
  if (error) return <FailureState message={error} />;
  if (loading || membershipsLoading || !context) return <LoadingState />;

  const hasStaff = context.staffOrgs.length > 0;
  const hasClient = context.clientOrgs.length > 0;
  const selectedClientOrg =
    context.audience === "client"
      ? context.clientOrgs.find((org) => org.orgId === context.selectedOrgId)
      : null;
  const selectedClientHasGroups = (selectedClientOrg?.groups.length ?? 0) > 0;
  if (context.restrictedExternal && !hasClient) {
    return (
      <DeniedState
        title="Client access is unavailable"
        message="This verified account has no active organization or provider-group assignment. Ask an administrator to reissue access."
      />
    );
  }
  if (hasClient && context.audience === "client" && !context.selectedOrgId) {
    return <ClientOrgChooser orgs={context.clientOrgs} />;
  }
  if (context.audience === "client" && (!selectedClientOrg || !selectedClientHasGroups)) {
    return (
      <DeniedState
        title="No provider groups assigned"
        message="Your client access is active, but no provider groups are currently assigned. Ask an administrator to update access."
      />
    );
  }
  if (context.restrictedExternal && context.audience !== "client") {
    return (
      <DeniedState
        title="Client access context required"
        message="This account cannot use an internal workspace without an active operator authorization."
      />
    );
  }
  if (hasStaff && hasClient && !context.audience) {
    return <AudienceChooser staffOrgs={context.staffOrgs} clientOrgs={context.clientOrgs} />;
  }
  if (hasClient && (context.audience === "client" || context.restrictedExternal)) {
    const isAllowedClientRoute =
      pathname.startsWith("/reporting/enrollment-explorer") ||
      pathname === "/reporting" ||
      pathname === "/reporting/" ||
      pathname.startsWith("/account");

    if (isAllowedClientRoute) {
      return <>{children}</>;
    }

    return (
      <ClientContextSurface
        orgs={context.clientOrgs}
        canSwitchToStaff={hasStaff && !context.restrictedExternal}
        staffOrgs={context.staffOrgs}
      />
    );
  }
  if (context.restrictedExternal) {
    return (
      <DeniedState
        title="Client access context required"
        message="This account cannot use an internal workspace without an active operator authorization."
      />
    );
  }
  if (hasStaff && hasClient && context.audience === "staff") {
    return (
      <>
        <div className="border-b border-border bg-muted/30 px-4 py-2 text-right text-[12px]">
          <AudienceSwitcher clientOrgs={context.clientOrgs} />
        </div>
        {children}
      </>
    );
  }
  return <>{children}</>;
}

function AudienceSwitcher({ clientOrgs }: { clientOrgs: EnrollmentClientOrg[] }) {
  const selectAccessContext = useAuthStore((state) => state.selectAccessContext);
  const [switching, setSwitching] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="text-muted-foreground">Switch to client:</span>
      {clientOrgs.map((org) => (
        <button
          key={org.orgId}
          type="button"
          className="rounded border border-border bg-background px-2 py-1 hover:bg-muted disabled:opacity-50"
          disabled={switching}
          onClick={() => {
            setSwitching(true);
            void selectAccessContext({ audience: "client", orgId: org.orgId })
              .catch(() => undefined)
              .finally(() => setSwitching(false));
          }}
        >
          {org.orgName}
        </button>
      ))}
    </span>
  );
}
