`CopyButton` is the compact copy chip for IDs (NPI, CAQH, license #) — click copies the value and the chip confirms with a green "✓ Copied" for ~1.2s.

```jsx
<CopyButton value="1841293756" />
<CopyButton value="14237788" onCopy={(v) => track("copy_caqh", v)} />
```

Sits at the end of a key/value ID row next to a mono value. 26px tall. The confirmed state is automatic — don't build your own.
