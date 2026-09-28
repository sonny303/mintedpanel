import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreatePortal, usePortals, useUpdatePortalPayer } from "@/hooks/usePortals";
import { useUpsertGlobalPortal } from "@/hooks/useGlobalAuthoring";
import { slugifyPortalKey } from "@/lib/portalKey";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { portalDisplayName } from "@/lib/portalRetirement";
import type { Payer, Portal } from "@/types";

export interface AddPayerPortalDialogProps {
  payer: Payer;
  onClose: () => void;
  onSuccess?: (portal: Portal) => void;
}

export function AddPayerPortalDialog({ payer, onClose, onSuccess }: AddPayerPortalDialogProps) {
  const [tab, setTab] = useState<"new" | "attach">("new");

  // "Register new" form state
  const [name, setName] = useState("");
  const [portalKey, setPortalKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [formUrl, setFormUrl] = useState("");
  const [tier, setTier] = useState<"org" | "global">("org");
  const [error, setError] = useState<string | null>(null);

  // "Attach existing" form state
  const [selectedPortalId, setSelectedPortalId] = useState<string>("");

  const portalsQ = usePortals();
  const createOrgMut = useCreatePortal();
  const upsertGlobalMut = useUpsertGlobalPortal();
  const updatePayerMut = useUpdatePortalPayer();

  const busy = createOrgMut.isPending || upsertGlobalMut.isPending || updatePayerMut.isPending;

  // Portals available to attach (not already attached to this payer)
  const attachablePortals = useMemo(() => {
    const all = portalsQ.data ?? [];
    return all.filter((p) => p.payerId !== payer.id);
  }, [portalsQ.data, payer.id]);

  function handleNameChange(val: string) {
    setName(val);
    setError(null);
    if (!keyEdited) {
      setPortalKey(slugifyPortalKey(val));
    }
  }

  async function handleRegisterNew() {
    setError(null);
    if (!name.trim()) {
      setError("Portal name is required.");
      return;
    }
    const normalizedKey = normalizePortalKey(portalKey) || slugifyPortalKey(name);
    if (!normalizedKey) {
      setError("A valid portal key is required.");
      return;
    }

    try {
      let created: Portal;
      if (tier === "global") {
        created = await upsertGlobalMut.mutateAsync({
          name: name.trim(),
          portalKey: normalizedKey,
          payerId: payer.id,
          formUrl: formUrl.trim() || null,
        });
      } else {
        created = await createOrgMut.mutateAsync({
          name: name.trim(),
          portalKey: normalizedKey,
          payerId: payer.id,
          formUrl: formUrl.trim() || null,
        });
      }
      toast.success(`Portal ${created.name} added to ${payer.name}`);
      onSuccess?.(created);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not add portal";
      setError(/duplicate|unique/i.test(msg) ? "A portal with this key already exists." : msg);
    }
  }

  async function handleAttachExisting() {
    setError(null);
    if (!selectedPortalId) {
      setError("Please select a portal to attach.");
      return;
    }
    const target = attachablePortals.find((p) => p.id === selectedPortalId);
    if (!target) {
      setError("Selected portal could not be found.");
      return;
    }

    try {
      const updated = await updatePayerMut.mutateAsync({
        portal: target,
        payerId: payer.id,
      });
      toast.success(`Attached portal ${portalDisplayName(updated)} to ${payer.name}`);
      onSuccess?.(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach portal.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">
            Add portal for {payer.name}
          </DialogTitle>
          <p className="text-[12px] text-muted-foreground">
            Attach a portal directly to this payer for ad hoc fills without requiring a template.
          </p>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "new" | "attach")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="new">Register new portal</TabsTrigger>
            <TabsTrigger value="attach">Attach existing</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-3 pt-3">
            <div>
              <Label className="text-xs">Portal name</Label>
              <Input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Aetna Provider Portal"
                className="mt-1 h-9"
              />
            </div>

            <div>
              <Label className="text-xs">Portal key</Label>
              <Input
                value={portalKey}
                onChange={(e) => {
                  setPortalKey(e.target.value);
                  setKeyEdited(true);
                  setError(null);
                }}
                placeholder="e.g. aetna_provider_portal"
                className="mt-1 h-9 font-mono text-[12px]"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Permanent identifier used by the extension to match forms.
              </p>
            </div>

            <div>
              <Label className="text-xs">Form URL</Label>
              <Input
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 h-9 font-mono text-[12px]"
              />
            </div>

            <div>
              <Label className="text-xs">Tier</Label>
              <div className="mt-1 flex items-center gap-4 text-[13px]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="portal-tier"
                    value="org"
                    checked={tier === "org"}
                    onChange={() => setTier("org")}
                    className="accent-[#1B4D3E]"
                  />
                  <span>Org-only</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="portal-tier"
                    value="global"
                    checked={tier === "global"}
                    onChange={() => setTier("global")}
                    className="accent-[#1B4D3E]"
                  />
                  <span>Global (all orgs)</span>
                </label>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="attach" className="space-y-3 pt-3">
            <div>
              <Label className="text-xs">Select portal from registry</Label>
              {attachablePortals.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  No other portals available in registry to attach.
                </p>
              ) : (
                <Select value={selectedPortalId} onValueChange={setSelectedPortalId}>
                  <SelectTrigger className="mt-1 h-9 text-[12.5px]">
                    <SelectValue placeholder="Choose a portal…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {attachablePortals.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {portalDisplayName(p)} ({p.portalKey})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Attaching an existing portal links its fields and verification status to this payer.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {error ? (
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]">
            {error}
          </div>
        ) : null}

        <DialogFooter className="mt-2 flex items-center justify-end gap-2 border-t border-[#E8E5E0] pt-3">
          <Button variant="outline" size="sm" className="h-8" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {tab === "new" ? (
            <Button
              size="sm"
              className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              onClick={() => void handleRegisterNew()}
              disabled={busy}
            >
              {busy ? "Adding…" : "Add portal"}
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              onClick={() => void handleAttachExisting()}
              disabled={busy || !selectedPortalId}
            >
              {busy ? "Attaching…" : "Attach portal"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
