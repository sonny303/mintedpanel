import React from "react";

/**
 * Table — the dense data table. 40px rows, 11px uppercase headers, 1px
 * borders, no shadow, hover highlight. Column-driven; cells can render
 * anything (two-line provider cells, pill rows, mono IDs).
 *
 * columns: [{ key, header, align?: "left"|"right", width?, render?(row, i) }]
 */
export function Table({ columns = [], rows = [], rowKey, onRowClick, style, ...rest }) {
  const [hover, setHover] = React.useState(-1);
  const keyOf = (row, i) => (rowKey ? rowKey(row, i) : i);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", ...style }} {...rest}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              style={{
                textAlign: col.align || "left",
                padding: "10px 14px",
                borderBottom: "1px solid var(--color-border)",
                fontSize: "var(--font-size-meta)",
                fontWeight: "var(--font-weight-semibold)",
                letterSpacing: "var(--letter-spacing-label)",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
                whiteSpace: "nowrap",
                width: col.width,
              }}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={keyOf(row, i)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(-1)}
            onClick={onRowClick ? () => onRowClick(row, i) : undefined}
            style={{
              background: hover === i ? "var(--color-surface-hover)" : "transparent",
              cursor: onRowClick ? "pointer" : "default",
            }}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                style={{
                  padding: "7px 14px",
                  borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--color-border-subtle)",
                  textAlign: col.align || "left",
                  fontSize: col.mono ? "var(--font-size-body)" : "var(--font-size-control)",
                  fontFamily: col.mono ? "var(--font-mono)" : "inherit",
                  color: col.mono ? "var(--text-tertiary)" : "var(--text-primary)",
                  verticalAlign: "middle",
                }}
              >
                {col.render ? col.render(row, i) : row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
