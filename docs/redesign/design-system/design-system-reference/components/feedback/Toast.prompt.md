`Toast` is the transient notification card (production drives it via `sonner` — this is the approved visual).

```jsx
<Toast tone="success" title="Case status updated" description="BCBS Kansas → Submitted" onClose={dismiss} />
<Toast tone="danger" title="Couldn't save" description="Check your connection." action={<Button variant="link">Retry</Button>} />
```

1px border, no shadow. Short title, one-line description. For persistent inline messages use the notice patterns, not a toast.
