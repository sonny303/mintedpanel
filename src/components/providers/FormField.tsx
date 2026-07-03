// Shared Field + FieldLabel primitives for provider forms.
// Associates label with child input via generated id + htmlFor for a11y.
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
    >
      {children}
    </label>
  );
}

export function Field({
  label,
  error,
  helper,
  children,
}: {
  label: string;
  error?: string;
  helper?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  let controlId = generatedId;
  let rendered: ReactNode = children;

  if (isValidElement(children)) {
    const child = children as ReactElement<{ id?: string }>;
    if (child.props.id) {
      controlId = child.props.id;
    } else {
      rendered = cloneElement(child, { id: generatedId });
    }
  }

  return (
    <div>
      <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
      {rendered}
      {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
