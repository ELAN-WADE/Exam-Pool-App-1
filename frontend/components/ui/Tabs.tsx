import React, { type ReactNode } from "react";
import styles from "./Tabs.module.css";

export type TabItem = {
  id: string;
  label: string;
  count?: number | string;
  icon?: ReactNode;
};

export type TabsProps = {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
};

export function Tabs({ tabs, activeTab, onChange, className = "" }: TabsProps) {
  return (
    <div className={`${styles.tabList} ${className}`} role="tablist">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`${styles.tab} ${isActive ? styles.active : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <span className="inline-flex">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && <span className={styles.badge}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
