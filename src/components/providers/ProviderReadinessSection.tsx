// Provider-scoped readiness review (relocated 2026-07-21 from the wizard's
// Scope Review section by user handoff — the matrix is fundamentally
// per provider × group × payer × state, so it lives on the provider record).
// Everything here stays ADVISORY (the E1.8 contract): red items carry
// fix-here links and nothing is ever disabled or gated; no tasks are
// auto-created; no readiness state is stored — the matrix re-derives from
// the source caches on every read. The generation entry is case-centric
// ("Generate cases", the canonical noun — the nav says Cases) and lands on
// the provider-scoped /generation grid (E6.3 TS-127).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, X } from "lucide-react";
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
import { useEnrollmentReadiness } from "@/hooks/useEnrollmentReadiness";
import {
  filterReadinessRows,
  type ReadinessCheck,
  type ReadinessCheckKey,
  type ReadinessFilters,
  type ReadinessRow,
} from "@/lib/enrollmentReadiness";

// The gap-type filter offers every check in checklist order.
const GAP_OPTIONS: Array<{ key: ReadinessCheckKey; label: string }> = [
  { key: "license_present", label: "License missing" },
  { key: "license_current", label: "License expired" },
  { key: "license_verified", label: "License not verified" },
  { key: "caqh_id", label: "CAQH ID missing" },
  { key: "caqh_current", label: "CAQH stale" },
  { key: "npi", label: "NPI missing" },
  { key: "demographics", label: "Demographics incomplete" },
  { key: "state_facility", label: "No facility in state" },
  { key: "w9", label: "W-9 missing" },
  { key: "group_coi", label: "Group COI missing/expired" },
  { key: "voided_check", label: "Voided check missing" },
];

const ALL_FILTERS: ReadinessFilters = { groupId: "all", payerId: "all", state: "all", gap: "all" };

// Fix-here targets on the RECORD: provider-owned gaps anchor the record's own
// sections (the same #hash focus mechanism the roster gap pills use), and
// group-owned document gaps link the Groups shell (the E1.8 Option 3 rule).
function fixAnchor(check: ReadinessCheck): { href: string; label: string } {
  if (check.fixTarget === "group_screen") return { href: "/groups", label: "Fix on Groups" };
  if (check.fixTarget === "facilities_section")
    return { href: "#groups-facilities", label: "Fix in Groups & facilities" };
  if (check.key.startsWith("license")) return { href: "#licenses", label: "Fix in Licenses" };
  return { href: "#identity", label: "Fix in Identity" };
}

function FixHereLink({ check }: { check: ReadinessCheck }) {
  const target = fixAnchor(check);
  if (target.href.startsWith("/")) {
    return (
      <Link to={target.href} className="text-[12px] underline underline-offset-2">
        {target.label}
      </Link>
    );
  }
  return (
    <a href={target.href} className="text-[12px] underline underline-offset-2">
      {target.label}
    </a>
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
            {/* E4.5 TE-6 — the advisory document dimension: a passing check
                whose backing document expires soon. Amber, never a gap. */}
            {c.pass && c.advisory ? (
              <span className="text-[var(--mp-warn-ink)]">— {c.advisory}</span>
            ) : null}
            {!c.pass ? <FixHereLink check={c} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProviderReadinessSection({ providerId }: { providerId: string }) {
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

  // The record's slice of the org matrix: this provider's rows only.
  const myRows = readiness.rows.filter((r) => r.providerId === providerId);

  if (myRows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-muted-foreground">
          Readiness rows derive from active payer network targets and the provider&apos;s group
          memberships — attach payers on the group&apos;s Payer Network board to see pre-flight
          checks here.
        </p>
        <Button asChild variant="outline">
          <Link to="/groups">Open Groups</Link>
        </Button>
      </div>
    );
  }

  const groupName = (id: string) =>
    readiness.groups.find((g) => g.id === id)?.name ?? "Unknown group";
  const payerName = (id: string) =>
    readiness.payers.find((p) => p.id === id)?.name ?? "Unknown payer";
  const states = Array.from(new Set(myRows.map((r) => r.state))).sort();
  const payerIds = Array.from(new Set(myRows.map((r) => r.payerId)));

  const visible = filterReadinessRows(myRows, filters);
  const ready = myRows.filter((r) => r.ready).length;
  const rowKey = (r: ReadinessRow) => `${r.groupId}|${r.payerId}|${r.state}`;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-muted-foreground">
          The pre-flight check before enrollment starts: one row per group, payer, and state from
          the active payer targets. Readiness is advisory — nothing here blocks creating cases.
        </p>
        <Button asChild className="shrink-0 bg-[#1B4D3E] hover:bg-[#163F33]">
          <Link to="/generation" search={{ provider: providerId }}>
            Generate cases
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        <span className="ml-auto text-[12px] text-muted-foreground">
          {ready} of {myRows.length} ready
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No rows match the current filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
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
                      aria-label={`Readiness for ${payerName(r.payerId)} ${r.state}`}
                    >
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
                      <TableCell colSpan={4} className="bg-[var(--mp-neutral-tint)]/40">
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
