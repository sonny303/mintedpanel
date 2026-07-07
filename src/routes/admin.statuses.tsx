// Admin → Statuses. Three tracks (credentialing, contracting, location) that
// are READ-MOSTLY: the canonical status set is code-owned (src/lib/
// canonicalStatuses.ts) and seeded per org by the create_organization RPC.
// Admins can drag-to-reorder and recolor (+ edit a status's required fields);
// adding, deleting, or renaming a status is not offered in the UI. Admin-write;
// specialist read. The location track drives the Launches pipeline.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStatusConfigs, useUpdateStatusConfig } from "@/hooks/useAdmin";
import { updateStatusConfig } from "@/services/statusConfigs";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { useCases } from "@/hooks/useCases";
import { useContracts } from "@/hooks/useContracts";
import { useLaunchLocations } from "@/hooks/useLaunches";
import { useIsAdmin } from "@/lib/permissions";
import type { StatusConfig, StatusTrack } from "@/types";

export const Route = createFileRoute("/admin/statuses")({
  component: AdminStatusesPage,
});

interface RequiredFieldDef {
  key: string;
  type: "text" | "date" | "select";
  label: string;
  options?: string[];
}

const TOKEN_COLORS: { value: string; name: string }[] = [
  { value: "#6B7280", name: "Gray" },
  { value: "#2563EB", name: "Blue" },
  { value: "#D97706", name: "Amber" },
  { value: "#DC2626", name: "Red" },
  { value: "#0F766E", name: "Teal" },
  { value: "#059669", name: "Green" },
];

function normalizeRequiredField(raw: unknown): RequiredFieldDef {
  if (typeof raw === "string") {
    return { key: raw, type: "text", label: raw };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const type = o.type === "date" || o.type === "select" ? (o.type as "date" | "select") : "text";
    const key = typeof o.key === "string" ? o.key : "";
    return {
      key,
      type,
      label: typeof o.label === "string" ? o.label : key,
      options:
        type === "select" && Array.isArray(o.options)
          ? o.options.filter((x): x is string => typeof x === "string")
          : undefined,
    };
  }
  return { key: "", type: "text", label: "" };
}

