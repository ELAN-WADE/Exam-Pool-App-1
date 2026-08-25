import React, { type ReactNode } from "react";
import styles from "./PageHeader.module.css";

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  badge,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`${styles.header} ${className}`}>
      <div className={styles.left}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {badge}
        </div>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
