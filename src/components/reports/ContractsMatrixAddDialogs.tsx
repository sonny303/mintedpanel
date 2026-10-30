// "+ Add payer" (GCM-6) and "+ Add state" (GCM-33) for the Group Contracts
// Matrix. Both are session-local: they add an empty row or column to the view,
// and the row or column stays once a contract record is saved in it.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
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
import { EmptyState } from "@/components/EmptyState";
import { StateSelect } from "@/components/StateSelect";

export function AddPayerDialog({
  payers,
  onAdd,
  onClose,
}: {
  payers: readonly { id: string; name: string }[];
  onAdd: (payerId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return q ? payers.filter((payer) => payer.name.toLocaleLowerCase().includes(q)) : payers;
  }, [payers, search]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add payer</DialogTitle>
          <DialogDescription>
            Adds an empty row to every table where the payer serves a shown state. The row stays
            once you save a contract in it.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--mp-ink-faint)]"
          />
          <Input
            autoFocus
            type="search"
            aria-label="Search the payer catalog"
            placeholder="Search payer…"
            className="h-9 pl-8 text-[13px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border border-[var(--mp-border)]">
          {shown.length === 0 ? (
            <div className="p-6">
              <EmptyState
                message={
                  payers.length === 0
                    ? "Every catalog payer serving these states is already in the tables."
                    : "No catalog payer matches this search."
                }
              />
            </div>
          ) : (
            <ul aria-label="Catalog payers">
              {shown.map((payer) => (
                <li
                  key={payer.id}
                  className="border-b border-[var(--mp-border-subtle)] last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(payer.id);
                      onClose();
                    }}
                    className="w-full px-3 py-2 text-left text-[13px] text-[var(--mp-ink)] hover:bg-[var(--mp-muted)] focus-visible:bg-[var(--mp-muted)] focus-visible:outline-none"
                  >
                    {payer.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddStateDialog({
  specialtyLabel,
  groups,
  onAdd,
  onClose,
}: {
  specialtyLabel: string;
  groups: readonly { id: string; name: string }[];
  onAdd: (groupId: string, state: string) => void;
  onClose: () => void;
}) {
  const [groupId, setGroupId] = useState(groups.length === 1 ? groups[0].id : "");
  const [state, setState] = useState("");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a {specialtyLabel} state</DialogTitle>
          <DialogDescription>
            Adds a {specialtyLabel} column for a group and state before any {specialtyLabel}{" "}
            provider works there, so contracting can start early. The column stays once you save a
            contract in it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium">Group</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger aria-label="Group" className="h-9">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contracts-matrix-add-state" className="text-[12px] font-medium">
              State
            </Label>
            <StateSelect
              id="contracts-matrix-add-state"
              value={state}
              onChange={setState}
              allowNone={false}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!groupId || !state}
            onClick={() => {
              onAdd(groupId, state);
              onClose();
            }}
            className="bg-[var(--mp-primary)] text-white hover:bg-[var(--mp-primary-hover)]"
          >
            Add column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
