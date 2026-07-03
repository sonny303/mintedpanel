// Shared date formatting helpers used across route files.
// Standardizes on 'MMM d, yyyy' (and 'MMM d, yyyy · h:mm a' for timestamps).
import { format, parseISO } from "date-fns";

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d, yyyy · h:mm a");
  } catch {
    return "—";
  }
}
