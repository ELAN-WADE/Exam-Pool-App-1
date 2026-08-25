"use client";

import React, { useState } from "react";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian } from "../../../components/guardian/GuardianContext";
import styles from "./page.module.css";

export default function GuardianNotificationsPage() {
  return (
    <RequireRole role="guardian">
      <NotificationsList />
    </RequireRole>
  );
}

function NotificationsList() {
  const { notifications, markAllNotificationsRead } = useGuardian();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filtered = notifications.filter((n) => {
    if (selectedCategory === "all") return true;
    return n.category === selectedCategory;
  });

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Notifications</h1>
        <button
          type="button"
          className={styles.markReadBtn}
          onClick={markAllNotificationsRead}
        >
          Mark all as read
        </button>
      </div>

      {/* Category Pills */}
      <div className={styles.categoryPills}>
        {["all", "academic", "assignment", "school", "event", "finance"].map((cat) => (
          <button
            key={cat}
            type="button"
            className={`${styles.categoryPill} ${selectedCategory === cat ? styles.categoryPillActive : ""}`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      <div className={styles.notifList}>
        {filtered.map((item) => (
          <Link
            key={item.id}
            href={item.action_link || "/guardian/dashboard"}
            className={`${styles.notifCard} ${!item.is_read ? styles.notifCardUnread : ""}`}
          >
            <div className={styles.notifIconBox}>
              {item.category === "academic" && "📊"}
              {item.category === "assignment" && "📝"}
              {item.category === "school" && "🏫"}
              {item.category === "event" && "📅"}
              {item.category === "finance" && "💳"}
            </div>

            <div className={styles.notifContent}>
              <span className={styles.notifTitle}>{item.title}</span>
              <span className={styles.notifDesc}>{item.message}</span>
              <span className={styles.notifTime}>{item.time_ago}</span>
            </div>

            {!item.is_read && <div className={styles.unreadDot} />}
          </Link>
        ))}
      </div>
    </div>
  );
}
