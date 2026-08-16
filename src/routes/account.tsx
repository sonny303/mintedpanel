// /account — the signed-in user's own settings (2026-08-16).
//
// The sidebar footer's "Settings" item lands here. It used to land on
// /org-detail, which was the F6.1.4 consolidation's answer while no personal
// settings page existed; PR #228 then removed the last personal control from
// that page ("Your name") precisely because a user setting did not belong on an
// org page. This is that setting's proper home, so the footer now points here
// and /org-detail is purely organization-level.
//
// SCOPE: name and title are USER-level (the same in every org). The role badge
// is per-ACTIVE-ORG and read-only — role is granted by an admin on Org Detail,
// never self-assigned, so it is shown for orientation only.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { useMyProfile, useUpdateMyProfile } from "@/hooks/useUserProfile";
import { useActiveMembership } from "@/lib/auth-store";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";

export const Route = createFileRoute("/account")({
  component: AccountPage,
});

function AccountPage() {
  const profileQ = useMyProfile();
  const updateM = useUpdateMyProfile();
  const active = useActiveMembership();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Seed the form ONCE from the server value. Re-seeding on every render of a
  // refetched query would stomp whatever the user is currently typing.
  useEffect(() => {
    if (loaded || !profileQ.data) return;
    setFirstName(profileQ.data.firstName ?? "");
    setLastName(profileQ.data.lastName ?? "");
    setTitle(profileQ.data.title ?? "");
    setLoaded(true);
  }, [profileQ.data, loaded]);

  const profile = profileQ.data;
  const dirty =
    loaded &&
    (firstName !== (profile?.firstName ?? "") ||
      lastName !== (profile?.lastName ?? "") ||
      title !== (profile?.title ?? ""));

  // A name is what fills onto payer forms and what every audit row displays, so
  // an empty save is a mistake worth blocking rather than silently storing.
  const nameMissing = firstName.trim() === "" && lastName.trim() === "";

  function handleSave() {
    if (nameMissing) return;
    updateM.mutate(
      { firstName, lastName, title },
      {
        onSuccess: () => toast.success("Profile saved"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save profile"),
      },
    );
  }

  if (profileQ.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My account" />
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-24 rounded-md" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (profileQ.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="My account" />
        <Card>
          <CardContent className="p-4">
            <p className="text-[14px] text-[#B91C1C]">
              Couldn&apos;t load your profile. Refresh to try again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My account"
        description="Your name and title. These are the same across every organization you belong to."
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-[15px] font-semibold text-foreground">Your details</h2>

          {/* Captured SPLIT, like the party contact form, because payer forms
              ask for first and last in separate boxes — the composed display
              name is derived at the service boundary, never retyped. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[12px]" htmlFor="account-first-name">
                First name
              </Label>
              <Input
                id="account-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                aria-invalid={nameMissing ? true : undefined}
                aria-describedby={nameMissing ? "account-name-error" : undefined}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-[12px]" htmlFor="account-last-name">
                Last name
              </Label>
              <Input
                id="account-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                aria-invalid={nameMissing ? true : undefined}
                className="h-9"
              />
            </div>
          </div>
          {nameMissing ? (
            <div
              id="account-name-error"
              aria-live="polite"
              className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-2.5 py-1.5 text-[12px] text-[#B91C1C]"
            >
              Enter your name — it appears on payer forms and on everything you record.
            </div>
          ) : null}

          <div>
            <Label className="text-[12px]" htmlFor="account-title">
              Title <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="account-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Credentialing Manager"
              className="h-9"
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              Used to fill the preparer fields on payer forms and portals.
            </p>
          </div>

          <div>
            <Label className="text-[12px]" htmlFor="account-email">
              Email
            </Label>
            {/* readOnly, NOT disabled: a disabled input renders its value at
                placeholder contrast, so a real address reads as a placeholder.
                readOnly keeps it uneditable but selectable/copyable. */}
            <Input
              id="account-email"
              value={profile?.email ?? ""}
              readOnly
              className="h-9 bg-muted/40 text-muted-foreground"
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              Your sign-in email can&apos;t be changed here.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={handleSave}
              disabled={!dirty || nameMissing || updateM.isPending}
              className="bg-[#1B4D3E] hover:bg-[#163F33]"
            >
              {updateM.isPending ? "Saving…" : "Save changes"}
            </Button>
            {dirty && !updateM.isPending ? (
              <span className="text-[12px] text-muted-foreground">Unsaved changes</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Role is granted by an admin, never self-assigned — read-only by
          design, shown so a user can see what they can do and who to ask. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-[15px] font-semibold text-foreground">Access</h2>
          {active ? (
            <>
              <div className="flex items-center gap-2">
                <StatusPill status="brand" label={ROLE_LABELS[active.role] ?? active.role} />
                <span className="text-[14px] text-foreground">in {active.orgName}</span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {ROLE_DESCRIPTIONS[active.role]} Your role is set by an administrator — see{" "}
                <Link to="/org-detail" className="text-primary underline underline-offset-2">
                  Org Detail
                </Link>{" "}
                for who has access to this organization.
              </p>
            </>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              Select an organization to see your role.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
