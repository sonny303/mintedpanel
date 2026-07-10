`GroupedList` is the core queue pattern — provider rows that expand to reveal their cases inline. It composes `ActionBadge` and `CountBadge`.

```jsx
<GroupedList
  defaultOpen={["brian"]}
  groups={[
    { id: "brian", title: "Brian Hershberger, PT", subtitle: "Kansas · 5 payers",
      count: 5, action: "needs", items: [
        { label: "Aetna", meta: "2h ago", action: "needs" },
        { label: "Cigna", meta: "12d ago", action: "stalled" },
        { label: "BCBS Kansas", meta: "Today", action: "ontrack" },
      ] },
    { id: "sarah", title: "Sarah Nguyen, DPT", subtitle: "Kansas · 4 payers",
      count: 4, action: "blocked", items: [/* … */] },
  ]}
/>
```

`action` on a group is its rolled-up worst state; each item carries its own. Pass an ActionBadge state key or a custom node. One badge per row.
