// Canonical single-select US state/territory dropdown. The mastered code list
// is `US_STATES` (`@/lib/usStates`); this is the shared control every free-text
// "State" field standardizes onto so an operator selects a valid two-letter
// code instead of typing one (typos / full names / bad casing were the risk).
// Composition of the stock shadcn `Select` primitives, token-styled — logged in
// DESIGN-DEBT.md per the register rule. The multi-state sibling is
// `StatesMultiSelect`.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_STATES } from "@/lib/usStates";

// Radix forbids an empty-string SelectItem value, so an explicit "clear" item
// carries this sentinel and is mapped back to "" at the callback boundary.
const NONE_VALUE = "__none__";

interface StateSelectProps {
  id?: string;
  /** Two-letter code, or "" / null when nothing is selected. */
  value: string | null | undefined;
  /** Fires the bare two-letter code, or "" when cleared. */
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  /** Render a "—" item that clears the selection back to "". Default true. */
  allowNone?: boolean;
  className?: string;
}

export function StateSelect({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  placeholder = "Select state",
  allowNone = true,
  className = "h-9",
}: StateSelectProps) {
  return (
    <Select value={value ?? ""} onValueChange={(next) => onChange(next === NONE_VALUE ? "" : next)}>
      <SelectTrigger
        id={id}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value={NONE_VALUE}>—</SelectItem> : null}
        {US_STATES.map((code) => (
          <SelectItem key={code} value={code}>
            {code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
