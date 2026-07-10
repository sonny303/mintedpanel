`FormField` wraps every form control with its uppercase label and a single help/error line — compose it with `Input`, `Select`, or `Textarea`.

```jsx
<FormField label="Last name">
  <Input defaultValue="Hershberger" />
</FormField>

<FormField label="NPI" error="Enter a valid 10-digit NPI">
  <Input mono error defaultValue="18412" />
</FormField>

<FormField label="Case status">
  <Select><option>Under review</option><option>Submitted</option></Select>
</FormField>
```

`error` (a string) turns the label + message red and pairs with `error` on the control. Use `hint` for muted helper text. Labels are always 12px uppercase — don't hand-roll them.
