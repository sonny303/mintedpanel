// Scope Review wizard section body (E1.8) — the last E1.0 preview to go
// live: the derived enrollment-readiness matrix at the E2.x case-key grain
// (provider × group × payer × state). Everything here is ADVISORY (F1.8.3):
// red items carry fix-here links and nothing is ever disabled or gated; no
// tasks are auto-created. Checks with an exact editor link to their wizard
// section; document/COI/voided-check gaps link to the owning group screen
// (PM decision [e1.8] Option 3, 2026-07-12). No readiness state is stored —
// the matrix re-derives from the source caches on every read (F1.8.1).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { openSection } from "@/components/onboarding/openSection";
import { useEnrollmentReadiness } from "@/hooks/useEnrollmentReadiness";
import {
  filterReadinessRows,
  type FixTarget,
  type ReadinessCheck,
  type ReadinessCheckKey,
  type ReadinessFilters,
  type ReadinessRow,
} from "@/lib/enrollmentReadiness";
import { ONBOARDING_SECTIONS } from "@/lib/onboardingProgress";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

const PROVIDERS_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "providers");
const FACILITIES_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "facilities");
const PAYER_NETWORK_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "payer_network");

// The gap-type filter offers every check in checklist order.
const GAP_OPTIONS: Array<{ key: ReadinessCheckKey; label: string }> = [
  { key: "license_present", label: "License missing" },
  { key: "license_current", label: "License expired" },
  { key: "license_verified", label: "License not verified" },
  { key: "caqh_id", label: "CAQH ID missing" },
  { key: "caqh_current", label: "CAQH stale" },
  { key: "npi", label: "NPI missing" },
  { key: "demographics", label: "Demographics incomplete" },
  { key: "malpractice_current", label: "Malpractice lapsed" },
  { key: "state_facility", label: "No facility in state" },
  { key: "w9", label: "W-9 missing" },
  { key: "group_coi", label: "Group COI missing/expired" },
  { key: "voided_check", label: "Voided check missing" },
];

const ALL_FILTERS: ReadinessFilters = { groupId: "all", payerId: "all", state: "all", gap: "all" };

function FixHereLink({ check }: { check: ReadinessCheck }) {
  const target: FixTarget = check.fixTarget;
  if (target === "group_screen") {
    // Document/COI/voided-check gaps: soft link to the owning group screen
    // until a documents surface lands ([e1.8] Option 3).
    return (
      <Link to="/get-started" className="text-[12px] underline underline-offset-2">
        Fix on Account Detail
      </Link>
    );
  }
  const def = target === "facilities_section" ? FACILITIES_DEF : PROVIDERS_DEF;
  if (!def) return null;
  return (
    <button
      type="button"
      className="text-[12px] underline underline-offset-2"
      onClick={() => openSection(def)}
    >
      Fix in {def.title}
    </button>
  );
}

