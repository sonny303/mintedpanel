`Switch` — 34×18 toggle, forest when on. For settings and enable/disable state.

```jsx
<Switch label="Portal autofill" defaultChecked />
<Switch label="Weekly digest" onCheckedChange={setDigest} />
<Switch label="Locked" disabled />
```

Switch = *state* (takes effect immediately); `Checkbox` = *selection* (part of a form you submit).
