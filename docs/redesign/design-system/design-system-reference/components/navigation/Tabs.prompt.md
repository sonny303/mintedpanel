`Tabs` is the segmented tab bar — muted track, active tab lifts to white with a 1px border. Drives Reports, Case detail, and Settings surfaces.

```jsx
const [tab, setTab] = React.useState("summary");
<Tabs value={tab} onValueChange={setTab}
  tabs={[
    { value: "summary", label: "Summary" },
    { value: "matrix", label: "Matrix" },
    { value: "contracts", label: "Contracts" },
    { value: "roster", label: "Roster" },
  ]} />
{tab === "summary" && <SummaryPanel />}
```

2–6 short labels. Render the active panel yourself keyed off the value.
