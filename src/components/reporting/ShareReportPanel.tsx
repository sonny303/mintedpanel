// Operator surface to generate a secure, read-only, scope-filtered share of the
// Portfolio report (redesign E0.6, F0.6.5 / TE-5). Composed from existing
// primitives. Stage 0 has no email send infra (like E0.5) — the copy-able link
// is shown once at issue. Full (internal, P4) or single-org (a practice owner,
// P5) scope; the single-org filter is enforced server-side (TE-6).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReportShares, useCreateReportShare, useRevokeReportShare } from "@/hooks/useReporting";
import { usePortfolio } from "@/hooks/usePortfolio";
import { isValidEmail } from "@/lib/contactValidation";
import { fmtDate } from "@/lib/format";
import { useAuthStore } from "@/lib/auth-store";
import type { IssuedReportShare, ReportShare, ReportShareScope } from "@/types";

const REPORT_KEY = "portfolio";

function shareUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/share/${token}`;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select and copy manually");
  }
}

export function ShareReportPanel() {
  const { data: shares } = useReportShares(REPORT_KEY);
  const { data: orgs } = usePortfolio();
  const create = useCreateReportShare(REPORT_KEY);
  const revoke = useRevokeReportShare(REPORT_KEY);
  const orgName = useAuthStore((s) => s.memberships);

  const [scope, setScope] = useState<ReportShareScope>("full");
  const [scopeOrgId, setScopeOrgId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [issued, setIssued] = useState<IssuedReportShare | null>(null);

  const active = useMemo(() => (shares ?? []).filter((s) => s.state === "active"), [shares]);
  const orgLabel = (id: string | null) =>
    orgName.find((m) => m.orgId === id)?.orgName ?? orgs?.find((o) => o.id === id)?.name ?? "—";

  const canCreate =
    isValidEmail(email.trim()) && (scope === "full" || Boolean(scopeOrgId)) && !create.isPending;

  function onCreate() {
    create.mutate(
      {
        reportKey: REPORT_KEY,
        scope,
        scopeOrgId: scope === "single_org" ? scopeOrgId : null,
        recipientEmail: email.trim(),
      },
      {
        onSuccess: (result) => {
          setIssued(result);
          setEmail("");
          toast.success("Share link ready");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't create share"),
      },
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold text-foreground">Share this report</h2>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Send a secure, read-only link — the full portfolio for a colleague, or a single
          organization for that practice's owner. Links expire in 30 days and can be revoked
          anytime. No login is required to view.
        </p>

        {issued ? (
          <div className="space-y-2 rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3">
            <div className="text-[12px] font-medium text-[#92400E]">
              Copy the link and send it to {issued.recipientEmail}. It won't be shown again.
            </div>
            <div className="flex gap-2">
              <Input readOnly value={shareUrl(issued.token)} className="h-9 bg-white" />
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0"
                onClick={() => copy(shareUrl(issued.token), "Link")}
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-[12px]"
              onClick={() => setIssued(null)}
            >
              Create another share
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-[12px]" htmlFor="share-scope">
                  Scope
                </Label>
                <Select value={scope} onValueChange={(v) => setScope(v as ReportShareScope)}>
                  <SelectTrigger id="share-scope" className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full portfolio</SelectItem>
                    <SelectItem value="single_org">A single organization</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scope === "single_org" ? (
                <div>
                  <Label className="text-[12px]" htmlFor="share-org">
                    Organization
                  </Label>
                  <Select value={scopeOrgId} onValueChange={setScopeOrgId}>
                    <SelectTrigger id="share-org" className="mt-1 h-9">
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {(orgs ?? []).map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div>
              <Label className="text-[12px]" htmlFor="share-email">
                Recipient email
              </Label>
              <Input
                id="share-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <Button
              type="button"
              onClick={onCreate}
              disabled={!canCreate}
              className="bg-[#1B4D3E] text-white hover:bg-[#163E32]"
            >
              <Link2 className="h-4 w-4" />
              Create share link
            </Button>
          </div>
        )}

        {active.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Active shares
            </div>
            {active.map((s: ReportShare) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-md border border-[#E8E5E0] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {s.recipientEmail}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="secondary">
                      {s.scope === "full" ? "Full portfolio" : orgLabel(s.scopeOrgId)}
                    </Badge>
                    <span>Expires {fmtDate(s.expiresAt)}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 shrink-0 text-[12px] text-destructive"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(s.id, {
                      onSuccess: () => toast.success("Share revoked"),
                      onError: (e) =>
                        toast.error(e instanceof Error ? e.message : "Couldn't revoke"),
                    })
                  }
                >
                  <X className="h-4 w-4" />
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
