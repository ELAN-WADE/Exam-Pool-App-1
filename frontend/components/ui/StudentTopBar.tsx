"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { DigitalClock } from "./DigitalClock";
import { AcadBrandIcon } from "../icons/Icons";
import styles from "./StudentTopBar.module.css";

export function StudentTopBar() {
  const { user, logout } = useAuth();
  const pathname = usePathname() || "";
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifyMenuOpen, setNotifyMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(3);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifyRef = useRef<HTMLDivElement>(null);

  const notifications = [
    {
      id: 1,
      icon: "📢",
      title: "First Term Academic Session Active",
      time: "1 hour ago",
      link: "/student/dashboard",
    },
    {
      id: 2,
      icon: "📅",
      title: "Continuous Assessment Timetable Published",
      time: "3 hours ago",
      link: "/student/dashboard",
    },
    {
      id: 3,
      icon: "📝",
      title: "Class Offline Assignments Synced",
      time: "1 day ago",
      link: "/student/offline-assignments",
    },
  ];

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) {
        setNotifyMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className={styles.navbar}>
      <div className={styles.navContainer}>
        {/* Left: Brand Identity */}
        <div className={styles.brandGroup}>
          <Link href="/student/dashboard" className={styles.brandLink}>
            <div className={styles.brandIcon}>
              <AcadBrandIcon width={18} height={18} stroke="#FFFFFF" color="#FFFFFF" />
            </div>
            <span className={styles.brandText}>ACAD</span>
          </Link>
        </div>

        {/* Right: Real-Time Clock, Notifications & Candidate Account Options */}
        <div className={styles.rightGroup}>
          {/* Live System Clock */}
          <div className={styles.clockWrapper}>
            <DigitalClock />
          </div>

          {/* Interactive Notification Bell with Badge & Dropdown */}
          <div className={styles.notifyWrapper} ref={notifyRef}>
            <button
              type="button"
              className={styles.notifyBtn}
              title={`${unreadCount} academic notifications`}
              aria-label={`${unreadCount} notifications`}
              aria-expanded={notifyMenuOpen}
              onClick={() => setNotifyMenuOpen((v) => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && <span className={styles.notifyBadge}>{unreadCount}</span>}
            </button>

            {notifyMenuOpen && (
              <div className={styles.notifyMenu}>
                <div className={styles.notifyHeader}>
                  <span className={styles.notifyTitle}>Academic Updates</span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      className={styles.notifyClearBtn}
                      onClick={() => setUnreadCount(0)}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className={styles.notifyList}>
                  {notifications.map((n) => (
                    <Link
                      key={n.id}
                      href={n.link}
                      className={styles.notifyItem}
                      onClick={() => setNotifyMenuOpen(false)}
                    >
                      <div className={styles.notifyIconBox}>{n.icon}</div>
                      <div className={styles.notifyItemContent}>
                        <span className={styles.notifyItemText}>{n.title}</span>
                        <span className={styles.notifyItemTime}>{n.time}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* User Profile Pill Menu */}
          <div className={styles.userWrapper} ref={menuRef}>
            <button
              type="button"
              className={styles.userBtn}
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-expanded={userMenuOpen}
              aria-label="Candidate account options"
            >
              <div className={styles.userAvatar}>
                {user?.name?.charAt(0)?.toUpperCase() ?? "S"}
              </div>
              <div className={styles.userInfoCol}>
                <span className={styles.userName}>
                  {user?.name?.split(" ")[0] ?? "Student"}
                </span>
                {user?.grade && (
                  <span className={styles.userGradeSub}>{user.grade}</span>
                )}
              </div>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`${styles.chevron} ${userMenuOpen ? styles.chevronOpen : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {userMenuOpen && (
              <div className={styles.userMenu}>
                <div className={styles.menuHeader}>
                  <div className={styles.menuName}>{user?.name ?? "Student"}</div>
                  <div className={styles.menuMeta}>
                    {user?.reg_id || user?.email || "Candidate"}
                  </div>
                  {user?.grade && (
                    <div className={styles.menuGradePill}>{user.grade}</div>
                  )}
                </div>
                <div className={styles.menuDivider} />
                <Link
                  href="/student/settings"
                  className={styles.menuItem}
                  onClick={() => setUserMenuOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Profile &amp; Settings
                </Link>
                <button
                  type="button"
                  className={`${styles.menuItem} ${styles.logoutItem}`}
                  onClick={async () => {
                    setUserMenuOpen(false);
                    await logout();
                    window.location.href = "/";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
