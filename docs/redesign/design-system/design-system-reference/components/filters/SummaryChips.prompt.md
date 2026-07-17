`SummaryChips` is the row of count chips at the top of a queue — one per action state, click to filter the list below (single-select, click again to clear).

```jsx
<SummaryChips
  defaultSelected="needs"
  onSelect={(key) => setFilter(key)}
  chips={[
    { key: "needs",   label: "Needs action", count: 3 },
    { key: "blocked", label: "Blocked",      count: 2 },
    { key: "stalled", label: "Stalled",      count: 5 },
    { key: "ontrack", label: "On track",     count: 12 },
  ]}
/>
```

Tones line up with `ActionBadge` states. Selected chip flips to white fill + solid border + ring. Use controlled `selected` to sync with a `GroupedList` below.
