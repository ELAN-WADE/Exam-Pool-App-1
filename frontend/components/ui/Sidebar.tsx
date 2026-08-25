"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { AcadBrandIcon } from "../icons/Icons";
import styles from "./Sidebar.module.css";
import React, { type ReactNode } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  section?: string;
  badge?: ReactNode;
};

type Props = {
  items: NavItem[];
  title: string;
  accentColor?: string;
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ items, title, open, onClose }: Props) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";

  // Group items by section transition
  let lastSection: string | undefined = undefined;

  return (
    <>
      {/* Backdrop (mobile) */}
      {open && (
        <div
          className={`${styles.backdrop} ${styles.backdropVisible}`}
          onClick={onClose}
        />
      )}

      <aside className={`${styles.sidebar} ${open ? styles.mobileOpen : ""}`}>
        {/* Logo / brand */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <AcadBrandIcon width={20} height={20} stroke="currentColor" />
          </div>
          <div className={styles.brandMeta}>
            <span className={styles.brandName}>ACAD</span>
            <span className={styles.brandRole}>{title} Portal</span>
          </div>
          {/* Close btn on mobile */}
          <button
            onClick={onClose}
            className="md:hidden ml-auto p-1 text-slate-400 hover:text-white bg-slate-800 rounded border border-slate-700"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          {items.map((item) => {
            const showSection = item.section && item.section !== lastSection;
            if (item.section) lastSection = item.section;

            const active =
              normalizedPathname === item.href.replace(/\/+$/, "") ||
              (item.href !== "/ADMIN/dashboard" && item.href !== "/teacher/dashboard" && item.href !== "/student/dashboard" &&
                normalizedPathname.startsWith(item.href.replace(/\/+$/, "") + "/"));

            return (
              <React.Fragment key={item.href}>
                {showSection && (
                  <div className={styles.navSection}>
                    <span className={styles.navSectionLabel}>{item.section}</span>
                  </div>
                )}
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={`${styles.navItem} ${active ? styles.active : ""}`}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span className={styles.navLabel}>{item.label}</span>
                  {item.badge && <span className="ml-auto text-xs">{item.badge}</span>}
                  {active && <span className={styles.activeDot} />}
                </Link>
              </React.Fragment>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
