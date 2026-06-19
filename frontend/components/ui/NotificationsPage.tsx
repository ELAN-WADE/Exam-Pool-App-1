"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithAuth } from "../../lib/api";

type Notification = {
  id: number;
  type: string;
  message: string;
  link: string | null;
  is_read: number;
  created_at: string;
};

/* ── Type → icon/colour mapping ─────────────────────────── */
const TYPE_META: Record<string, { icon: JSX.Element; colour: string; label: string }> = {
  exam_submitted: {
    label: "Exam Submitted",
    colour: "#4f7cff",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  subject_published: {
    label: "Questions Ready",
    colour: "#22c55e",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    ),
  },
  remark_added: {
    label: "Remark Added",
    colour: "#f59e0b",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  info: {
    label: "Info",
    colour: "#38bdf8",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
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
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    loadNotifications();
  }, []);

  /* Live SSE: increment badge + prepend new notification to the list */
  useEffect(() => {
    const handler = (e: Event) => {
      const notif = (e as CustomEvent).detail as Notification;
      if (notif?.id) {
        setNotifications((prev) => [notif, ...prev]);
      }
    };
    window.addEventListener("notification_received", handler);
    return () => window.removeEventListener("notification_received", handler);
  }, []);

  const loadNotifications = async () => {
    try {
      const res = await fetchWithAuth("/api/notifications");
      setNotifications(res?.data?.items || []);
      await fetchWithAuth("/api/notifications/read", { method: "PUT" });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const types = ["all", ...Array.from(new Set(notifications.map((n) => n.type)))];
  const filtered =
    filter === "all" ? notifications : notifications.filter((n) => n.type === filter);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0.25rem 0 3rem" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.35rem" }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "var(--color-primary-glow)",
            color: "var(--color-primary)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0 }}>Live Updates</h1>
            <p style={{ color: "var(--color-muted)", fontSize: "0.85rem", margin: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px rgba(34,197,94,0.7)" }} />
              Real-time — updates push automatically
            </p>
          </div>
        </div>
      </div>

      {/* ── Filter pills ── */}
      {types.length > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
          {types.map((t) => {
            const meta = getTypeMeta(t);
            const active = filter === t;
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                style={{
                  padding: "0.35rem 1rem",
                  borderRadius: 9999,
                  border: `1.5px solid ${active ? meta.colour : "var(--color-border)"}`,
                  background: active ? `${meta.colour}18` : "transparent",
                  color: active ? meta.colour : "var(--color-muted)",
                  fontSize: "0.8rem",
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  textTransform: "capitalize",
                }}
              >
                {t === "all" ? "All" : meta.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 72, borderRadius: 12, background: "var(--color-surface)",
              border: "1px solid var(--color-border)", animation: "pulse 1.5s infinite",
            }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: "var(--color-surface)",
          border: "1.5px dashed var(--color-border)",
          borderRadius: 14,
          padding: "3.5rem 2rem",
          textAlign: "center",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" style={{ marginBottom: "1rem" }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p style={{ fontWeight: 600, color: "var(--color-text)", margin: "0 0 0.25rem" }}>
            {filter === "all" ? "No notifications yet" : `No "${getTypeMeta(filter).label}" notifications`}
          </p>
          <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", margin: 0 }}>
            Activities from teachers will appear here in real-time.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filtered.map((notif) => {
            const meta = getTypeMeta(notif.type);
            const isUnread = !notif.is_read;
            return (
              <div
                key={notif.id}
                style={{
                  background: "var(--color-surface)",
                  border: `1.5px solid ${isUnread ? meta.colour + "50" : "var(--color-border)"}`,
                  borderLeft: `4px solid ${isUnread ? meta.colour : "var(--color-border)"}`,
                  borderRadius: 12,
                  padding: "1rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  boxShadow: isUnread ? `0 2px 12px ${meta.colour}18` : "none",
                  transition: "box-shadow 0.2s, border-color 0.2s",
                }}
              >
                {/* Icon bubble */}
                <div style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  background: `${meta.colour}18`,
                  color: meta.colour,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {meta.icon}
                </div>

                {/* Body */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                    <span style={{
                      fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase",
                      letterSpacing: "0.06em", color: meta.colour,
                    }}>
                      {meta.label}
                    </span>
                    {isUnread && (
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: meta.colour, display: "inline-block",
                      }} />
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-text)", fontWeight: isUnread ? 600 : 400, lineHeight: 1.45 }}>
                    {notif.message}
                  </p>
                  <span style={{ fontSize: "0.78rem", color: "var(--color-muted)", marginTop: "0.25rem", display: "block" }}>
                    {timeAgo(notif.created_at)}
                  </span>
                </div>

                {/* CTA */}
                {notif.link && (
                  <Link
                    href={notif.link}
                    style={{
                      flexShrink: 0,
                      padding: "0.45rem 1rem",
                      background: `${meta.colour}18`,
                      color: meta.colour,
                      textDecoration: "none",
                      borderRadius: 8,
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      border: `1px solid ${meta.colour}30`,
                      whiteSpace: "nowrap",
                      transition: "background 0.15s",
                    }}
                  >
                    View →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
