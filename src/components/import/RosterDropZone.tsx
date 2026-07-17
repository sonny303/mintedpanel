// E3.0 F3.0.3 — the roster drop zone: native HTML drag-and-drop on a styled
// container with visible hover/active states, plus a hidden file-input
// fallback (click or keyboard). Pure input surface — file checks, parsing,
// and the front gate live in the uploader that owns it.
import { useRef, useState } from "react";
import { Upload } from "lucide-react";

export function RosterDropZone({
  onFile,
  disabled = false,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload roster CSV — drop a file or browse"
      aria-disabled={disabled}
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-8 text-center transition-colors ${
        dragActive
          ? "border-[#1B4D3E] bg-[var(--mp-brand-tint)]"
          : "border-[#E8E5E0] bg-white hover:border-[#1B4D3E]"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <Upload className="h-5 w-5 text-muted-foreground" />
      <div className="text-[13px] font-medium text-foreground">
        {dragActive ? "Drop the file to upload" : "Drag and drop your roster CSV here"}
      </div>
      <div className="text-[12px] text-muted-foreground">or click to browse for a .csv file</div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
