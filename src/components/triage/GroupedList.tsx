// Triage GroupedList (M1/M2 fix): one card per group. The header row is a
// single button whose right-edge chevron toggles expand/collapse; the
// expanded body is arbitrary content (the work views pass a CaseTable).
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface GroupedListGroup {
  id: string;
  /** Header row content; laid out by the caller, chevron appended here. */
  header: ReactNode;
  /** Expanded body. */
  children: ReactNode;
}

interface GroupedListProps {
  groups: GroupedListGroup[];
}

export function GroupedList({ groups }: GroupedListProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const isCollapsed = collapsed[group.id] ?? false;
        return (
          <section
            key={group.id}
            className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-hidden"
          >
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !isCollapsed }))}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-mp-muted/40 transition-colors"
            >
              {group.header}
              <ChevronDown
                className={`w-4 h-4 flex-shrink-0 text-[color:var(--mp-ink-faint)] transition-transform duration-200 ${
                  isCollapsed ? "" : "rotate-180"
                }`}
              />
            </button>
            {!isCollapsed ? group.children : null}
          </section>
        );
      })}
    </div>
  );
}
