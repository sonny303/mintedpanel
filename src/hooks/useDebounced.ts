// Shared debounce hook: returns the input value delayed by `ms` milliseconds.
// Used by list/search inputs across routes.
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
