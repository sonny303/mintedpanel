`Button` is the action primitive — four variants across default / hover / disabled / loading, all at a fixed 34px height.

```jsx
<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="destructive">Remove</Button>
<Button variant="link">View history</Button>
<Button variant="primary" loading>Saving</Button>
<Button variant="secondary" disabled>Cancel</Button>
```

One primary per view, paired with a secondary Cancel. `destructive` is red, reserved for irreversible actions. `link` is text-only for inline navigation. Hover/disabled/loading states are built in — don't restyle height, radius, or weight.
