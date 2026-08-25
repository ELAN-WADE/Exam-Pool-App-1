"use client";

import React, { useState, useEffect } from "react";
import styles from "./DigitalClock.module.css";

export function DigitalClock() {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    // Initial mount sync
    setTime(new Date());
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!time) {
    // Prevent SSR hydration mismatch
    return (
      <div className={styles.clockContainer}>
        <span className={styles.timeDigits}>--:--:--</span>
      </div>
    );
  }

  const hours = time.getHours();
  const minutes = String(time.getMinutes()).padStart(2, "0");
  const seconds = String(time.getSeconds()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = String(hours % 12 || 12).padStart(2, "0");
  const dayName = time.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();

  return (
    <div
      className={styles.clockContainer}
      title={`${time.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · Real-time System Clock`}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#F59E0B"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="5" fill="#FEF3C7" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
      <span className={styles.dayTag}>{dayName}</span>

      <div className={styles.timeWrapper}>
        <span className={styles.timeDigits}>
          <span className={styles.digitSegment}>{displayHours}</span>
          <span className={styles.separator}>:</span>
          <span className={styles.digitSegment}>{minutes}</span>
          <span className={styles.separator}>:</span>
          <span className={styles.digitSeconds}>{seconds}</span>
        </span>
        <span className={styles.ampm}>{ampm}</span>
      </div>
    </div>
  );
}
