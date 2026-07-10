`Select` is the native dropdown with the system chevron — same box and focus ring as `Input`.

```jsx
<Select>
  <option>Under review</option>
  <option>Submitted</option>
</Select>
```

Pass `<option>` children. Wrap in `FormField` for the label. Use `error` to mark an invalid selection.
