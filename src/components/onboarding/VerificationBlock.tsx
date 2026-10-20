
// 2026-10-20 — VerificationBlock presentational component. One auto line +
// one row per person check. Stores no state; the parent drives the data.
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AutoCheck {
  label: string;
  status: "confirmed";
}

export interface PersonCheck {
  label: string;
  status: "pending";
  action: { label: string; onClick: () => void; disabled?: boolean };
}

interface Props {
  autoChecks: AutoCheck[];
  personChecks: PersonCheck[];
}

export function VerificationBlock({ autoChecks, personChecks }: Props) {
  const autoCount = autoChecks.length;
  return (
    <div className="space-y-3">
      {autoCount > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-[#D1FAE5] bg-[#ECFDF5] px-3 py-2 text-[13px] text-[#065F46]">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            <strong>{autoCount} confirmed</strong> · Auto
          </span>
        </div>
      ) : null}
      <div className="space-y-1.5">
        {personChecks.map((p, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="flex items-center gap-2 text-[13px]">
              <Circle className="h-4 w-4 text-muted-foreground" />
              <span>{p.label}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={p.action.onClick}
              disabled={p.action.disabled}
            >
              {p.action.label}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
