// State-license editor with the PSV trail (E1.3 F1.3.3). Multiple licenses
// per provider; each row carries state, number, type (full/compact),
// issue/expiration dates, and the verification controls: status select +
// the optional state-board lookup URL. The service stamps verifier/timestamp
// server-side. Editing an expiration date resets the row to unverified on
// save (renewal reset) — the row shows an inline note when that will happen.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/StatusPill";
import { fmtDate } from "@/lib/format";
import { US_STATES } from "@/lib/usStates";
import type { PsvStatus } from "@/lib/licensePsv";
import { EMPTY_LICENSE_DRAFT, type LicenseDraft } from "@/components/onboarding/licenseDraft";

const PSV_PILL: Record<PsvStatus, { color: "neutral" | "green" | "red"; label: string }> = {
  unverified: { color: "neutral", label: "Unverified" },
  verified: { color: "green", label: "Verified" },
  failed: { color: "red", label: "Failed" },
};

interface LicenseListEditorProps {
  value: LicenseDraft[];
  onChange: (next: LicenseDraft[]) => void;
  errors: Record<number, string>;
}

export function LicenseListEditor({ value, onChange, errors }: LicenseListEditorProps) {
  const setRow = (index: number, patch: Partial<LicenseDraft>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      {value.map((row, i) => {
        const pill = PSV_PILL[row.verifiedStatus];
        const willReset =
          row.id !== undefined &&
          row.storedExpirationDate !== undefined &&
          row.expirationDate !== (row.storedExpirationDate ?? "") &&
          row.verifiedStatus !== "unverified";
        return (
          <div
            key={row.id ?? `new-${i}`}
            className="space-y-3 rounded-md border border-[#E8E5E0] p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <StatusPill status={pill.color} label={pill.label} />
                {row.storedVerifiedAt && row.verifiedStatus === "verified" ? (
                  <span className="text-[12px] text-muted-foreground">
                    Verified {fmtDate(row.storedVerifiedAt)}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground"
                aria-label={`Remove license ${i + 1}`}
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* 3-per-row, not 4: native date inputs need ~160px for
                mm/dd/yyyy + the picker icon, and four equal columns in this
                dialog clip the icon (user-reported 2026-07-19). */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor={`lic-${i}-state`} className="text-[12px]">
                  State
                </Label>
                <Select
                  value={row.state || "__none__"}
                  onValueChange={(s) => setRow(i, { state: s === "__none__" ? "" : s })}
                >
                  <SelectTrigger id={`lic-${i}-state`} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {US_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`lic-${i}-number`} className="text-[12px]">
                  License number
                </Label>
                <Input
                  id={`lic-${i}-number`}
                  value={row.licenseNumber}
                  onChange={(e) => setRow(i, { licenseNumber: e.target.value })}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor={`lic-${i}-type`} className="text-[12px]">
                  Type
                </Label>
                <Select
                  value={row.licenseType}
                  onValueChange={(t) => setRow(i, { licenseType: t })}
                >
                  <SelectTrigger id={`lic-${i}-type`} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor={`lic-${i}-issue`} className="text-[12px]">
                  Issued
                </Label>
                <Input
                  id={`lic-${i}-issue`}
                  type="date"
                  value={row.issueDate}
                  onChange={(e) => setRow(i, { issueDate: e.target.value })}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor={`lic-${i}-expiration`} className="text-[12px]">
                  Expires
                </Label>
                <Input
                  id={`lic-${i}-expiration`}
                  type="date"
                  value={row.expirationDate}
                  onChange={(e) => setRow(i, { expirationDate: e.target.value })}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor={`lic-${i}-psv`} className="text-[12px]">
                  Verification
                </Label>
                <Select
                  value={row.verifiedStatus}
                  onValueChange={(v) => setRow(i, { verifiedStatus: v as PsvStatus })}
                >
                  <SelectTrigger id={`lic-${i}-psv`} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unverified">Unverified</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor={`lic-${i}-url`} className="text-[12px]">
                State-board lookup URL (optional)
              </Label>
              <Input
                id={`lic-${i}-url`}
                value={row.verificationSourceUrl}
                onChange={(e) => setRow(i, { verificationSourceUrl: e.target.value })}
                className="h-9"
              />
            </div>
            {willReset ? (
              <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
                The expiration date changed — this license returns to Unverified on save (re-verify
                against the state board after renewal).
              </p>
            ) : null}
            {errors[i] ? <p className="text-[12px] text-[#B91C1C]">{errors[i]}</p> : null}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...value, { ...EMPTY_LICENSE_DRAFT }])}
      >
        <Plus className="h-4 w-4" />
        Add license
      </Button>
    </div>
  );
}