function CheckList({ checks, owner }: { checks: ReadinessCheck[]; owner: "provider" | "group" }) {
  const list = checks.filter((c) => c.owner === owner);
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {owner === "provider" ? "Provider checklist" : "Group checklist"}
      </div>
      <ul className="mt-1.5 space-y-1">
        {list.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-[12px]">
            {c.pass ? (
              <Check className="h-3.5 w-3.5 flex-none text-[var(--mp-ok-ink)]" />
            ) : (
              <X className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
            )}
            <span className={c.pass ? "text-foreground" : "text-[var(--mp-danger-ink)]"}>
              {c.label}
            </span>
            {c.detail ? <span className="text-muted-foreground">— {c.detail}</span> : null}
            {!c.pass ? <FixHereLink check={c} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScopeReviewSection({ wizard }: SectionBodyProps) {
  const readiness = useEnrollmentReadiness();
  const [filters, setFilters] = useState<ReadinessFilters>(ALL_FILTERS);
  const [open, setOpen] = useState<string | null>(null);

  if (readiness.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load readiness inputs.</p>
        <Button variant="outline" size="sm" onClick={readiness.refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (!readiness.rows) {
    return <Skeleton className="h-16 w-full" />;
  }

  if (readiness.rows.length === 0) {
    const hasTargets = wizard.payerNetworkTargets.some((t) => t.status === "active");
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-muted-foreground">
          Readiness rows derive from active payer network targets and each group&apos;s roster —
          {hasTargets
            ? " assign providers to the targeted groups to see their pre-flight checks here."
            : " attach payers in the Payer Network section to see pre-flight checks here."}
        </p>
        {!hasTargets && PAYER_NETWORK_DEF ? (
          <Button variant="outline" onClick={() => openSection(PAYER_NETWORK_DEF)}>
            <ArrowRight className="h-4 w-4" />
            Go to Payer Network
          </Button>
        ) : null}
      </div>
    );
  }

  const groupName = (id: string) =>
    readiness.groups.find((g) => g.id === id)?.name ?? "Unknown group";
  const payerName = (id: string) =>
    readiness.payers.find((p) => p.id === id)?.name ?? "Unknown payer";
  const states = Array.from(new Set(readiness.rows.map((r) => r.state))).sort();
  const groupIds = Array.from(new Set(readiness.rows.map((r) => r.groupId)));
  const payerIds = Array.from(new Set(readiness.rows.map((r) => r.payerId)));

  const visible = filterReadinessRows(readiness.rows, filters);
  const rowKey = (r: ReadinessRow) => `${r.providerId}|${r.groupId}|${r.payerId}|${r.state}`;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-muted-foreground">
          The pre-flight check before enrollment starts: one row per provider, group, payer, and
          state from your active payer targets. Readiness is advisory — nothing here blocks case
          work.
        </p>
        {/* E2.0 entry affordance: the generation preview shares this row
            universe (candidates are its clinic-assigned subset). */}
        <Button asChild className="shrink-0 bg-[#1B4D3E] hover:bg-[#163F33]">
          <Link to="/generation">Generate applications</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.groupId}
          onValueChange={(v) => setFilters((f) => ({ ...f, groupId: v }))}
        >
          <SelectTrigger className="h-8 w-[170px] text-[12px]" aria-label="Filter by group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All groups</SelectItem>
            {groupIds.map((id) => (
              <SelectItem key={id} value={id}>
                {groupName(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.payerId}
          onValueChange={(v) => setFilters((f) => ({ ...f, payerId: v }))}
        >
          <SelectTrigger className="h-8 w-[170px] text-[12px]" aria-label="Filter by payer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payers</SelectItem>
            {payerIds.map((id) => (
              <SelectItem key={id} value={id}>
                {payerName(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.state}
          onValueChange={(v) => setFilters((f) => ({ ...f, state: v }))}
        >
          <SelectTrigger className="h-8 w-[110px] text-[12px]" aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.gap}
          onValueChange={(v) => setFilters((f) => ({ ...f, gap: v as ReadinessFilters["gap"] }))}
        >
          <SelectTrigger className="h-8 w-[200px] text-[12px]" aria-label="Filter by gap type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All gap types</SelectItem>
            {GAP_OPTIONS.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {readiness.summary ? (
          <span className="ml-auto text-[12px] text-muted-foreground">
            {readiness.summary.ready} of {readiness.summary.total} ready
          </span>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No rows match the current filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Readiness</TableHead>
            </TableRow>
          </TableHeader>
          {visible.map((r) => {
            const key = rowKey(r);
            const isOpen = open === key;
            return (
              <Collapsible
                key={key}
                asChild
                open={isOpen}
                onOpenChange={(o) => setOpen(o ? key : null)}
              >
                <TableBody>
                  <CollapsibleTrigger asChild>
                    <TableRow
                      className="cursor-pointer"
                      aria-label={`Readiness for ${r.providerName} — ${payerName(r.payerId)} ${r.state}`}
                    >
                      <TableCell className="text-[13px] font-medium">{r.providerName}</TableCell>
                      <TableCell className="text-[13px]">{groupName(r.groupId)}</TableCell>
                      <TableCell className="text-[13px]">{payerName(r.payerId)}</TableCell>
                      <TableCell className="text-[13px]">{r.state}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          {r.ready ? (
                            <Badge className="rounded-full border-0 bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]">
                              Ready
                            </Badge>
                          ) : (
                            <Badge className="rounded-full border-0 bg-[var(--mp-danger-tint)] text-[var(--mp-danger-ink)]">
                              {r.openGaps} {r.openGaps === 1 ? "gap" : "gaps"}
                            </Badge>
                          )}
                          <ChevronDown
                            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </span>
                      </TableCell>
                    </TableRow>
                  </CollapsibleTrigger>
                  <CollapsibleContent asChild>
                    <TableRow>
                      <TableCell colSpan={5} className="bg-[var(--mp-neutral-tint)]/40">
                        <div className="grid gap-4 py-1 sm:grid-cols-2">
                          <CheckList checks={r.checks} owner="provider" />
                          <CheckList checks={r.checks} owner="group" />
                        </div>
                      </TableCell>
                    </TableRow>
                  </CollapsibleContent>
                </TableBody>
              </Collapsible>
            );
          })}
        </Table>
      )}
    </div>
  );
}
