"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
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

/* ── Type → icon/colour mapping ─────────────────────────── */
const TYPE_META: Record<string, { icon: React.ReactNode; colour: string; label: string }> = {
  exam_submitted: {
    label: "Exam Submitted",
    colour: "#4f7cff",
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

const BellIcon = ({ width = "20", height = "20" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

/**
 * NotificationBell — polls initial count, then holds an SSE connection
 * to /api/notifications/stream.
 *
 * Each time a `data: …` chunk arrives:
 *  1. The unread badge count increments.
 *  2. A global CustomEvent `notification_received` is dispatched with
 *     the parsed notification payload so other components (Teacher
 *     Dashboard, Students roster, Results) can live-refresh their data.
 */
export function NotificationBell({ role = "ADMIN" }: { role?: "ADMIN" | "teacher" | "guardian" | string }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    // ── 1. Initial fetch ──────────────────────────────────────────────
    fetchWithAuth("/api/notifications")
      .then((res) => {
        if (res?.unreadCount !== undefined) {
          setUnreadCount(res.unreadCount);
        }
      })
      .catch(() => {});

    // ── 2. SSE stream — uses HttpOnly cookie via credentials: "include" ─────────
    // [SECURITY FIX VULN-13] Removed localStorage.getItem("exampool_token"). The cookie is
    // sent automatically when credentials: "include" is specified. Tokens in localStorage
    // are readable by any XSS payload; HttpOnly cookies are not.
    const controller = new AbortController();
    abortRef.current = controller;

    // [SECURITY FIX] SSE reconnection with exponential backoff
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_DELAY_MS = 1000;
    const MAX_DELAY_MS = 30000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectSSE = async () => {
      try {
        const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
        const response = await fetch(`${API_BASE}/api/notifications/stream`, {
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          // Server error — retry with backoff
          if (!controller.signal.aborted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, reconnectAttempts));
            reconnectAttempts++;
            reconnectTimer = setTimeout(connectSSE, delay);
          }
          return;
        }

        // Connected successfully — reset reconnect counter
        reconnectAttempts = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages (split on double newline)
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? ""; // Keep incomplete last chunk

          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;

            const rawJson = dataLine.slice(6).trim();
            if (!rawJson || rawJson === ": keepalive") continue;

            // Increment unread badge
            setUnreadCount((prev) => prev + 1);

            // Parse payload and broadcast globally
            try {
              const payload = JSON.parse(rawJson);
              if (payload?.id) {
                // Prepend to dropdown list if open
                setItems((prev) => [payload as NotificationItem, ...prev]);
              }
              window.dispatchEvent(
                new CustomEvent("notification_received", { detail: payload })
              );
            } catch {
              // Malformed JSON — still bump the badge, skip broadcast
            }
          }
        }

        // Stream ended normally — reconnect with backoff
        if (!controller.signal.aborted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, reconnectAttempts));
          reconnectAttempts++;
          reconnectTimer = setTimeout(connectSSE, delay);
        }
      } catch (err: any) {
        if (err.name === "AbortError") return; // Component unmounted
        // Network error — retry with backoff
        if (!controller.signal.aborted && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, reconnectAttempts));
          reconnectAttempts++;
          reconnectTimer = setTimeout(connectSSE, delay);
        }
      }
    };

    connectSSE();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller.abort();
    };
  }, []);

  // Load notifications when popover opens
  useEffect(() => {
    if (isOpen) {
      fetchWithAuth("/api/notifications")
        .then((res) => {
          setItems(res?.items || []);
          setUnreadCount(0); // optimistically reset badge
          fetchWithAuth("/api/notifications/read", { method: "PUT" }).catch(() => {});
        })
        .catch(() => {});
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          position: "relative", display: "inline-flex", alignItems: "center",
          padding: "0.5rem", color: isOpen ? "#4f7cff" : "#64748b",
          transition: "color 0.2s"
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
              background: "#ef4444",
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

      {/* Popover Dropdown */}
      {isOpen && (
        <div style={{
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
        }}>
          <div style={{
            padding: "1rem 1.25rem",
            borderBottom: "1px solid #e2e8f0",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            position: "sticky", top: 0, background: "white", zIndex: 10
          }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#0f172a" }}>Live Events</h3>
            <Link href={`/${role}/notifications`} onClick={() => setIsOpen(false)} style={{ fontSize: "0.8rem", color: "#4f7cff", textDecoration: "none", fontWeight: 600 }}>
              View all
            </Link>
          </div>

          <div style={{ padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {items.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "#64748b", fontSize: "0.9rem" }}>
                No recent notifications
              </div>
            ) : (
              items.map((notif) => {
                const meta = getTypeMeta(notif.type);
                return (
                  <div key={notif.id} style={{
                    display: "flex", gap: "0.75rem", padding: "0.75rem",
                    borderRadius: 8, transition: "background 0.15s",
                    cursor: notif.link ? "pointer" : "default",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onClick={() => {
                    if (notif.link) {
                      window.location.href = notif.link.replace(/^\/operator\//, "/ADMIN/");
                    }
                  }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: `${meta.colour}18`, color: meta.colour,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {meta.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: "0.85rem", color: "#1e293b", lineHeight: 1.4 }}>
                        {notif.message}
                      </p>
                      <span style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block", marginTop: "0.2rem" }}>
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
