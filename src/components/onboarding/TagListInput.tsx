// Free-text tag list (E1.2 TE-7) for languages offered / interpreter
// languages — open-ended values, so a closed-list multi-select doesn't fit.
// Composed from approved primitives only (Input + Button + Badge): type a
// value, Add (or Enter) appends a removable badge. Logged in DESIGN-DEBT.md
// alongside the E1.1 multi-select composition.
import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TagListInputProps {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
}

export function TagListInput({ id, value, onChange, addLabel }: TagListInputProps) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const tag = draft.trim();
    if (!tag) return;
    if (!value.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      onChange([...value, tag]);
    }
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-9"
        />
        <Button type="button" variant="outline" onClick={add} className="h-9 flex-none">
          {addLabel}
        </Button>
      </div>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 rounded-[4px] font-normal">
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(value.filter((v) => v !== tag))}
                className="rounded-sm hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
