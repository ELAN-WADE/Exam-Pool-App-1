"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { NotificationBell } from "./NotificationBell";
import { DigitalClock } from "./DigitalClock";
import { AcademicSwitcher } from "./AcademicSwitcher";
import styles from "./TopBar.module.css";

type Props = {
  onMenuClick: () => void;
  title?: string;
};

const BREADCRUMB_MAP: Record<string, string> = {
  "/teacher/dashboard":  "Dashboard",
  "/teacher/questions":  "Question Bank",
  "/teacher/results":    "Exam Results",
  "/teacher/students":   "Students",
  "/teacher/settings":   "Settings",
  "/student/dashboard":  "Dashboard",
  "/student/exam":       "Exam Room",
  "/student/results":    "My Results",
  "/student/settings":   "Settings",
  "/ADMIN/dashboard": "Dashboard",
  "/ADMIN/subjects":  "Subjects",
  "/ADMIN/timetable": "Timetable",
  "/ADMIN/users":     "Users",
  "/ADMIN/settings":  "Settings",
  "/guardian/dashboard": "Dashboard",
  "/guardian/wards":     "My Wards",
  "/guardian/links":     "Guardian Links",
  "/guardian/calendar":  "Calendar",
  "/guardian/notifications": "Notifications",
};

export function TopBar({ onMenuClick, title }: Props) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const pageTitle = title ?? BREADCRUMB_MAP[pathname?.replace(/\/$/, "") ?? ""] ?? "ACAD";
  const roleLabel = user?.role === "operator" ? "Operator" : user?.role === "teacher" ? "Teacher" : user?.role === "guardian" ? "Guardian" : "Student";

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className={styles.topbar}>
      {/* Left: Mobile Menu & Digital Watch */}
      <div className={styles.left}>
        <button
          className={styles.menuBtn}
          onClick={onMenuClick}
          aria-label="Toggle menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <div className={styles.clockWrapper}>
          <DigitalClock />
        </div>
      </div>

      {/* Right: Academic Switcher, Notifications, User Chip */}
      <div className={styles.right}>
        {/* Compact Academic Session & Term Switcher — visible for all roles so any user can browse historical sessions */}
        {user && (
          <AcademicSwitcher />
        )}

        {/* Notification bell */}
        {(user?.role === "operator" || user?.role === "teacher" || user?.role === "guardian") && (
          <NotificationBell role={user.role === "operator" ? "ADMIN" : user.role === "guardian" ? "guardian" : "teacher"} />
        )}

        {/* User chip with Multi-Coloured Role Accent */}
        <div className={styles.userChipWrap} ref={menuRef}>
          <button
            className={styles.userChip}
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label="User menu"
          >
            <div
              className={styles.avatar}
              style={{
                background:
                  user?.role === "operator"
                    ? "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)"
                    : user?.role === "guardian"
                    ? "linear-gradient(135deg, #6366F1 0%, #818CF8 100%)"
                    : "linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
              }}
            >
              {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name ?? "—"}</span>
              <span
                className={styles.userRole}
                style={{
                  color: user?.role === "operator" ? "#4F46E5" : user?.role === "guardian" ? "#6366F1" : "#7C3AED",
                  fontWeight: 700,
                }}
              >
                {roleLabel}
              </span>
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#64748B"
              strokeWidth="2"
              className={`${styles.chevron} ${userMenuOpen ? styles.chevronOpen : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {userMenuOpen && (
            <div className={styles.userDropdown}>
              <div className={styles.dropdownHeader}>
                <div
                  className={styles.dropdownAvatar}
                  style={{
                    background:
                      user?.role === "operator"
                        ? "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)"
                        : user?.role === "guardian"
                        ? "linear-gradient(135deg, #6366F1 0%, #818CF8 100%)"
                        : "linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)",
                  }}
                >
                  {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
                </div>
                <div>
                  <div className={styles.dropdownName}>{user?.name ?? "—"}</div>
                  <div className={styles.dropdownEmail}>{user?.email ?? ""}</div>
                </div>
              </div>
              <div className={styles.dropdownDivider} />
              <button
                className={styles.dropdownItem}
                onClick={async () => {
                  setUserMenuOpen(false);
                  await logout();
                  window.location.href = "/";
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
