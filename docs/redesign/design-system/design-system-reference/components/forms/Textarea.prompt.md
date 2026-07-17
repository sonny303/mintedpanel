`Textarea` is the multi-line note field — matches `Input`'s focus/error treatment, non-resizing by default.

```jsx
<Textarea placeholder="Add a note…" />
<Textarea rows={3} defaultValue="Called BCBS Kansas 6/28 — verification in progress." />
```

Wrap in `FormField` for the label. Set `rows` for height; leave resize off to keep dense layouts stable.
