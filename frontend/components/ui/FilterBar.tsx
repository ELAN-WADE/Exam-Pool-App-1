import React, { type ReactNode } from "react";
import styles from "./FilterBar.module.css";

export type FilterOption = {
  label: string;
  value: string;
};

export type FilterConfig = {
  id: string;
  label?: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
};

export type FilterBarProps = {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchPlaceholder?: string;
  filters?: FilterConfig[];
  customFilters?: ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  className?: string;
};

export function FilterBar({
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters,
  customFilters,
  onReset,
  hasActiveFilters,
  className = "",
}: FilterBarProps) {
  return (
    <div className={`${styles.container} ${className}`}>
      {onSearchChange !== undefined && (
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={searchPlaceholder}
            value={searchQuery || ""}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className={styles.filtersGroup}>
        {filters?.map((filter) => (
          <select
            key={filter.id}
            className={styles.selectInput}
            value={filter.value}
            onChange={(e) => filter.onChange(e.target.value)}
          >
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}

        {customFilters}

        {hasActiveFilters && onReset && (
          <button type="button" className={styles.resetBtn} onClick={onReset}>
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}
