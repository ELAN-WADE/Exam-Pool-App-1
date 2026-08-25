"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchWithAuth } from "../../lib/api";

type NotificationItem = {
  id: number;
  type: string;
  message: string;
  link: string | null;
  is_read: number;
  created_at: string;
};

const TYPE_META: Record<string, { icon: React.ReactNode; colour: string; label: string }> = {
  exam_submitted: {
    label: "Exam Submitted",
    colour: "#6366F1",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  subject_published: {
    label: "Questions Ready",
    colour: "#22c55e",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    ),
  },
  remark_added: {
    label: "Remark Added",
    colour: "#f59e0b",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  info: {
    label: "Info",
    colour: "#38bdf8",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
};

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? TYPE_META.info;
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

const BellIcon = ({ width = "20", height = "20" }: { width?: string; height?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

interface GuardianNotificationBellProps {
  /** Custom API endpoint for notifications (defaults to /api/notifications) */
  apiEndpoint?: string;
  /** Redirect URL for viewing all notifications (defaults to /guardian/notifications) */
  viewAllHref?: string;
}

/**
 * GuardianNotificationBell — Displays unread count badge and opens a dropdown
 * with recent notifications. Uses the guardian indigo theme (#6366F1).
 */
export function GuardianNotificationBell({
  apiEndpoint = "/api/notifications",
  viewAllHref = "/guardian/notifications",
}: GuardianNotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Initial fetch of unread count
  useEffect(() => {
    fetchWithAuth(apiEndpoint)
      .then((res) => {
        if (res?.unreadCount !== undefined) {
          setUnreadCount(res.unreadCount);
        }
      })
      .catch(() => {});
  }, [apiEndpoint]);

  // Load notifications when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchWithAuth(apiEndpoint)
        .then((res) => {
          setItems(res?.items || []);
          setUnreadCount(0);
          fetchWithAuth("/api/notifications/read", { method: "PUT" }).catch(() => {});
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [isOpen, apiEndpoint]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          padding: "0.5rem",
          color: isOpen ? "#6366F1" : "#64748b",
          transition: "color 0.2s",
        }}
        title="Notifications"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              background: "#6366F1",
              color: "white",
              fontSize: "0.65rem",
              fontWeight: "bold",
              padding: "0 0.3rem",
              borderRadius: "9999px",
              minWidth: "1.1rem",
              textAlign: "center",
              lineHeight: "1.4",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            width: 380,
            maxHeight: 480,
            overflowY: "auto",
            background: "white",
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)",
            border: "1px solid #e2e8f0",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "1rem 1.25rem",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              position: "sticky",
              top: 0,
              background: "white",
              zIndex: 10,
            }}
          >
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#0f172a" }}>
              Notifications
            </h3>
            <Link
              href={viewAllHref}
              onClick={() => setIsOpen(false)}
              style={{
                fontSize: "0.8rem",
                color: "#6366F1",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              View all
            </Link>
          </div>

          {/* Content */}
          <div
            style={{
              padding: "0.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: "0.85rem",
                }}
              >
                Loading...
              </div>
            ) : items.length === 0 ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "#64748b",
                  fontSize: "0.9rem",
                }}
              >
                No recent notifications
              </div>
            ) : (
              items.map((notif) => {
                const meta = getTypeMeta(notif.type);
                return (
                  <div
                    key={notif.id}
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      borderRadius: 8,
                      transition: "background 0.15s",
                      cursor: notif.link ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    onClick={() => {
                      if (notif.link) {
                        window.location.href = notif.link;
                      }
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: `${meta.colour}18`,
                        color: meta.colour,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.85rem",
                          color: "#1e293b",
                          lineHeight: 1.4,
                        }}
                      >
                        {notif.message}
                      </p>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          color: "#94a3b8",
                          display: "block",
                          marginTop: "0.2rem",
                        }}
                      >
                        {timeAgo(notif.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
