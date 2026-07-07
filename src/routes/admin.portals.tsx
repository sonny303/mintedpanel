// Admin → Portals (Surface 3). The registry of payer portals the extension can
// fill: URL, mapped-field coverage, verification, last fill result. Editing is
// deliberately narrow — URL edits here, field decisions in training — so every
// change stays audited and dictionary-fed.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePayers } from "@/hooks/useAdmin";
import {
  usePortals,
  usePortalFieldMaps,
  useLastFills,
  useCreatePortal,
  useUpdatePortalUrl,
} from "@/hooks/usePortals";
import { useIsAdmin } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { slugifyPortalKey } from "@/lib/portalKey";
import type { FillSession, Payer, Portal, PortalFieldMap } from "@/types";
import type { PortalInput } from "@/services/portals";

export const Route = createFileRoute("/admin/portals")({
  component: AdminPortalsPage,
});

interface PortalRow {
  portal: Portal;
  payerName: string;
  mapped: number;
  proposed: number;
  lastFill: FillSession | null;
}

function StatusCell({ portal }: { portal: Portal }) {
  if (portal.isVerified) return <StatusPill status="green" label="Verified" />;
  if (portal.urlChangedAt && portal.lastVerifiedAt)
    return <StatusPill status="amber" label="Needs re-verify" />;
  return <StatusPill status="neutral" label="Unverified" />;
}

