// Triage GroupedList (M1): collapsible groups with count + progress in the
// header and a rotating chevron. Density switches row spacing; the toggle UI
// and user_table_prefs persistence are M2.
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ProgressBar } from "./ProgressBar";

export type GroupedListDensity = "comfortable" | "compact";

export interface GroupedListGroup {
  id: string;
  title: string;
  count: number;
  progress?: { value: number; max: number };
  rows: ReactNode[];
}

interface GroupedListProps {
  groups: GroupedListGroup[];
  density: GroupedListDensity;
}

export function GroupedList({ groups, density }: GroupedListProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const rowPadding = density === "compact" ? "py-1.5" : "py-3";

  return (
    <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-hidden">
      {groups.map((group, i) => {
        const isCollapsed = collapsed[group.id] ?? false;
        return (
          <div key={group.id} className={i > 0 ? "border-t border-mp-border" : ""}>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !isCollapsed }))}
              className="w-full flex items-center gap-3 bg-mp-muted/60 px-4 py-2.5 text-left hover:bg-mp-muted transition-colors"
            >
              <ChevronDown
                className={`w-4 h-4 text-[color:var(--mp-ink-faint)] transition-transform duration-200 ${
                  isCollapsed ? "-rotate-90" : ""
                }`}
              />
              <span className="text-[var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
                {group.title}
              </span>
              <span className="tabular-nums text-[var(--mp-text-xs)] font-medium text-[color:var(--mp-ink-faint)]">
                {group.count}
              </span>
              {group.progress ? (
                <span className="ml-auto w-28 flex-shrink-0">
                  <ProgressBar value={group.progress.value} max={group.progress.max} />
                </span>
              ) : null}
            </button>
            {!isCollapsed ? (
              <ul>
                {group.rows.map((row, rowIndex) => (
                  <li
                    key={rowIndex}
                    className={`px-4 ${rowPadding} ${rowIndex > 0 ? "border-t border-mp-border/60" : ""}`}
                  >
                    {row}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
