// Centered empty-state message with optional icon, description, and action slot.
// Used across tables, cards, and lists for consistent copy.

export function EmptyState({
  message,
  description,
  action,
  icon,
}: {
  message: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center text-[13px] text-muted-foreground">
      {icon ? <div className="mb-3">{icon}</div> : null}
      <span>{message}</span>
      {description ? <p className="text-[12px] text-muted-foreground mt-1">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