function LastFillCell({ fill, mapped }: { fill: FillSession | null; mapped: number }) {
  if (!fill) return <span className="text-[#78716C]">No fills yet</span>;
  const when = fmtDate(fill.completedAt ?? fill.startedAt);
  if (fill.fieldsFilled > 0) {
    return (
      <span className="whitespace-nowrap">
        <span className="text-[#059669] font-medium tabular-nums">
          {fill.fieldsFilled} of {mapped}
        </span>
        <span className="text-[#99A49B]"> · {when}</span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <span className="text-[#DC2626] font-medium">Failed</span>
      <span className="text-[#99A49B]"> · {when}</span>
    </span>
  );
}

function displayUrl(url: string | null): string {
  if (!url) return "—";
  return url.replace(/^https?:\/\//, "");
}

function AdminPortalsPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const portalsQ = usePortals();
  const mapsQ = usePortalFieldMaps();
  const lastFillsQ = useLastFills();
  const payersQ = usePayers();

  const [adding, setAdding] = useState(false);
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null);
  const [viewFieldsKey, setViewFieldsKey] = useState<string | null>(null);

  const rows: PortalRow[] = useMemo(() => {
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p.name]));
    const maps = mapsQ.data ?? [];
    const mappedByKey = new Map<string, number>();
    const proposedByKey = new Map<string, number>();
    for (const m of maps) {
      if (m.status === "approved")
        mappedByKey.set(m.portalKey, (mappedByKey.get(m.portalKey) ?? 0) + 1);
      else if (m.status === "proposed")
        proposedByKey.set(m.portalKey, (proposedByKey.get(m.portalKey) ?? 0) + 1);
    }
    const lastFills = lastFillsQ.data;
    return (portalsQ.data ?? []).map((portal) => ({
      portal,
      payerName: portal.payerId ? (payerById.get(portal.payerId) ?? "—") : "Multi-payer",
      mapped: mappedByKey.get(portal.portalKey) ?? 0,
      proposed: proposedByKey.get(portal.portalKey) ?? 0,
      lastFill: lastFills?.get(portal.portalKey) ?? null,
    }));
  }, [portalsQ.data, mapsQ.data, lastFillsQ.data, payersQ.data]);

  const fieldsForViewed = useMemo(
    () => (viewFieldsKey ? (mapsQ.data ?? []).filter((m) => m.portalKey === viewFieldsKey) : []),
    [viewFieldsKey, mapsQ.data],
  );
  const viewedPortal = rows.find((r) => r.portal.portalKey === viewFieldsKey)?.portal ?? null;

  function goTrain(portalKey: string) {
    navigate({ to: "/portals/$portalKey/train", params: { portalKey } });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portals"
        description="Payer portals the extension can fill — URLs, field maps, and verification."
        actions={
          isAdmin ? (
            <Button
              onClick={() => setAdding(true)}
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
            >
              <Plus className="w-4 h-4 mr-1" /> Add portal
            </Button>
          ) : null
        }
      />

      <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-foreground">
        Field selectors are captured by the extension and approved in training. This screen manages
        where they point and whether they're trusted.
      </div>

      <div className="border border-[#E8E5E0] rounded-md overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
                {[
                  "Portal",
                  "Payer",
                  "Form URL",
                  "Fields",
                  "Status",
                  "Verified on",
                  "Last fill",
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {portalsQ.isLoading ? (
                <TableSkeletonRows rows={6} cols={8} />
              ) : portalsQ.isError ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12">
                    <EmptyState
                      message="Couldn't load portals. Your connection may have dropped — retry, or refresh the page."
                      action={
                        <Button variant="outline" size="sm" onClick={() => portalsQ.refetch()}>
                          Retry
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12">
                    <EmptyState
                      message="No portals yet"
                      description="Portals appear here automatically the first time the extension captures a payer form. You can also add one by hand to stage a URL before capture."
                      action={
                        isAdmin ? (
                          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                            <Plus className="w-4 h-4 mr-1" /> Add portal
                          </Button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <PortalTableRow
                    key={row.portal.id}
                    row={row}
                    isAdmin={isAdmin}
                    editingUrl={editingUrlId === row.portal.id}
                    onEditUrl={() => setEditingUrlId(row.portal.id)}
                    onCancelEditUrl={() => setEditingUrlId(null)}
                    onViewFields={() => setViewFieldsKey(row.portal.portalKey)}
                    onTrain={() => goTrain(row.portal.portalKey)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding ? <AddPortalModal onClose={() => setAdding(false)} /> : null}
      {viewFieldsKey && viewedPortal ? (
        <ViewFieldsDialog
          portal={viewedPortal}
          fields={fieldsForViewed}
          onClose={() => setViewFieldsKey(null)}
          onTrain={() => {
            const key = viewFieldsKey;
            setViewFieldsKey(null);
            goTrain(key);
          }}
        />
      ) : null}
    </div>
  );
}

function PortalTableRow({
  row,
  isAdmin,
  editingUrl,
  onEditUrl,
  onCancelEditUrl,
  onViewFields,
  onTrain,
}: {
  row: PortalRow;
  isAdmin: boolean;
  editingUrl: boolean;
  onEditUrl: () => void;
  onCancelEditUrl: () => void;
  onViewFields: () => void;
  onTrain: () => void;
}) {
  const { portal, payerName, mapped, proposed, lastFill } = row;
  return (
    <>
      <tr className="border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]">
        <td className="px-3 h-11 align-middle">
          <div className="font-medium leading-tight">{portal.name}</div>
          <code className="text-[11px] text-[#99A49B]">{portal.portalKey}</code>
        </td>
        <td className="px-3 h-11 align-middle text-muted-foreground">{payerName}</td>
        <td className="px-3 h-11 align-middle">
          <span
            className="block max-w-[220px] truncate font-mono text-[12px] text-muted-foreground"
            title={portal.formUrl ?? undefined}
          >
            {displayUrl(portal.formUrl)}
          </span>
        </td>
        <td className="px-3 h-11 align-middle whitespace-nowrap tabular-nums">
          {mapped} mapped
          {proposed > 0 ? (
            <StatusPill status="amber" label={`${proposed} proposed`} className="ml-1.5" />
          ) : null}
        </td>
        <td className="px-3 h-11 align-middle">
          <StatusCell portal={portal} />
        </td>
        <td className="px-3 h-11 align-middle text-muted-foreground whitespace-nowrap">
          {fmtDate(portal.lastVerifiedAt)}
        </td>
        <td className="px-3 h-11 align-middle">
          <LastFillCell fill={lastFill} mapped={mapped} />
        </td>
        <td className="px-3 h-11 align-middle text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1.5">
            {proposed > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] px-2 border-[#C8DBD4] text-[#1B4D3E]"
                onClick={onTrain}
              >
                Train
              </Button>
            ) : null}
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-[#99A49B]"
                    aria-label={`Actions for ${portal.name}`}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => onEditUrl()}>Edit URL</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onViewFields()}>View fields</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onTrain()}>Train this form</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </td>
      </tr>
      {editingUrl ? (
        <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
          <td colSpan={8} className="px-4 py-4">
            <EditUrlEditor portal={portal} mapped={mapped} onDone={onCancelEditUrl} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function EditUrlEditor({
  portal,
  mapped,
  onDone,
}: {
  portal: Portal;
  mapped: number;
  onDone: () => void;
}) {
  const [url, setUrl] = useState(portal.formUrl ?? "");
  const updateMut = useUpdatePortalUrl();

  async function save() {
    try {
      await updateMut.mutateAsync({ id: portal.id, formUrl: url });
      toast.success("Portal URL updated");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the URL — retry.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Form URL"
          className="flex-1 min-w-[280px] max-w-[520px] h-8 font-mono text-[12px]"
        />
        <Button
          onClick={save}
          disabled={updateMut.isPending}
          className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-8 text-[12px] px-3"
        >
          Save URL
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <div className="border border-[#FDE68A] bg-[#FEF3C7] text-[#92400E] rounded-md px-3 py-2 text-[12.5px] leading-relaxed">
        ⚠ {mapped} field selector{mapped === 1 ? " was" : "s were"} captured on the current page. If
        the payer moved the form, they may not match the new URL — saving marks this portal{" "}
        <b>Unverified</b> until the next successful fill or training pass.
      </div>
    </div>
  );
}

function ViewFieldsDialog({
  portal,
  fields,
  onClose,
  onTrain,
}: {
  portal: Portal;
  fields: PortalFieldMap[];
  onClose: () => void;
  onTrain: () => void;
}) {
  const globalCount = fields.filter((f) => f.orgId === null).length;
  const orgCount = fields.length - globalCount;
  const grouped = useMemo(() => groupBySection(fields), [fields]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[420px] border-[#E8E5E0] shadow-none p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#EFF1EF]">
          <DialogTitle className="text-[15px]">
            {portal.name} — {fields.length} mapped field{fields.length === 1 ? "" : "s"}
          </DialogTitle>
          <p className="text-[12px] text-muted-foreground mt-1">
            Read-only. Fields are decided in training, not here.
          </p>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {fields.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                message="No fields mapped yet"
                description="Fields appear once the extension captures this form."
              />
            </div>
          ) : (
            grouped.map(([section, rows]) => (
              <div key={section}>
                <div className="px-5 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#99A49B]">
                  {section}
                </div>
                {rows.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 px-5 py-2 border-b border-[#EFF1EF] last:border-b-0"
                  >
                    <span
                      className="flex-1 text-[13px] font-medium truncate"
                      title={f.fieldLabel ?? f.selector}
                    >
                      {f.fieldLabel ?? f.selector}
                    </span>
                    {f.source === "manual" || f.source === "manual_partial" ? (
                      <span className="inline-flex items-center rounded-md border border-[#E8E5E0] bg-[#F5F5F4] px-2 py-0.5 text-[12px] text-[#78716C] font-mono">
                        manual
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md border border-[#C8DBD4] bg-[#E7F0EC] px-2 py-0.5 text-[12px] text-[#1B4D3E] font-mono">
                        {f.token ?? "—"}
                      </span>
                    )}
                    <span className="text-[11px] text-[#99A49B] w-10 text-right">
                      {f.fieldType}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#EFF1EF] px-5 py-3">
          <span className="text-[12px] text-muted-foreground">
            {globalCount} global row{globalCount === 1 ? "" : "s"} · {orgCount} org override
            {orgCount === 1 ? "" : "s"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[12px] border-[#C8DBD4] text-[#1B4D3E]"
            onClick={onTrain}
          >
            Train this form
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function groupBySection(fields: PortalFieldMap[]): [string, PortalFieldMap[]][] {
  const order: string[] = [];
  const bySection = new Map<string, PortalFieldMap[]>();
  for (const f of fields) {
    const section = f.formSection ?? f.pageStep ?? "Fields";
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)!.push(f);
  }
  return order.map((s) => [s, bySection.get(s)!]);
}

const NONE = "__none__";

function AddPortalModal({ onClose }: { onClose: () => void }) {
  const createMut = useCreatePortal();
  const payersQ = usePayers();
  const [name, setName] = useState("");
  const [portalKey, setPortalKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [payerId, setPayerId] = useState<string>(NONE);
  const [formUrl, setFormUrl] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onNameChange(v: string) {
    setName(v);
    if (nameError) setNameError(null);
    if (!keyEdited) setPortalKey(slugifyPortalKey(v));
  }

  async function save() {
    setError(null);
    setNameError(null);
    if (!name.trim()) {
      setNameError("Name is required");
      return;
    }
    const key = portalKey.trim() || slugifyPortalKey(name);
    const input: PortalInput = {
      name: name.trim(),
      portalKey: key,
      payerId: payerId === NONE ? null : payerId,
      formUrl: formUrl.trim() || null,
    };
    try {
      await createMut.mutateAsync(input);
      toast.success("Portal added");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't add the portal — retry.";
      // Unique (org_id, portal_key) violation → a friendlier message.
      setError(/duplicate|unique/i.test(msg) ? "A portal with this key already exists." : msg);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Add portal</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-[12px]">Name</Label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Availity"
              aria-invalid={nameError ? true : undefined}
              className={`h-9 ${nameError ? "border-[#B91C1C] focus-visible:ring-[#B91C1C]" : ""}`}
            />
            {nameError ? <div className="text-[12px] text-[#B91C1C] mt-1">{nameError}</div> : null}
          </div>
          <div className="col-span-2">
            <Label className="text-[12px]">Portal key</Label>
            <Input
              value={portalKey}
              onChange={(e) => {
                setKeyEdited(true);
                setPortalKey(e.target.value);
              }}
              placeholder="availity"
              className="h-9 font-mono text-[12.5px]"
            />
            <div className="text-[11px] text-muted-foreground mt-1">
              Stable identifier the extension sends. Lowercase, no spaces.
            </div>
          </div>
          <div>
            <Label className="text-[12px]">Payer</Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Multi-payer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Multi-payer</SelectItem>
                {(payersQ.data ?? []).map((p: Payer) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12px]">Form URL</Label>
            <Input
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://…"
              className="h-9 font-mono text-[12.5px]"
            />
          </div>
        </div>

        {error ? (
          <div className="border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] rounded-md px-3 py-2 text-[13px]">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={createMut.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
