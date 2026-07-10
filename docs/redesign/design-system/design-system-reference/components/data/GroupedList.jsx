import React from "react";
import { ActionBadge } from "../core/ActionBadge.jsx";
import { CountBadge } from "../core/CountBadge.jsx";

function renderAction(action) {
  if (action == null) return null;
  if (typeof action === "string") return <ActionBadge state={action} />;
  return action;
}

function Chevron({ open }) {
  return (
    <span
      style={{
        width: "7px", height: "7px",
        borderRight: "1.5px solid var(--text-tertiary)",
        borderBottom: "1.5px solid var(--text-tertiary)",
        transform: open ? "rotate(45deg)" : "rotate(-45deg)",
        transition: "transform .15s", flex: "none",
      }}
    />
  );
}

/**
 * GroupedList — the core queue pattern. Each group is a provider row that
 * expands to reveal its cases inline (one row per payer). Group headers carry
 * an optional count and a derived ActionBadge; case rows carry their own.
 *
 * groups: [{ id, title, subtitle, count?, action?, items: [{ id, label, meta?, action? }] }]
 */
export function GroupedList({ groups = [], defaultOpen = [], style, ...rest }) {
  const [open, setOpen] = React.useState(() => new Set(defaultOpen));
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-tile)",
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      {groups.map((g, gi) => {
        const isOpen = open.has(g.id);
        const lastGroup = gi === groups.length - 1;
        return (
          <div key={g.id}>
            <div
              onClick={() => toggle(g.id)}
              style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "12px 20px", cursor: "pointer",
                borderBottom: lastGroup && !isOpen ? "none" : "1px solid var(--color-border-subtle)",
              }}
            >
              <Chevron open={isOpen} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--font-size-control)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-primary)" }}>{g.title}</div>
                {g.subtitle && <div style={{ fontSize: "var(--font-size-body)", color: "var(--text-tertiary)" }}>{g.subtitle}</div>}
              </div>
              {g.count != null && <CountBadge value={g.count} />}
              {renderAction(g.action)}
            </div>
            {isOpen && (
              <div style={{ background: "var(--color-bg)", borderBottom: lastGroup ? "none" : "1px solid var(--color-border-subtle)" }}>
                {(g.items || []).map((item, ii) => (
                  <div
                    key={item.id != null ? item.id : ii}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "10px 20px 10px 39px",
                      borderTop: ii === 0 ? "none" : "1px solid var(--color-border-faint)",
                    }}
                  >
                    <div style={{ flex: 1, fontSize: "var(--font-size-control)", color: "var(--text-primary)" }}>{item.label}</div>
                    {item.meta && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-body)", color: "var(--text-tertiary)", marginRight: "4px" }}>{item.meta}</span>
                    )}
                    {renderAction(item.action)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
