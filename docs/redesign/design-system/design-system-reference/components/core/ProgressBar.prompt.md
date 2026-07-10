`ProgressBar` shows credentialing readiness — forest fill on a muted track, with an optional label and a mono "x of y" count.

```jsx
<ProgressBar label="In-network" value={5} max={8} />
<ProgressBar label="Fields covered" value={7} max={19} />
<ProgressBar value={100} showCount={false} />
```

Fill is always forest — never recolor it by state (that's what `ActionBadge` is for). Track stays 6px. The count reads from `value`/`max` unless you pass `countText`.
