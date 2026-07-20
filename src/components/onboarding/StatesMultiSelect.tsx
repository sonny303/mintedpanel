// Operating-states multi-select (E1.1 TE-5). The design system defines no
// multi-select primitive, so this is the sanctioned composition from approved
// primitives — a DropdownMenu of DropdownMenuCheckboxItem rows over the
// canonical US_STATES list, with the selection rendered as text on the
// trigger. Logged in DESIGN-DEBT.md (same PR) per the register rule.
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { US_STATES } from "@/lib/usStates";

// When this menu opens inside a modal Dialog (ProviderGroupForm, GroupsPanel),
// the Dialog's scroll lock (react-remove-scroll) swallows wheel events over the
// PORTALED menu — the portal renders outside the lock's allowed subtree, and
// modal={false} (required below) means the menu never mounts its own lock. The
// menu is geometrically scrollable (max-h + overflow-y-auto) but the wheel
// never moves it, stranding every state below the fold. Owning the wheel event
// (non-passive, preventDefault + imperative scroll) restores scrolling in every
// context without double-scrolling where the native path still works.
function ownWheelScroll(node: HTMLDivElement | null) {
  if (!node) return;
  const onWheel = (e: WheelEvent) => {
    const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 32 : e.deltaY;
    node.scrollTop += dy;
    e.preventDefault();
    e.stopPropagation();
  };
  node.addEventListener("wheel", onWheel, { passive: false });
  return () => node.removeEventListener("wheel", onWheel);
}

interface StatesMultiSelectProps {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  invalid?: boolean;
}

export function StatesMultiSelect({ id, value, onChange, invalid }: StatesMultiSelectProps) {
  const toggle = (code: string, checked: boolean) => {
    onChange(checked ? [...value, code] : value.filter((s) => s !== code));
  };
  return (
    // modal={false} because this menu lives inside the ProviderGroupForm Dialog.
    // A modal DropdownMenu sets `pointer-events: none` on <body>, which cascades
    // to the whole DialogContent (the menu content is portaled out and re-enabled
    // alone). Re-clicking the trigger while the menu is open then lands on a
    // pointer-events:none element, so the click resolves to the document root —
    // which BOTH the menu's and the Dialog's dismissable layers read as an
    // "outside" pointerdown, closing the entire modal and discarding form data.
    // Non-modal keeps the trigger interactive so the re-click only toggles the menu.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label="Operating states"
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-[4px] border bg-white px-3 text-left text-[13px] ${
            invalid ? "border-[#FCA5A5]" : "border-[#E8E5E0]"
          }`}
        >
          <span className={value.length ? "text-foreground" : "text-muted-foreground"}>
            {value.length ? value.join(", ") : "Select states"}
          </span>
          <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={ownWheelScroll}
        align="start"
        className="max-h-[260px] w-56 overflow-y-auto"
      >
        {US_STATES.map((code) => (
          <DropdownMenuCheckboxItem
            key={code}
            checked={value.includes(code)}
            // preventDefault keeps the menu open while toggling several states.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => toggle(code, checked === true)}
          >
            {code}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
