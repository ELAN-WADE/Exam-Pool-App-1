"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithAuth } from "../../lib/api";
import { PageHeader, Button } from "./index";
import { BookIcon, CheckCircleIcon, DocumentIcon } from "../icons/Icons";

type Notification = {
  id: number;
  type: string;
  message: string;
  link: string | null;
  is_read: number;
  created_at: string;
};

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  exam_submitted: {
    label: "Exam Submission",
    icon: <CheckCircleIcon width="16" height="16" />,
  },
  subject_published: {
    label: "Questions Published",
    icon: <BookIcon width="16" height="16" />,
  },
  remark_added: {
    label: "Broadsheet Remark",
    icon: <DocumentIcon width="16" height="16" />,
  },
  info: {
    label: "System Alert",
    icon: <DocumentIcon width="16" height="16" />,
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
      setNotifications(res?.items || []);
      await fetchWithAuth("/api/notifications/read", { method: "PUT" });
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  const types = ["all", ...Array.from(new Set(notifications.map((n) => n.type)))];
  const filtered =
    filter === "all" ? notifications : notifications.filter((n) => n.type === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", width: "100%" }}>
      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="System Events & Activity"
        title="Live Updates & Notifications"
        subtitle="Chronological event feed of examination submissions, question publishing, and broadsheet updates."
      />

      {/* ── Filter Pills ──────────────────────────────────── */}
      {types.length > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {types.map((t) => {
            const meta = getTypeMeta(t);
            const active = filter === t;
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                style={{
                  padding: "0.35rem 0.75rem",
                  borderRadius: "6px",
                  border: `1px solid ${active ? "var(--color-border-hover, #CBD5E1)" : "var(--color-border, #E2E8F0)"}`,
                  background: active ? "var(--color-surface-2, #F1F5F9)" : "#FFFFFF",
                  color: "var(--color-text, #0F172A)",
                  fontSize: "0.75rem",
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 120ms ease",
                }}
              >
                {t === "all" ? "All Updates" : meta.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Notifications List ────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
          Loading notification feed…
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            background: "var(--color-surface, #FFFFFF)",
            border: "1px dashed var(--color-border, #E2E8F0)",
            borderRadius: "12px",
            padding: "3.5rem 2rem",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "0.9375rem", marginBottom: "0.25rem" }}>
            No Updates Recorded
          </div>
          <div style={{ color: "var(--color-muted)", fontSize: "0.75rem" }}>
            Real-time candidate submissions and faculty actions will appear here.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {filtered.map((notif) => {
            const meta = getTypeMeta(notif.type);
            const isUnread = !notif.is_read;
            return (
              <div
                key={notif.id}
                style={{
                  background: "var(--color-surface, #FFFFFF)",
                  border: "1px solid var(--color-border, #E2E8F0)",
                  borderRadius: "10px",
                  padding: "1rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  transition: "border-color 150ms ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.875rem", minWidth: 0 }}>
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "6px",
                      background: "var(--color-surface-2, #F1F5F9)",
                      border: "1px solid var(--color-border, #E2E8F0)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-text, #0F172A)",
                      flexShrink: 0,
                    }}
                  >
                    {meta.icon}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span
                        style={{
                          fontSize: "0.6875rem",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: "var(--color-muted, #64748B)",
                        }}
                      >
                        {meta.label}
                      </span>
                      {isUnread && (
                        <span
                          style={{
                            width: "5px",
                            height: "5px",
                            borderRadius: "50%",
                            background: "var(--color-primary, #0F172A)",
                            display: "inline-block",
                          }}
                        />
                      )}
                    </div>
                    <p
                      style={{
                        margin: "0.2rem 0 0",
                        fontSize: "0.875rem",
                        color: "var(--color-text, #0F172A)",
                        fontWeight: isUnread ? 600 : 400,
                        lineHeight: 1.4,
                      }}
                    >
                      {notif.message}
                    </p>
                    <span
                      style={{
                        fontSize: "0.6875rem",
                        color: "var(--color-muted, #64748B)",
                        fontFamily: "var(--font-mono, monospace)",
                        marginTop: "0.25rem",
                        display: "block",
                      }}
                    >
                      {timeAgo(notif.created_at)}
                    </span>
                  </div>
                </div>

                {notif.link && (
                  <Link
                    href={notif.link.replace(/^\/operator\//, "/ADMIN/")}
                    style={{ textDecoration: "none", flexShrink: 0 }}
                  >
                    <Button variant="secondary" size="xs">
                      View →
                    </Button>
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
