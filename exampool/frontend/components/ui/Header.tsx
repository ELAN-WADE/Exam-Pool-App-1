"use client";

import { useAuth } from "../../hooks/useAuth";
import styles from "./Header.module.css";

type Props = {
  onMenuClick?: () => void;
  showMenu?: boolean;
};

export function Header({ onMenuClick, showMenu = false }: Props) {
  const { user } = useAuth();

  return (
    <header className={styles.header}>
      <div className={styles.headerBrand}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span>ExamPool</span>
      </div>

      <nav className={styles.headerNav}>
        <button 
          className={styles.menuBtn}
          onClick={onMenuClick}
          aria-label="Toggle menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <div className={styles.headerUser}>
          <div className={styles.userAvatar}>
            {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>{user?.name ?? "User"}</div>
            <div className={styles.userRole}>{user?.role ?? "Guest"}</div>
          </div>
        </div>
      </nav>
    </header>
  );
}
