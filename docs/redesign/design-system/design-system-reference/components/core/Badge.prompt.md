`Badge` is the single status-pill primitive — use it for any payer/case status label; six fixed tones, optional leading dot.

```jsx
<Badge tone="review">Under review</Badge>
<Badge tone="active">Active</Badge>
<Badge tone="overdue" dot>Overdue</Badge>
```

Tones: `active` (green), `review` (blue), `pending` (amber), `overdue` (red), `submitted` (teal), `idle` (gray). Height is fixed at 22px; labels stay one–two words and never wrap. A plain pill reads as a payer status; add `dot` only for derived state (usually reach for `ActionBadge` instead).
