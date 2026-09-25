`Input` is the single-line text field — 34px tall, forest focus ring, red error border, muted disabled fill.

```jsx
<Input placeholder="Optional" />
<Input defaultValue="Alex" />
<Input mono defaultValue="1111111111" />   {/* NPIs / IDs */}
<Input error defaultValue="11111" />
<Input disabled defaultValue="PT-4471" />
```

Set `mono` for numbers and IDs. Wrap in `FormField` for the label + message; use `error` to mark an invalid value.
