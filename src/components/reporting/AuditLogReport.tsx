// E6.6 F6.6.4 — the Audit Log read surface, relocated from /admin/audit into
// the Reporting Center's Compliance group (same filters, same read-only
// posture; the append-only audit_log table is untouched). The admin gate
// moved WITH the surface: audit_log RLS is member-SELECT, but the app-level
// admin gate is preserved — non-admins get an honest empty state and the
// fetch itself stays disabled so no rows enter their cache.
import { useMemo, useState, Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { fmtDateTime } from "@/lib/format";
import { auditUserOptions } from "@/lib/auditUserOptions";
import { auditDateBounds } from "@/lib/auditDateRange";
import { auditEntityTarget } from "@/lib/auditEntityLink";
import { auditActionLabel, auditEntityLabel, auditFieldLabel } from "@/lib/auditLabels";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { useAuditLog } from "@/hooks/useAdmin";
import { useActiveOrgId } from "@/lib/auth-store";
import { useIsAdmin } from "@/lib/permissions";
import type { AuditActionType, AuditLogEntry } from "@/types";

const ACTION_TYPES: AuditActionType[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "STATUS_CHANGE",
  "TOUCH_LOGGED",
  "TERMINATION",
  "READ",
];

const PAGE_SIZE = 50;

function ActionPill({ action }: { action: AuditActionType }) {
  const tones: Record<AuditActionType, StatusColor> = {
    CREATE: "green",
    UPDATE: "blue",
    DELETE: "red",
    STATUS_CHANGE: "amber",
    TOUCH_LOGGED: "violet",
    TERMINATION: "red",
    READ: "neutral",
  };
  return (
    <span title={action}>
      <StatusPill status={tones[action]} label={auditActionLabel(action)} />
    </span>
  );
}

function EntityLink({ entry }: { entry: AuditLogEntry }) {
  const { entityType, entityId } = entry;
  const label = (
    <span className="text-muted-foreground" title={entityType}>
      <span className="font-medium text-foreground">{auditEntityLabel(entityType)}</span>
      {entityId ? <span className="ml-1 text-[12px]">#{entityId.slice(0, 8)}</span> : null}
    </span>
  );
  const target = auditEntityTarget(entry);
  if (!target) return label;
  return (
    <Link to={target.to} params={{ id: target.id }} className="hover:underline">
      {label}
    </Link>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const isObj = (x: unknown): x is Record<string, unknown> =>
    typeof x === "object" && x !== null && !Array.isArray(x);

  if (!isObj(before) && !isObj(after)) {
    return (
      <div className="grid grid-cols-2 gap-4 text-[12px] font-mono">
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[11px] mb-1">
            Before
          </div>
          <pre className="whitespace-pre-wrap break-words p-3 border border-border rounded-md bg-[#FAFAF9]">
            {formatValue(before)}
          </pre>
        </div>
        <div>
          <div className="text-muted-foreground uppercase tracking-wider text-[11px] mb-1">
            After
          </div>
          <pre className="whitespace-pre-wrap break-words p-3 border border-border rounded-md bg-[#FAFAF9]">
            {formatValue(after)}
          </pre>
        </div>
      </div>
    );
  }

  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter((k) => {
    return JSON.stringify(b[k]) !== JSON.stringify(a[k]);
  });

  if (keys.length === 0) {
    return <EmptyState message="No field-level changes recorded" />;
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="grid grid-cols-[180px_1fr_1fr] text-[11px] uppercase tracking-wider text-muted-foreground bg-[#FAFAF9] border-b border-border">
        <div className="px-3 py-2">Field</div>
        <div className="px-3 py-2 border-l border-border">Before</div>
        <div className="px-3 py-2 border-l border-border">After</div>
      </div>
      {keys.map((k) => (
        <div
          key={k}
          className="grid grid-cols-[180px_1fr_1fr] text-[12px] font-mono border-b border-border last:border-b-0"
        >
          <div className="px-3 py-2 font-sans font-medium text-foreground" title={k}>
            {auditFieldLabel(k)}
          </div>
          <div className="px-3 py-2 border-l border-border whitespace-pre-wrap break-words text-[#B91C1C]">
            {formatValue(b[k])}
          </div>
          <div className="px-3 py-2 border-l border-border whitespace-pre-wrap break-words text-[#059669]">
            {formatValue(a[k])}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuditLogReport() {
  const orgId = useActiveOrgId();
  // The admin gate moved with the surface (F6.6.4): a specialist or billing
  // user reaching this report sees an honest gate, never audit data.
  const isAdmin = useIsAdmin();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userId, setUserId] = useState<string>("all");
  const [actionType, setActionType] = useState<string>("all");
  const [entityType, setEntityType] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Both date bounds are LOCAL days, applied server-side before the row
  // limit (auditDateBounds): From's local midnight through the end of To.
  const filters = useMemo(
    () => ({
      actionType: actionType !== "all" ? (actionType as AuditActionType) : undefined,
      entityType: entityType !== "all" ? entityType : undefined,
      userId: userId !== "all" ? userId : undefined,
      ...auditDateBounds(dateFrom, dateTo),
      limit: 1000,
    }),
    [actionType, entityType, userId, dateFrom, dateTo],
  );

  // Gate the fetch itself, not just the render: a non-admin deep-linking here
  // should never pull audit_log rows into their cache before the redirect fires.
  const auditQ = useAuditLog(filters, { enabled: isAdmin });
  const rows = useMemo(() => auditQ.data ?? [], [auditQ.data]);

  const users = useMemo(() => auditUserOptions(rows), [rows]);

  const entityTypes = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.entityType))).sort((a, b) =>
      auditEntityLabel(a).localeCompare(auditEntityLabel(b)),
    );
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
    setUserId("all");
    setActionType("all");
    setEntityType("all");
    setPage(0);
  }

  if (!orgId) {
    return <EmptyState message="Select an organization to see its audit log." />;
  }
  if (!isAdmin) {
    return <EmptyState message="The Audit Log is available to organization admins." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-md bg-[#FAFAF9] text-[13px] text-foreground">
        <Lock className="h-4 w-4 text-muted-foreground" />
        Audit entries can never be edited or deleted, by anyone, including admins.
      </div>

      <div className="border border-border rounded-md p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div>
          <Label htmlFor="audit-filter-from" className="text-[12px]">
            From
          </Label>
          <Input
            id="audit-filter-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div>
          <Label htmlFor="audit-filter-to" className="text-[12px]">
            To
          </Label>
          <Input
            id="audit-filter-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div>
          <Label htmlFor="audit-filter-user" className="text-[12px]">
            User
          </Label>
          <Select
            value={userId}
            onValueChange={(v) => {
              setUserId(v);
              setPage(0);
            }}
          >
            <SelectTrigger id="audit-filter-user">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="audit-filter-action" className="text-[12px]">
            Action
          </Label>
          <Select
            value={actionType}
            onValueChange={(v) => {
              setActionType(v);
              setPage(0);
            }}
          >
            <SelectTrigger id="audit-filter-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {ACTION_TYPES.map((a) => (
                <SelectItem key={a} value={a}>
                  {auditActionLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="audit-filter-entity" className="text-[12px]">
            Entity
          </Label>
          <Select
            value={entityType}
            onValueChange={(v) => {
              setEntityType(v);
              setPage(0);
            }}
          >
            <SelectTrigger id="audit-filter-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entityTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {auditEntityLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-5 flex justify-end">
          <Button variant="outline" size="sm" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Timestamp
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                User
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Action
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Entity
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                Description
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditQ.isLoading ? (
              <TableSkeletonRows rows={6} cols={6} />
            ) : auditQ.isError ? (
              <TableRow>
                <TableCell colSpan={6} className="px-3 py-12 text-center">
                  <EmptyState
                    message="Failed to load audit entries"
                    action={
                      <Button variant="outline" size="sm" onClick={() => auditQ.refetch()}>
                        Retry
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="px-3 py-12">
                  <EmptyState message="No audit entries match the current filters" />
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r) => {
                const isOpen = expanded.has(r.id);
                const detailId = `audit-detail-${r.id}`;
                return (
                  <Fragment key={r.id}>
                    {/* The chevron button is the keyboard control; the row
                        click stays as a mouse convenience. */}
                    <TableRow className="h-10 cursor-pointer" onClick={() => toggleExpand(r.id)}>
                      <TableCell className="px-3">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={detailId}
                          aria-label="Show changes"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(r.id);
                          }}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="px-3 tabular-nums text-[13px]">
                        {fmtDateTime(r.ts)}
                      </TableCell>
                      <TableCell className="px-3 text-[13px]">
                        {r.userName ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="px-3">
                        <ActionPill action={r.actionType} />
                      </TableCell>
                      <TableCell className="px-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
                        <EntityLink entry={r} />
                      </TableCell>
                      <TableCell className="px-3 text-[13px] text-foreground">
                        {r.description ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                    {/* Always in the DOM so aria-controls resolves; the diff
                        itself renders only while open. */}
                    <TableRow
                      id={detailId}
                      hidden={!isOpen}
                      className="bg-[#FAFAF9] hover:bg-[#FAFAF9]"
                    >
                      <TableCell colSpan={6} className="p-4">
                        {isOpen ? <DiffView before={r.before} after={r.after} /> : null}
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-[13px] text-muted-foreground">
        <div>
          Showing {pageRows.length === 0 ? 0 : page * PAGE_SIZE + 1}–
          {page * PAGE_SIZE + pageRows.length} of {rows.length}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
