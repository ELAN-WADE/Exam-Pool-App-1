"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useGuardian } from "./GuardianContext";
import { AcadBrandIcon } from "../icons/Icons";
import styles from "./GuardianMobileShell.module.css";

interface Props {
  children: React.ReactNode;
}

export function GuardianMobileShell({ children }: Props) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const {
    activeWard,
    wards,
    setActiveWardId,
    childSwitcherOpen,
    openChildSwitcher,
    closeChildSwitcher,
    unreadNotificationCount,
    unreadMessageCount,
  } = useGuardian();

  const isHome = pathname === "/guardian/dashboard" || pathname === "/guardian" || pathname === "/guardian/";
  const isChildrenTab = pathname.startsWith("/guardian/wards");
  const isReportsTab = pathname.startsWith("/guardian/reports");
  const isMessagesTab = pathname.startsWith("/guardian/messages");
  const isMoreTab =
    pathname.startsWith("/guardian/settings") ||
    pathname.startsWith("/guardian/fees") ||
    pathname.startsWith("/guardian/attendance") ||
    pathname.startsWith("/guardian/calendar") ||
    pathname.startsWith("/guardian/examinations") ||
    pathname.startsWith("/guardian/performance") ||
    pathname.startsWith("/guardian/links");

  return (
    <div className={styles.pwaContainer}>
      <div className={styles.mobileViewport}>
        {/* ── 1. Top Safe-Area Mobile Header ── */}
        <header className={styles.mobileHeader}>
          <div className={styles.headerLeft}>
            {!isHome ? (
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => router.back()}
                aria-label="Go back"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            ) : (
              <Link href="/guardian/dashboard" className={styles.brandLink}>
                <div className={styles.brandIconBox}>
                  <AcadBrandIcon width={16} height={16} stroke="#FFFFFF" />
                </div>
                <span className={styles.brandTitle}>ACAD</span>
              </Link>
            )}
          </div>

          {/* Active Child Switcher Pill */}
          {activeWard && (
            <button
              type="button"
              className={styles.childSelectorPill}
              onClick={openChildSwitcher}
              aria-label={`Active ward: ${activeWard.name}. Tap to switch child.`}
            >
              <div className={styles.childAvatarTiny}>
                {activeWard.name.charAt(0).toUpperCase()}
              </div>
              <span className={styles.childPillText}>
                {activeWard.name.split(" ")[0]} ({activeWard.grade})
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.childPillChevron}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}

          {/* Notification Button */}
          <div className={styles.headerRight}>
            <Link
              href="/guardian/notifications"
              className={styles.notifyBtn}
              aria-label="Notifications"
              title="View academic notifications"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadNotificationCount > 0 && (
                <span className={styles.notifyDot}>{unreadNotificationCount}</span>
              )}
            </Link>
          </div>
        </header>

        {/* ── 2. Scrollable Body Content ── */}
        <main className={styles.mobileContent}>{children}</main>

        {/* ── 3. Fixed Bottom Navigation Bar ── */}
        <nav className={styles.bottomNav} aria-label="Main Navigation">
          {/* Tab 1: Home */}
          <Link
            href="/guardian/dashboard"
            className={`${styles.navItem} ${isHome ? styles.navItemActive : ""}`}
          >
            <div className={styles.navIconBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isHome ? "2.5" : "2"} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <span className={styles.navLabel}>Home</span>
          </Link>

          {/* Tab 2: Children */}
          <Link
            href="/guardian/wards"
            className={`${styles.navItem} ${isChildrenTab ? styles.navItemActive : ""}`}
          >
            <div className={styles.navIconBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isChildrenTab ? "2.5" : "2"} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <span className={styles.navLabel}>Children</span>
          </Link>

          {/* Tab 3: Reports */}
          <Link
            href="/guardian/reports"
            className={`${styles.navItem} ${isReportsTab ? styles.navItemActive : ""}`}
          >
            <div className={styles.navIconBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isReportsTab ? "2.5" : "2"} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <span className={styles.navLabel}>Reports</span>
          </Link>

          {/* Tab 4: Messages */}
          <Link
            href="/guardian/messages"
            className={`${styles.navItem} ${isMessagesTab ? styles.navItemActive : ""}`}
          >
            <div className={styles.navIconBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isMessagesTab ? "2.5" : "2"} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {unreadMessageCount > 0 && <span className={styles.navBadge} />}
            </div>
            <span className={styles.navLabel}>Messages</span>
          </Link>

          {/* Tab 5: More */}
          <Link
            href="/guardian/settings"
            className={`${styles.navItem} ${isMoreTab ? styles.navItemActive : ""}`}
          >
            <div className={styles.navIconBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isMoreTab ? "2.5" : "2"} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </div>
            <span className={styles.navLabel}>More</span>
          </Link>
        </nav>

        {/* ── 4. Spring Child Switcher Bottom Sheet Modal ── */}
        <AnimatePresence>
          {childSwitcherOpen && (
            <motion.div
              className={styles.sheetBackdrop}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeChildSwitcher}
            >
              <motion.div
                className={styles.sheetContainer}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={styles.sheetHandleBar} />
                <div className={styles.sheetHeader}>
                  <h3 className={styles.sheetTitle}>Select Active Child</h3>
                  <button
                    type="button"
                    className={styles.sheetCloseBtn}
                    onClick={closeChildSwitcher}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className={styles.wardList}>
                  {wards.map((w) => {
                    const isSelected = activeWard?.id === w.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        className={`${styles.wardCardOption} ${isSelected ? styles.wardCardOptionActive : ""}`}
                        onClick={() => setActiveWardId(w.id)}
                      >
                        <div className={styles.wardInfoLeft}>
                          <div className={styles.wardAvatarCircle}>
                            {w.name.charAt(0).toUpperCase()}
                          </div>
                          <div className={styles.wardMetaCol}>
                            <span className={styles.wardNameText}>{w.name}</span>
                            <span className={styles.wardGradeText}>
                              {w.grade} • Adm: {w.admission_number}
                            </span>
                          </div>
                        </div>
                        {isSelected && (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.wardCheckIcon}>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>

                <Link
                  href="/guardian/links"
                  className={styles.linkNewWardBtn}
                  onClick={closeChildSwitcher}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Link Another Ward</span>
                </Link>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
