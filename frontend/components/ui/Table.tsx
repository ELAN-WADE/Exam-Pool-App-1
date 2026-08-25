import React, { type ReactNode } from "react";
import styles from "./Table.module.css";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";

export type ColumnAlign = "left" | "center" | "right";

export type TableColumn<T> = {
  key: string;
  header: string;
  align?: ColumnAlign;
  width?: string;
  sortable?: boolean;
  render?: (row: T, index: number) => ReactNode;
};

export type TableProps<T> = {
  columns: TableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string | number;
  loading?: boolean;
  loadingRowCount?: number;
  emptyTitle?: string;
  emptySubtitle?: string;
  emptyAction?: ReactNode;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  className?: string;
};

export function Table<T>({
  columns,
  data,
  keyExtractor,
  loading = false,
  loadingRowCount = 5,
  emptyTitle = "No records found",
  emptySubtitle = "There is no data to display for the current filter criteria.",
  emptyAction,
  sortColumn,
  sortDirection,
  onSort,
  className = "",
}: TableProps<T>) {
  const getAlignClass = (align?: ColumnAlign) => {
    if (align === "center") return styles.alignCenter;
    if (align === "right") return styles.alignRight;
    return styles.alignLeft;
  };

  return (
    <div className={`${styles.tableWrapper} ${className}`}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr className={styles.tr}>
            {columns.map((col) => {
              const isSorted = sortColumn === col.key;
              return (
                <th
                  key={col.key}
                  className={`${styles.th} ${getAlignClass(col.align)} ${col.sortable ? styles.sortable : ""}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => col.sortable && onSort?.(col.key)}
                >
                  <span className={styles.thContent}>
                    {col.header}
                    {col.sortable && (
                      <span className={`${styles.sortIcon} ${isSorted ? styles.active : ""}`}>
                        {isSorted ? (
                          sortDirection === "asc" ? "↑" : "↓"
                        ) : (
                          "↕"
                        )}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {loading ? (
            Array.from({ length: loadingRowCount }).map((_, rIdx) => (
              <tr key={`skel-row-${rIdx}`} className={styles.tr}>
                {columns.map((col) => (
                  <td key={`skel-col-${col.key}`} className={`${styles.td} ${getAlignClass(col.align)}`}>
                    <Skeleton height="1.25rem" width="85%" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.emptyCell}>
                <EmptyState
                  title={emptyTitle}
                  subtitle={emptySubtitle}
                  action={emptyAction}
                />
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr key={keyExtractor(row, index)} className={styles.tr}>
                {columns.map((col) => (
                  <td
                    key={`${keyExtractor(row, index)}-${col.key}`}
                    className={`${styles.td} ${getAlignClass(col.align)}`}
                  >
                    {col.render ? col.render(row, index) : (row as any)[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
