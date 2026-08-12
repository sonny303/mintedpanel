// The template match-key states multi-select. A template applies to a SET of
// states (migration 20260812140000), so the old single Select is gone.
//
// Composed from the approved Popover + Input + Checkbox primitives over the
// canonical US_STATES list, mirroring `payer-admin/PayerStatesField` — which is
// the same control for `payers.states`, but cannot be imported here: the
// payer-admin module boundary (moduleBoundary.test.ts Rule A) forbids non-admin
// code importing that module. Logged in DESIGN-DEBT.md alongside its twin.
//
// "All states" is a SENTINEL row, mutually exclusive with specific codes —
// picking one clears the other. That is a storage CHECK too, but doing it here
// means the author never meets a rejected save.
import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ALL_STATES_SENTINEL, formatSopStateLabel, isAllStates } from "@/lib/sopMatchKey";
import { US_STATES } from "@/lib/usStates";
import { cn } from "@/lib/utils";

interface TemplateStatesFieldProps {
  states: string[];
  onToggle: (code: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function TemplateStatesField({
  states,
  onToggle,
  onClear,
  disabled,
}: TemplateStatesFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return US_STATES;
    return US_STATES.filter((s) => s.includes(q));
  }, [query]);

  const all = isAllStates(states);
  const label = states.length === 0 ? "Select states" : formatSopStateLabel(states);

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-labelledby="tpl-states-label"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              states.length === 0 && "text-muted-foreground",
            )}
          >
            <span className="truncate">{label}</span>
            <ChevronDown className="ml-2 h-4 w-4 flex-none opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="border-b border-[#E8E5E0] p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search states"
              aria-label="Search states"
              className="h-8"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => onToggle(ALL_STATES_SENTINEL)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[#F4F2EF]"
            >
              <span className="flex h-4 w-4 flex-none items-center justify-center">
                {all ? <Check className="h-3.5 w-3.5 text-[#1B4D3E]" /> : null}
              </span>
              <span className="font-medium">All states</span>
            </button>
            <div className="my-1 border-t border-[#F0EEEA]" />
            {matches.map((s) => {
              const checked = states.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onToggle(s)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[#F4F2EF]"
                >
                  <span className="flex h-4 w-4 flex-none items-center justify-center">
                    {checked ? <Check className="h-3.5 w-3.5 text-[#1B4D3E]" /> : null}
                  </span>
                  <span className={cn(all && "text-muted-foreground")}>{s}</span>
                </button>
              );
            })}
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-[12.5px] text-muted-foreground">No matching state.</p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      {states.length > 0 && !disabled ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Clear states
        </button>
      ) : null}
      {all ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Resolves only where no state-specific template exists.
        </p>
      ) : null}
    </div>
  );
}
