"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { useAcademic } from "../context/AcademicContext";
import { api } from "../../lib/api";
import { NotificationBell } from "./NotificationBell";
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
};

export function TopBar({ onMenuClick, title }: Props) {
  const { user, logout } = useAuth();
  const { sessions, terms, selectedSession, selectedTerm, setSelectedSession, setSelectedTerm, refreshAcademic } = useAcademic();
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const pageTitle = title ?? BREADCRUMB_MAP[pathname?.replace(/\/$/, "") ?? ""] ?? "ExamPool";
  const roleLabel = user?.role === "operator" ? "Operator" : user?.role === "teacher" ? "Teacher" : "Student";

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
      {/* Left */}
      <div className={styles.left}>
        <button
          className={styles.menuBtn}
          onClick={onMenuClick}
          aria-label="Toggle menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {/* Breadcrumb removed as requested */}
      </div>

      {/* Right */}
      <div className={styles.right}>
        {/* Academic Switcher (View Filter) */}
        {(user?.role === "operator" || user?.role === "teacher") && sessions.length > 0 && (
          <div className="hidden sm:flex items-center gap-2">
            <select
              value={selectedSession?.id || ""}
              onChange={(e) => {
                const s = sessions.find(x => x.id === Number(e.target.value));
                if (s) {
                  setSelectedSession(s);
                  // Reset term if switching session
                  setSelectedTerm(null);
                }
              }}
              className="text-xs py-1 px-2 rounded-lg bg-slate-100 border border-slate-200 outline-none text-slate-700 font-bold cursor-pointer hover:bg-slate-200 transition"
              title="Select Academic Session"
            >
              {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            
            <select
              value={selectedTerm?.id || ""}
              onChange={(e) => {
                const t = terms.find(x => x.id === Number(e.target.value));
                setSelectedTerm(t || null);
              }}
              className="text-xs py-1 px-2 rounded-lg bg-slate-100 border border-slate-200 outline-none text-slate-700 font-bold cursor-pointer hover:bg-slate-200 transition"
              title="Select Academic Term"
            >
              <option value="">All Terms</option>
              {terms.filter(t => t.session_id === selectedSession?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {/* Notification bell */}
        {(user?.role === "operator" || user?.role === "teacher") && (
          <NotificationBell role={user.role === "operator" ? "ADMIN" : "teacher"} />
        )}

        {/* User chip */}
        <div className={styles.userChipWrap} ref={menuRef}>
          <button
            className={styles.userChip}
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label="User menu"
          >
            <div className={styles.avatar}>
              {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name ?? "—"}</span>
              <span className={styles.userRole}>{roleLabel}</span>
            </div>
            <svg
              width="14"
              height="14"
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
            <div className={styles.userDropdown}>
              <div className={styles.dropdownHeader}>
                <div className={styles.dropdownAvatar}>
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
