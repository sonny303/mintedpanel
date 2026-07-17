`Table` is the dense data table — 40px rows, uppercase headers, 1px dividers, hover highlight. It's column-driven, so cells can hold two-line provider blocks, `Badge` rows, or mono IDs.

```jsx
<Table
  columns={[
    { key: "provider", header: "Provider", render: (r) => (
      <><div style={{fontWeight:600}}>{r.name}</div>
        <div style={{fontFamily:"var(--font-mono)",color:"var(--text-tertiary)"}}>{r.npi}</div></>
    ) },
    { key: "status", header: "Status", render: (r) => <Badge tone={r.tone}>{r.status}</Badge> },
    { key: "updated", header: "Updated", align: "right", mono: true },
  ]}
  rows={cases}
  rowKey={(r) => r.npi}
/>
```

For loading and empty, render `<EmptyState loading />` / `<EmptyState … />` in place of the body. Don't add shadows or zebra striping — hover is the only row affordance.
