// Searchable single-select over the SOP field-token catalog.
//
// Radix Select / DropdownMenu own keydown for typeahead, so a search Input
// inside them never receives characters (same trap as PayerStatesField).
// Composed from Popover + Input + option rows; fuzzy filter lives in
// `tokenFuzzy.ts`. Logged in DESIGN-DEBT.md.

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filterTokenGroups } from "@/lib/tokenFuzzy";
import type { TokenGroup } from "@/lib/tokenGroups";
import { cn } from "@/lib/utils";

interface TokenPickerProps {
  /** Accessible name for the trigger (e.g. "Map First Name to a token"). */
  "aria-label": string;
  value: string;
  groupedTokens: TokenGroup[];
  onValueChange: (token: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Clear the trigger back to the placeholder after a pick. For an INSERT
   * action (append `{{token}}` to an email body) there is no selected token to
   * display — the control is a menu, not a value. */
  clearOnSelect?: boolean;
  /**
   * Set when this picker renders inside a MODAL dialog (the portal drawer).
   * Radix Dialog puts `pointer-events: none` on `<body>` while it is open and
   * the popover content is portaled to body, so without this every option is
   * visible and unclickable — and the dialog's focus trap keeps the search
   * field from taking focus. `modal` gives the popover its own layer, which
   * restores both. Left off elsewhere: on an ordinary page it would add a
   * scroll lock and a focus trap the editor does not want.
   */
  modal?: boolean;
}

export function TokenPicker({
  "aria-label": ariaLabel,
  value,
  groupedTokens,
  onValueChange,
  placeholder = "Map a token…",
  className,
  disabled = false,
  clearOnSelect = false,
  modal = false,
}: TokenPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const options = useMemo(() => filterTokenGroups(groupedTokens, query), [groupedTokens, query]);

  function pick(token: string) {
    onValueChange(token);
    setOpen(false);
    setQuery("");
  }

  const shown = clearOnSelect ? "" : value;

  return (
    <Popover
      modal={modal}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-7 w-56 items-center gap-1.5 rounded-[4px] border border-[#E8E5E0] bg-white px-2.5 text-left text-[12px]",
            className,
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              shown ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {shown || placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 border-[#E8E5E0] p-0 shadow-none"
        // Keep focus in the search field; selecting an option closes via
        // setOpen. On an ordinary page the Input's own `autoFocus` does that
        // and Radix's container focus is suppressed. Inside a modal dialog it
        // does NOT: the dialog's focus scope pulls focus back to the trigger
        // and the picker becomes unsearchable by keyboard, so there the
        // popover's own (modal) focus scope is left to run.
        onOpenAutoFocus={(e) => {
          if (modal) return;
          e.preventDefault();
        }}
      >
        <div className="border-b border-[#F0EEEA] p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tokens…"
            aria-label="Search tokens"
            className="h-8 text-[12px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const first = options[0]?.items[0];
                if (!first) return;
                e.preventDefault();
                pick(first.token);
              }
            }}
          />
        </div>
        <div
          role="listbox"
          aria-label="Token options"
          className="max-h-[240px] overflow-y-auto py-1"
        >
          {options.length === 0 ? (
            <p className="px-3 py-3.5 text-center text-[12px] text-muted-foreground">
              No tokens match
            </p>
          ) : (
            options.map((group) => (
              <div key={group.prefix} role="group" aria-label={group.label}>
                <p className="px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((token) => {
                  const selected = token.token === value;
                  return (
                    <button
                      key={token.token}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => pick(token.token)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[#F5F4F1]",
                        selected && "bg-[#F7FAF8]",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                        {token.token}
                      </span>
                      {selected ? <Check className="h-3.5 w-3.5 flex-none text-[#1B4D3E]" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
