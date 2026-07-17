`Tooltip` is the dark ink label bubble — **mandatory on every icon-only button** (a11y rule from the build requirements).

```jsx
<Tooltip label="Copy NPI">
  <button aria-label="Copy NPI">…icon…</button>
</Tooltip>
```

Short one-line labels only. Dark ink bg, white 12px text, 4px radius. Pair with `aria-label` on the trigger — the tooltip supplements, never replaces it.
