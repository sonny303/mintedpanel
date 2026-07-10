`ActionBadge` shows the derived, one-per-row action state — use it in queue and grouped-list rows to say what needs doing (distinct from a payer-status `Badge` by its leading dot).

```jsx
<ActionBadge state="needs" />        {/* Needs action — red */}
<ActionBadge state="blocked" />      {/* Blocked — amber */}
<ActionBadge state="ontrack" />      {/* On track — teal */}
```

States: `needs`, `blocked`, `stalled`, `ontrack`, `awaiting`. Label and tone are fixed per state; pass children only to override copy. One per row — it represents the worst/rolled-up state.
