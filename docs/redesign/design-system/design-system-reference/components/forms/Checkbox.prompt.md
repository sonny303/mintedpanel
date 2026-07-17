`Checkbox` — 16px box, 4px radius; checked = forest fill + white check. For forms and bulk row selection.

```jsx
<Checkbox label="Include inactive payers" defaultChecked />
<Checkbox label="Notify the provider" onCheckedChange={setNotify} />
<Checkbox label="Locked" disabled />
```

Always pair with a visible label. For on/off settings prefer `Switch`; checkbox = selection, switch = state.
