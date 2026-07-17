// Shared date picker (E1.4 TE-6 enabler, shared with future date fields):
// the canonical shadcn composition — Button trigger + Popover + Calendar —
// over the newly added ui/popover + ui/calendar primitives. Value is a plain
// ISO date string ("YYYY-MM-DD", no time/zone), matching how date columns
// are stored. Logged in DESIGN-DEBT.md with the two primitives.
import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

interface DatePickerProps {
  id?: string;
  /** ISO date string ("YYYY-MM-DD") or "" for unset. */
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
  invalid?: boolean;
}

export function DatePicker({ id, value, onChange, ariaLabel, invalid }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? fromIsoDate(value) : undefined;
  return (
    // modal — the picker is used inside modal dialogs, where a non-modal
    // popover portal would be pointer-events-locked by the dialog overlay.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn(
            "h-9 w-full justify-start px-3 text-left text-[13px] font-normal",
            !value && "text-muted-foreground",
            invalid && "border-[#FCA5A5]",
          )}
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          {value ? fmtDate(value) : "Pick a date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            onChange(d ? toIsoDate(d) : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
