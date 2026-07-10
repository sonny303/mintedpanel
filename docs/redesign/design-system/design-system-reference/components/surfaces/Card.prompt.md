`Card` is the base container — white, 1px border, 6px radius, **no shadow**. The most-used surface in the app (~20 files in production).

```jsx
<Card>
  <CardHeader>
    <CardTitle>Coverage</CardTitle>
    <CardDescription>7 of 19 fields covered</CardDescription>
  </CardHeader>
  <CardContent><ProgressBar value={7} max={19} /></CardContent>
  <CardFooter style={{ justifyContent: "flex-end", gap: 8 }}>
    <Button variant="secondary">Skip</Button>
    <Button variant="primary">Fill form</Button>
  </CardFooter>
</Card>
```

Never add a drop shadow. 16px padding, shared inset across header/content/footer.
