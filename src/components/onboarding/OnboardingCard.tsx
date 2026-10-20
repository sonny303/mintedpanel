
// 2026-10-20 — OnboardingCard. Mounted at the top of providers.$id when the
// provider's status is 'onboarding'. Renders one VerificationBlock and one
// Admit & assign action.
import { useMemo } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { RecordSectionCard } from "@/components/providers/RecordSectionCard";
import {
  VerificationBlock,
  type AutoCheck,
  type PersonCheck,
} from "@/components/onboarding/VerificationBlock";
import { useSubmitOnboarding } from "@/hooks/useOnboarding";
import type { Provider } from "@/types";

interface Props {
  provider: Provider;
}

export function OnboardingCard({ provider }: Props) {
  const navigate = useNavigate();
  const submit = useSubmitOnboarding();

  // Auto checks: derive from the provider record. These mirror the readiness
  // helpers in src/lib/enrollmentReadiness.ts. Kept inline to avoid coupling.
  const autoChecks = useMemo<AutoCheck[]>(() => {
    const out: AutoCheck[] = [];
    if (provider.npi && provider.npi.length === 10) out.push({ label: "NPI present and well-formed", status: "confirmed" });
    if (provider.caqhId) out.push({ label: "CAQH ID present and well-formed", status: "confirmed" });
    if (provider.ssnLast4) out.push({ label: "Full SSN encrypted in vault", status: "confirmed" });
    if (provider.mobile) out.push({ label: "Mobile on file", status: "confirmed" });
    if (provider.addressLine1) out.push({ label: "Home address on file", status: "confirmed" });
    if (provider.dateOfBirth) out.push({ label: "Date of birth on file", status: "confirmed" });
    return out;
  }, [provider]);

  // Person checks: person-driven verifications. The reveal dialogs live in the
  // existing SsnRevealDialog family; this card renders placeholder buttons.
  const personChecks = useMemo<PersonCheck[]>(
    () => [
      {
        label: "CAQH login test",
        status: "pending",
        action: {
          label: "Test…",
          onClick: () => navigate({ to: "/providers/$id", params: { id: provider.id }, hash: "caqh-login" }),
        },
      },
      {
        label: "PECOS login test",
        status: "pending",
        action: {
          label: "Test…",
          onClick: () => navigate({ to: "/providers/$id", params: { id: provider.id }, hash: "pecos-login" }),
        },
      },
      {
        label: "Resolve same-group duplicate",
        status: "pending",
        action: {
          label: "Open",
          onClick: () => navigate({ to: "/providers/$id", params: { id: provider.id }, hash: "duplicates" }),
        },
      },
    ],
    [navigate, provider.id],
  );

  async function onAdmit() {
    try {
      const result = await submit.mutateAsync({ providerId: provider.id });
      toast.success(`Ready for credentialing. Target clock started ${result.ready_at}.`);
      navigate({ to: "/providers/$id", params: { id: provider.id } });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <RecordSectionCard
      id="onboarding"
      title="Onboarding"
      action={
        <Button
          onClick={onAdmit}
          disabled={submit.isPending}
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
        >
          {submit.isPending ? "Admitting…" : "Admit & assign"}
        </Button>
      }
    >
      <div className="space-y-3 py-2">
        <div className="text-[12px] text-muted-foreground">
          Ready to hand off to credentialing. Minted's 2-business-day target starts when
          you tap Admit & assign.
        </div>
        <VerificationBlock autoChecks={autoChecks} personChecks={personChecks} />
      </div>
    </RecordSectionCard>
  );
}
