# Fix: Change status dialog crashes when selecting "Active"

## Root cause

`status_configs.required_fields` is stored as an array of **field-descriptor objects**, e.g.:

```json
[{ "key": "confirmedEffectiveDate", "type": "date", "label": "Confirmed Effective Date" }]
```

This is true for Active, In Progress, Denied, and Approved Pending Effective. But the `ChangeStatusDialog` in `src/routes/cases.$id.tsx` treats each entry as a plain string:

- `f.replace(/_/g, ' ')` → object has no `.replace`, throws `TypeError`
- `{f}` as JSX child → React throws "Objects are not valid as a React child"
- `key={f}` → object used as key
- `fieldValues[f]` → object used as map key

The TypeScript type `StatusConfig.requiredFields: string[]` (in `src/types/index.ts`) lies about the shape, so the bug was invisible at compile time. Selecting Active is the first time most users hit it; "Denied" / "In Progress" crash too but the user reported Active.

The warning block itself is fine — its identifiers (`AlertTriangle`, `payerName`, `state`, `warningAck`, `setWarningAck`) are all in scope.

## Fix (only touches `ChangeStatusDialog` in `src/routes/cases.$id.tsx`)

1. Add a local `FieldDescriptor` type and a `normalizeRequiredField(f: unknown)` helper at the top of the dialog file (before `ChangeStatusDialog`). It accepts either a string (legacy) or an object `{ key, type?, label?, options? }` and returns a normalized `FieldDescriptor`. No `any` — narrow from `unknown`.

2. In `ChangeStatusDialog`:
   - `const requiredFields = ((target?.requiredFields ?? []) as unknown[]).map(normalizeRequiredField);`
   - `missing` check uses `fieldValues[f.key]`.
   - The render loop uses `f.key` for `key=` and as the field id, `f.label ?? f.key.replace(/_/g, ' ')` for the label.
   - Input `type` is derived from `f.type` (`'date'` or fallback to `/date|effective/i.test(f.key)`); when `f.type === 'select'` and `f.options` is present, render a shadcn `Select` instead of `Input`.
   - Save handler writes `metadata[f.key] = fieldValues[f.key]`.

3. No changes to:
   - The warning block markup or `needsContractWarning` / `isActiveTarget` logic.
   - The `useContractFor` lookup or any service.
   - Other routes, components, or the `StatusConfig` type.

## Files

- `src/routes/cases.$id.tsx` — only the `ChangeStatusDialog` function and a small helper above it.

Switch to build mode and I'll apply it.
