`Dialog` is the modal — a bordered card on a dimmed backdrop with header, body, and a right-aligned footer action row.

```jsx
<Dialog
  title="Change case status"
  onClose={() => setOpen(false)}
  footer={<>
    <Button variant="secondary" onClick={close}>Cancel</Button>
    <Button variant="primary" onClick={save}>Save</Button>
  </>}
>
  <FormField label="Status">
    <Select><option>Under review</option><option>Submitted</option></Select>
  </FormField>
</Dialog>
```

No shadow — the 1px border carries it. Actions go in `footer`, primary last. Keep the body to a single task.
