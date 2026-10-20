// 2026-10-20 — Shared lockdown states for anonymous onboarding pages.
// Uniform responses: never reveals which token is which.
import { CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export type LockdownState = "used" | "expired" | "revoked" | "invalid";

export interface LockdownView {
  icon: typeof Clock;
  title: string;
  message: string;
}

export function lockdownFor(state: LockdownState, orgName?: string): LockdownView {
  const org = orgName ? ` for ${orgName}` : "";
  if (state === "used") {
    return {
      icon: CheckCircle2,
      title: "This form is already completed",
      message: `Thanks — the information${org} has already been submitted. If you need to make a change, contact your Minted Panel contact.`,
    };
  }
  if (state === "expired") {
    return {
      icon: Clock,
      title: "This link has expired",
      message: `For security, these links expire after 72 hours. Contact your Minted Panel contact and we'll send you a new one.`,
    };
  }
  // revoked or invalid — never confirm which provider a bad token targets.
  return {
    icon: Clock,
    title: "This link is no longer valid",
    message: `This link can't be used. Contact your Minted Panel contact to request a new one.`,
  };
}

export function Lockdown({ icon: Icon, title, message }: LockdownView) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-[16px] font-semibold text-foreground">{title}</div>
        <p className="max-w-sm text-[13px] text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
