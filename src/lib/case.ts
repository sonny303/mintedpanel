// Generic snake_case <-> camelCase converters used at the service boundary.
// Walks plain objects/arrays; preserves Date, null, and primitive values.

const toCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const toSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function camelizeRow<T = unknown>(row: unknown): T {
  if (Array.isArray(row)) {
    return row.map((item) => camelizeRow(item)) as unknown as T;
  }
  if (isPlainObject(row)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[toCamel(key)] = camelizeRow(value);
    }
    return out as T;
  }
  return row as T;
}

export function snakeizeRow<T = unknown>(row: unknown): T {
  if (Array.isArray(row)) {
    return row.map((item) => snakeizeRow(item)) as unknown as T;
  }
  if (isPlainObject(row)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[toSnake(key)] = snakeizeRow(value);
    }
    return out as T;
  }
  return row as T;
}
