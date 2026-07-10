import React from "react";

export interface TableColumn<Row = any> {
  /** Unique key; also the row property read when no `render` is given. */
  key: string;
  /** Column header (rendered 11px uppercase). */
  header: React.ReactNode;
  align?: "left" | "right";
  /** Fixed column width (CSS value). */
  width?: string;
  /** Render mono + tertiary (for IDs, timestamps). */
  mono?: boolean;
  /** Custom cell renderer. */
  render?: (row: Row, index: number) => React.ReactNode;
}

export interface TableProps<Row = any> extends React.TableHTMLAttributes<HTMLTableElement> {
  columns: TableColumn<Row>[];
  rows: Row[];
  /** Stable key per row. */
  rowKey?: (row: Row, index: number) => React.Key;
  /** Makes rows clickable (pointer cursor). */
  onRowClick?: (row: Row, index: number) => void;
}

/**
 * Dense data table — 40px rows, 11px uppercase headers, 1px dividers, no
 * shadow, hover highlight. Column-driven; use `render` for two-line cells,
 * Badge rows, and mono IDs. For loading/empty, drop <EmptyState> in place.
 *
 * @startingPoint section="Data" subtitle="Dense table · pills, mono, hover" viewport="700x260"
 */
export function Table<Row = any>(props: TableProps<Row>): JSX.Element;
