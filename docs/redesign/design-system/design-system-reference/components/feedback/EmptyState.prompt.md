`EmptyState` fills empty tables and lists — a centered message with an optional action, plus a `loading` skeleton variant.

```jsx
<EmptyState
  title="No cases match these filters"
  description="Try clearing a filter or widening the date range."
  action={<Button variant="secondary">Clear filters</Button>}
/>

<EmptyState loading rows={2} />
```

Write the title as what's absent and keep copy filter-aware. Use the `loading` variant while data streams in.
