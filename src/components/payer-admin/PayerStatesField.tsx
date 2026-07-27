// Payer & Cases design bundle, screen 2 (Slice B) — the searchable
// operating-states multi-select. The design system defines no searchable
// multi-select, and the E1.1 `StatesMultiSelect` (a DropdownMenu of checkbox
// rows) can't host a search box: Radix DropdownMenu owns keydown for typeahead,
// so an Input inside it never receives characters. Composed instead from the
// approved Popover + Input + Checkbox primitives over the canonical US_STATES
// list (all 50 + DC), token-styled. Logged in DESIGN-DEBT.md, tagged Slice B.
import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { US_STATES } from "@/lib/usStates";
import { cn } from "@/lib/utils";

interface PayerStatesFieldProps {
  id?: string;
  value: string[];
  onChange: (code: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

export function PayerStatesField({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: PayerStatesFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q === "" ? [...US_STATES] : US_STATES.filter((code) => code.includes(q));
  }, [query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label="States this payer operates in"
          aria-describedby={describedBy}
          className={cn(
            "flex h-9 w-full max-w-[520px] items-center gap-2.5 rounded-[4px] border bg-white px-3 text-left text-[13px]",
            invalid ? "border-[#FCA5A5]" : "border-[#E8E5E0]",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              value.length ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {value.length ? value.join(", ") : "Select states…"}
          </span>
          {value.length ? (
            <span className="inline-flex h-5 flex-none items-center rounded-full bg-[#EDF3F0] px-1.5 text-[11.5px] font-semibold text-[#1B4D3E]">
              {value.length}
            </span>
          ) : null}
          <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] border-[#E8E5E0] p-0 shadow-none"
      >
        <div className="border-b border-[#F0EEEA] p-2.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search states…"
            aria-label="Search states"
            className="h-8"
          />
        </div>
        {/* Distinct from the trigger's label so accessible-name lookups stay
            unambiguous; the option container carries the multiselect role. */}
        <div
          role="listbox"
          aria-label="State options"
          aria-multiselectable="true"
          className="max-h-[240px] overflow-y-auto py-1"
        >
          {options.length === 0 ? (
            <p className="px-3 py-3.5 text-center text-[13px] text-muted-foreground">
              No states match
            </p>
          ) : (
            options.map((code) => {
              const selected = value.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onChange(code)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-[#F5F4F1]",
                    selected && "bg-[#F7FAF8]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-[15px] w-[15px] flex-none items-center justify-center rounded-[3px] border",
                      selected ? "border-[#1B4D3E] bg-[#1B4D3E]" : "border-[#C9C5BE] bg-white",
                    )}
                  >
                    {selected ? (
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} />
                    ) : null}
                  </span>
                  {code}
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-[#F0EEEA] p-2">
          <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            {value.length ? `${value.length} selected` : "None selected"}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-7 flex-none bg-[#1B4D3E] px-3 text-[12.5px] text-white hover:bg-[#163F33]"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
