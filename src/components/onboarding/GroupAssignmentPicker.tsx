// Group assignment picker (E1.3 F1.3.2) — step one of the add-provider form:
// a REQUIRED multi-select over the org's active groups with exactly one
// marked primary (radio). Composed from approved primitives (Checkbox +
// native radio + labels); the ≥1 / one-primary invariants live in the pure
// src/lib/groupAssignments and are re-enforced by the service.
import { Checkbox } from "@/components/ui/checkbox";
import type { GroupAssignmentInput } from "@/lib/groupAssignments";
import type { ProviderGroup } from "@/types";

interface GroupAssignmentPickerProps {
  groups: ProviderGroup[];
  value: GroupAssignmentInput[];
  onChange: (next: GroupAssignmentInput[]) => void;
}

export function GroupAssignmentPicker({ groups, value, onChange }: GroupAssignmentPickerProps) {
  const activeGroups = groups.filter((g) => g.isActive);
  const byId = new Map(value.map((a) => [a.groupId, a]));

  const toggle = (groupId: string, checked: boolean) => {
    if (checked) {
      const next = [...value, { groupId, isPrimary: value.length === 0 }];
      onChange(next);
    } else {
      const removed = byId.get(groupId);
      let next = value.filter((a) => a.groupId !== groupId);
      // Keep exactly one primary when the primary itself is unchecked.
      if (removed?.isPrimary && next.length > 0) {
        next = next.map((a, i) => ({ ...a, isPrimary: i === 0 }));
      }
      onChange(next);
    }
  };

  const setPrimary = (groupId: string) => {
    onChange(value.map((a) => ({ ...a, isPrimary: a.groupId === groupId })));
  };

  return (
    <ul className="space-y-1.5">
      {activeGroups.map((g) => {
        const assignment = byId.get(g.id);
        return (
          <li
            key={g.id}
            className="flex items-center justify-between gap-3 rounded-md border border-[#E8E5E0] px-3 py-2"
          >
            <label className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
              <Checkbox
                checked={Boolean(assignment)}
                onCheckedChange={(v) => toggle(g.id, v === true)}
                aria-label={`Assign ${g.name}`}
              />
              <span className="truncate">{g.name}</span>
            </label>
            {assignment ? (
              <label className="flex flex-none items-center gap-1.5 text-[12px] text-muted-foreground">
                <input
                  type="radio"
                  name="primary-group"
                  checked={assignment.isPrimary}
                  onChange={() => setPrimary(g.id)}
                  aria-label={`${g.name} is the primary group`}
                  className="h-3.5 w-3.5 accent-[#1B4D3E]"
                />
                Primary
              </label>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