function AdminStatusesPage() {
  const canEdit = useIsAdmin();

  const credQ = useStatusConfigs("credentialing");
  const conQ = useStatusConfigs("contracting");
  const locQ = useStatusConfigs("location");
  const casesQ = useCases();
  const contractsQ = useContracts();
  const locationsQ = useLaunchLocations();

  const credInUse = useMemo(() => {
    const m = new Map<string, number>();
    (casesQ.data ?? []).forEach((c) => {
      if (!c.credentialingStatusId) return;
      m.set(c.credentialingStatusId, (m.get(c.credentialingStatusId) ?? 0) + 1);
    });
    return m;
  }, [casesQ.data]);

  const conInUse = useMemo(() => {
    const m = new Map<string, number>();
    (contractsQ.data ?? []).forEach((c) => {
      if (!c.contractingStatusId) return;
      m.set(c.contractingStatusId, (m.get(c.contractingStatusId) ?? 0) + 1);
    });
    return m;
  }, [contractsQ.data]);

  const locInUse = useMemo(() => {
    const m = new Map<string, number>();
    (locationsQ.data ?? []).forEach((f) => {
      if (!f.statusId) return;
      m.set(f.statusId, (m.get(f.statusId) ?? 0) + 1);
    });
    return m;
  }, [locationsQ.data]);

  const [editing, setEditing] = useState<{
    track: StatusTrack;
    status: StatusConfig;
  } | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statuses"
        description="Reorder and recolor the credentialing, contracting, and location stages."
      />

      <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-muted-foreground">
        The canonical status set is code-owned (<code>src/lib/canonicalStatuses.ts</code>) and
        seeded for every organization. You can reorder and recolor statuses here; adding, removing,
        or renaming a status is managed in code.
      </div>

      {!canEdit && (
        <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-muted-foreground">
          Read-only view. Only admins can reorder or recolor statuses.
        </div>
      )}

      <TrackSection
        title="Credentialing track"
        description="Applies to cases (provider + payer + state)."
        track="credentialing"
        statuses={credQ.data ?? []}
        loading={credQ.isLoading}
        isError={credQ.isError}
        onRetry={() => credQ.refetch()}
        inUse={credInUse}
        canEdit={canEdit}
        onEdit={(s) => setEditing({ track: "credentialing", status: s })}
      />

      <TrackSection
        title="Contracting track"
        description="Applies to contracts (group + payer + state)."
        track="contracting"
        statuses={conQ.data ?? []}
        loading={conQ.isLoading}
        isError={conQ.isError}
        onRetry={() => conQ.refetch()}
        inUse={conInUse}
        canEdit={canEdit}
        onEdit={(s) => setEditing({ track: "contracting", status: s })}
      />

      <TrackSection
        title="Location track"
        description="Applies to locations — drives the Launches pipeline."
        track="location"
        statuses={locQ.data ?? []}
        loading={locQ.isLoading}
        isError={locQ.isError}
        onRetry={() => locQ.refetch()}
        inUse={locInUse}
        canEdit={canEdit}
        onEdit={(s) => setEditing({ track: "location", status: s })}
      />

      <StatusEditModal
        open={editing !== null}
        track={editing?.track ?? "credentialing"}
        status={editing?.status ?? null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

interface TrackSectionProps {
  title: string;
  description: string;
  track: StatusTrack;
  statuses: StatusConfig[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  inUse: Map<string, number>;
  canEdit: boolean;
  onEdit: (s: StatusConfig) => void;
}

function TrackSection({
  title,
  description,
  track,
  statuses,
  loading,
  isError,
  onRetry,
  inUse,
  canEdit,
  onEdit,
}: TrackSectionProps) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  const [dragId, setDragId] = useState<string | null>(null);

  const sorted = useMemo(() => [...statuses].sort((a, b) => a.sortOrder - b.sortOrder), [statuses]);

  async function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = sorted.map((s) => s.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);

    const updates: { id: string; sortOrder: number }[] = [];
    ids.forEach((id, i) => {
      const cur = sorted.find((s) => s.id === id);
      const next = (i + 1) * 10;
      if (cur && cur.sortOrder !== next) updates.push({ id, sortOrder: next });
    });

    try {
      await Promise.all(updates.map((u) => updateStatusConfig(u.id, { sortOrder: u.sortOrder })));
      qc.invalidateQueries({ queryKey: ["status-configs", orgId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reorder failed.");
    }
  }

  return (
    <ReorderableSection
      title={title}
      description={description}
      track={track}
      statuses={sorted}
      loading={loading}
      isError={isError}
      onRetry={onRetry}
      inUse={inUse}
      canEdit={canEdit}
      onEdit={onEdit}
      dragId={dragId}
      setDragId={setDragId}
      reorder={reorder}
    />
  );
}

interface ReorderableSectionProps extends TrackSectionProps {
  dragId: string | null;
  setDragId: (v: string | null) => void;
  reorder: (fromId: string, toId: string) => Promise<void>;
}

function ReorderableSection({
  title,
  description,
  statuses,
  loading,
  isError,
  onRetry,
  inUse,
  canEdit,
  onEdit,
  dragId,
  setDragId,
  reorder,
}: ReorderableSectionProps) {
  return (
    <div className="border border-[#E8E5E0] rounded-md bg-white">
      <div className="flex items-start justify-between p-4 border-b border-[#E8E5E0]">
        <div>
          <h2 className="text-[14px] font-medium">{title}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <table className="w-full">
            <tbody>
              <TableSkeletonRows rows={6} cols={5} />
            </tbody>
          </table>
        ) : isError ? (
          <div className="p-8 text-center">
            <EmptyState
              message="Failed to load statuses"
              action={
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : statuses.length === 0 ? (
          <div className="p-8 text-center">
            <EmptyState message="No statuses yet" />
          </div>
        ) : (
          statuses.map((s) => {
            const used = inUse.get(s.id) ?? 0;
            const fields = (s.requiredFields as unknown as unknown[]).map(normalizeRequiredField);
            const summary =
              fields.length === 0
                ? "No required fields"
                : fields.map((f) => f.label || f.key).join(", ");
            return (
              <div
                key={s.id}
                draggable={canEdit}
                onDragStart={() => setDragId(s.id)}
                onDragOver={(e) => {
                  if (canEdit) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (canEdit && dragId) {
                    void reorder(dragId, s.id);
                    setDragId(null);
                  }
                }}
                className={`flex min-w-max items-center gap-3 px-4 h-12 border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9] ${
                  dragId === s.id ? "opacity-50" : ""
                }`}
              >
                {canEdit && <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />}
                <span
                  className="inline-block w-3 h-3 rounded-full border border-[#E8E5E0]"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-[13px] font-medium min-w-[180px]">{s.label}</span>
                <span className="text-[12px] text-muted-foreground flex-1 truncate">{summary}</span>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {used > 0 ? `In use by ${used} case${used === 1 ? "" : "s"}` : "—"}
                </span>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] px-2"
                    onClick={() => onEdit(s)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface StatusEditModalProps {
  open: boolean;
  track: StatusTrack;
  status: StatusConfig | null;
  onClose: () => void;
}

// Edit-only: recolor + required-fields. The label is code-owned (canonical set)
// and shown read-only; there is no create path (new-org seeding uses the RPC).
function StatusEditModal({ open, track, status, onClose }: StatusEditModalProps) {
  const updateM = useUpdateStatusConfig(status?.id ?? "");

  const [color, setColor] = useState(TOKEN_COLORS[0].value);
  const [fields, setFields] = useState<RequiredFieldDef[]>([]);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  const hydrateKey = status?.id ?? null;
  if (open && status && hydrateKey !== hydratedFor) {
    setColor(status.color ?? TOKEN_COLORS[0].value);
    setFields((status.requiredFields as unknown as unknown[]).map(normalizeRequiredField));
    setHydratedFor(hydrateKey);
  }
  if (!open && hydratedFor !== null) {
    setHydratedFor(null);
  }

  function handleClose(next: boolean) {
    if (!next) onClose();
  }

  function addField() {
    setFields((f) => [...f, { key: "", type: "text", label: "" }]);
  }
  function updateField(i: number, patch: Partial<RequiredFieldDef>) {
    setFields((f) => f.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  }
  function removeField(i: number) {
    setFields((f) => f.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (!TOKEN_COLORS.some((c) => c.value === color)) {
      toast.error("Pick a color from the palette.");
      return;
    }
    for (const f of fields) {
      if (!f.key.trim() || !f.label.trim()) {
        toast.error("Each required field needs a key and label.");
        return;
      }
      if (f.type === "select" && (f.options ?? []).length === 0) {
        toast.error("Select fields need at least one option.");
        return;
      }
    }
    const cleanFields = fields.map((f) => ({
      key: f.key.trim(),
      type: f.type,
      label: f.label.trim(),
      ...(f.type === "select"
        ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) }
        : {}),
    }));

    try {
      await updateM.mutateAsync({
        color,
        requiredFields: cleanFields as unknown as string[],
      });
      toast.success("Status updated.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit status</DialogTitle>
          <DialogDescription>
            {track === "credentialing"
              ? "Credentialing"
              : track === "contracting"
                ? "Contracting"
                : "Location"}{" "}
            track. Labels are code-owned — edit the color and required fields here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <div className="flex h-9 items-center rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-3 text-[13px] text-muted-foreground">
              {status?.label ?? ""}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {TOKEN_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-8 h-8 rounded-full border-2 ${
                    color === c.value ? "border-[#1B4D3E]" : "border-[#E8E5E0]"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Required fields</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px] px-2"
                onClick={addField}
              >
                <Plus className="w-3 h-3 mr-1" /> Add field
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No fields required when transitioning into this status.
              </p>
            ) : (
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div key={i} className="border border-[#E8E5E0] rounded-md p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Field key
                        </Label>
                        <Input
                          className="h-8 text-[13px]"
                          value={f.key}
                          onChange={(e) => updateField(i, { key: e.target.value })}
                          placeholder="effectiveDate"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Type
                        </Label>
                        <Select
                          value={f.type}
                          onValueChange={(v) =>
                            updateField(i, {
                              type: v as RequiredFieldDef["type"],
                              options: v === "select" ? (f.options ?? [""]) : undefined,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="select">Select</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Label
                      </Label>
                      <Input
                        className="h-8 text-[13px]"
                        value={f.label}
                        onChange={(e) => updateField(i, { label: e.target.value })}
                        placeholder="Effective date"
                      />
                    </div>
                    {f.type === "select" && (
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Options (comma-separated)
                        </Label>
                        <Input
                          className="h-8 text-[13px]"
                          value={(f.options ?? []).join(", ")}
                          onChange={(e) =>
                            updateField(i, {
                              options: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Approved, Pending, Denied"
                        />
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px] text-muted-foreground"
                        onClick={() => removeField(i)}
                      >
                        Remove field
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={updateM.isPending}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
