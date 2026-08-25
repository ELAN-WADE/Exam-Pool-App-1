"use client";

import { useCallback, useEffect, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import {
  CalendarIcon,
  RefreshIcon,
  ActivityIcon,
} from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import styles from "./page.module.css";

interface CalendarEvent {
  id: number;
  term_id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  type: "holiday" | "exam_period" | "resumption" | "event" | "deadline" | "other";
  created_at: string;
}

type EventTypeFilter = "all" | CalendarEvent["type"];

export default function GuardianCalendarPage() {
  return (
    <RequireRole role="guardian">
      <CalendarContent />
    </RequireRole>
  );
}

function CalendarContent() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>("all");

  const { selectedSession, selectedTerm } = useAcademic();

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const data = await api.get<any>("/api/v2/calendar");
      setEvents(data ?? []);
    } catch (err: any) {
      setError(err.message || "Failed to load calendar events");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredEvents = events.filter((event) => {
    if (typeFilter === "all") return true;
    return event.type === typeFilter;
  });

  const eventTypeFilters: { value: EventTypeFilter; label: string }[] = [
    { value: "all", label: "All Events" },
    { value: "holiday", label: "Holidays" },
    { value: "exam_period", label: "Exam Periods" },
    { value: "resumption", label: "Resumption" },
    { value: "event", label: "Events" },
    { value: "deadline", label: "Deadlines" },
    { value: "other", label: "Other" },
  ];

  const getEventTypeClass = (type: string) => {
    switch (type) {
      case "holiday":
        return styles.typeHoliday;
      case "exam_period":
        return styles.typeExamPeriod;
      case "resumption":
        return styles.typeResumption;
      case "event":
        return styles.typeEvent;
      case "deadline":
        return styles.typeDeadline;
      default:
        return styles.typeOther;
    }
  };

  const getEventTypeLabel = (type: string) => {
    switch (type) {
      case "holiday":
        return "Holiday";
      case "exam_period":
        return "Exam Period";
      case "resumption":
        return "Resumption";
      case "event":
        return "Event";
      case "deadline":
        return "Deadline";
      default:
        return "Other";
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getDateParts = (dateStr: string) => {
    if (!dateStr) return { month: "", day: "" };
    const date = new Date(dateStr);
    return {
      month: date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
      day: date.getDate().toString(),
    };
  };

  if (error) {
    return (
      <div style={{
        background: "var(--color-surface, #FFFFFF)",
        border: "1px solid var(--color-border, #E2E8F0)",
        borderRadius: "12px",
        padding: "3rem 2rem",
        textAlign: "center",
        maxWidth: "460px",
        margin: "3rem auto",
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          background: "rgba(220, 38, 38, 0.08)",
          color: "var(--color-danger, #DC2626)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1rem",
        }}>
          <ActivityIcon width="20" height="20" />
        </div>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-text, #0F172A)", marginBottom: "0.35rem" }}>
          Unable to Load Calendar
        </h3>
        <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.8125rem", marginBottom: "1.25rem", lineHeight: 1.5 }}>
          {error}
        </p>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => loadData()}
          style={{ padding: "0.45rem 1.25rem", borderRadius: "8px", fontWeight: 600 }}
        >
          <RefreshIcon width="13" height="13" /> Retry Connection
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.headerWrapper}>
          <div className={styles.headerLeft}>
            <Skeleton width={200} height={28} borderRadius="6px" />
            <Skeleton width={260} height={16} borderRadius="4px" style={{ marginTop: "0.35rem" }} />
          </div>
          <div className={styles.headerRight}>
            <Skeleton width={120} height={30} borderRadius="6px" />
          </div>
        </div>
        <div className={styles.commandStrip}>
          <div className={styles.filterButtons}>
            <Skeleton width={100} height={32} borderRadius="8px" />
            <Skeleton width={100} height={32} borderRadius="8px" />
            <Skeleton width={100} height={32} borderRadius="8px" />
          </div>
        </div>
        <div className={styles.eventsList}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.eventCard}>
              <Skeleton width={56} height={56} borderRadius="12px" />
              <div style={{ flex: 1 }}>
                <Skeleton width={200} height={16} borderRadius="4px" />
                <Skeleton width={150} height={12} borderRadius="4px" style={{ marginTop: "0.35rem" }} />
                <Skeleton width={100} height={12} borderRadius="4px" style={{ marginTop: "0.5rem" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Page Header */}
      <div className={styles.headerWrapper}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <h1 className={styles.pageTitle}>Academic Calendar</h1>
            <span className={styles.roleBadge}>Guardian</span>
          </div>
          <p className={styles.subtitle}>
            View academic events, holidays, and exam schedules.
          </p>
        </div>

        <div className={styles.headerRight}>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="btn btn-outline btn-sm"
            style={{ padding: "0.35rem 0.7rem", borderRadius: "8px", fontWeight: 600 }}
          >
            <RefreshIcon width="12" height="12" style={{ color: "#6366F1", animation: refreshing ? "spin 1s linear infinite" : "none" }} />
            <span>{refreshing ? "Syncing…" : "Sync"}</span>
          </button>
        </div>
      </div>

      {/* Command Strip with Filters */}
      <div className={styles.commandStrip}>
        <div className={styles.filterButtons}>
          {eventTypeFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`${styles.filterButton} ${typeFilter === filter.value ? styles.filterButtonActive : ""}`}
              onClick={() => setTypeFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events List */}
      {filteredEvents.length > 0 ? (
        <div className={styles.eventsList}>
          {filteredEvents.map((event) => {
            const dateParts = getDateParts(event.start_date);
            return (
              <div key={event.id} className={styles.eventCard}>
                <div className={styles.eventDate}>
                  <span className={styles.eventMonth}>{dateParts.month}</span>
                  <span className={styles.eventDay}>{dateParts.day}</span>
                </div>

                <div className={styles.eventDetails}>
                  <div className={styles.eventTitle}>{event.title}</div>
                  {event.description && (
                    <div className={styles.eventDescription}>{event.description}</div>
                  )}
                  <div className={styles.eventMeta}>
                    <span className={`${styles.eventTypeBadge} ${getEventTypeClass(event.type)}`}>
                      {getEventTypeLabel(event.type)}
                    </span>
                    <span className={styles.eventMetaItem}>
                      <CalendarIcon width="12" height="12" />
                      {formatDate(event.start_date)} - {formatDate(event.end_date)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={typeFilter === "all" ? "No Events Available" : `No ${getEventTypeLabel(typeFilter)} Events`}
          description={
            typeFilter === "all"
              ? "No academic calendar events have been published yet."
              : `No ${getEventTypeLabel(typeFilter).toLowerCase()} events found.`
          }
          icon={<CalendarIcon width="22" height="22" />}
        />
      )}
    </div>
  );
}