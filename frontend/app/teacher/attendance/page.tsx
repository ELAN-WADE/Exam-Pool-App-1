"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import styles from "./page.module.css";

interface StudentAttendanceItem {
  id: number;
  student_id: number;
  name: string;
  reg_id: string;
  image_url?: string | null;
  class_name: string;
  status: "present" | "absent" | "late" | "holiday" | "excused";
  remarks: string;
  recorded_at?: string | null;
}

interface ClassInfo {
  id: number;
  name: string;
  section?: string;
  level?: string;
  enrolled_count?: number;
}

function TeacherAttendanceContent() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [className, setClassName] = useState<string>("");
  const [students, setStudents] = useState<StudentAttendanceItem[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<number, { status: "present" | "absent" | "late" | "holiday" | "excused"; remarks: string }>>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4500);
  };

  const loadRoster = useCallback(async (date: string, classId?: number | null) => {
    try {
      setLoading(true);
      const url = `/api/teacher/attendance/roster?date=${date}${classId ? `&class_id=${classId}` : ""}`;
      const res = await api.get(url) as any;
      if (res && res.has_class) {
        setClasses(res.classes || []);
        setSelectedClassId(res.class_id);
        setClassName(res.class_name);
        setStudents(res.students || []);

        const initialMap: Record<number, { status: "present" | "absent" | "late" | "holiday" | "excused"; remarks: string }> = {};
        for (const s of (res.students || [])) {
          initialMap[s.id] = {
            status: s.status || "present",
            remarks: s.remarks || "",
          };
        }
        setAttendanceMap(initialMap);
      } else {
        setClasses([]);
        setStudents([]);
        setAttendanceMap({});
      }
    } catch (err: any) {
      showToast("error", err?.message || "Failed to load class attendance roster");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoster(selectedDate, selectedClassId);
  }, [selectedDate, selectedClassId, loadRoster]);

  const handleStatusChange = (studentId: number, status: "present" | "absent" | "late" | "excused") => {
    setAttendanceMap((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        status,
      },
    }));
  };

  const handleRemarksChange = (studentId: number, remarks: string) => {
    setAttendanceMap((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        remarks,
      },
    }));
  };

  const handleMarkAllPresent = () => {
    setAttendanceMap((prev) => {
      const next = { ...prev };
      for (const s of students) {
        next[s.id] = {
          ...next[s.id],
          status: "present",
        };
      }
      return next;
    });
    showToast("success", `All ${students.length} students marked as Present`);
  };

  const handleSaveRegister = async () => {
    if (!selectedClassId) return;
    try {
      setSaving(true);
      const records = students.map((s) => ({
        student_id: s.id,
        status: attendanceMap[s.id]?.status || "present",
        remarks: attendanceMap[s.id]?.remarks || "",
      }));

      const res = await api.post("/api/teacher/attendance/batch", {
        class_id: selectedClassId,
        date: selectedDate,
        records,
      }) as any;

      showToast(
        "success",
        `Attendance recorded! ${res?.count || records.length} records saved and alerts broadcast to guardians.`
      );
    } catch (err: any) {
      showToast("error", err?.message || "Failed to save daily register");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    const total = students.length;

    for (const s of students) {
      const st = attendanceMap[s.id]?.status || s.status || "present";
      if (st === "present") present++;
      else if (st === "absent") absent++;
      else if (st === "late") late++;
      else if (st === "excused") excused++;
    }

    const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 100;
    return { total, present, absent, late, excused, rate };
  }, [students, attendanceMap]);

  const filteredStudents = useMemo(() => {
    if (statusFilter === "all") return students;
    return students.filter((s) => (attendanceMap[s.id]?.status || s.status) === statusFilter);
  }, [students, attendanceMap, statusFilter]);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.headerRow}>
        <div className={styles.titleArea}>
          <h1 className={styles.pageTitle}>
            Daily Attendance Register
            {className && <span className={styles.classBadge}>{className}</span>}
          </h1>
          <p className={styles.subtitle}>
            Mark daily roll call for your assigned class. Recorded statuses automatically sync to parent guardians.
          </p>
        </div>

        <div className={styles.topControls}>
          <div className={styles.dateInputWrapper}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <input
              type="date"
              className={styles.dateInput}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          <button
            type="button"
            className={styles.markAllBtn}
            onClick={handleMarkAllPresent}
            disabled={loading || students.length === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Mark All Present
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`${styles.alertBox} ${
            feedback.type === "success" ? styles.alertSuccess : styles.alertError
          }`}
        >
          {feedback.type === "success" ? "✓" : "⚠"} {feedback.text}
        </div>
      )}

      {/* Stats Bar */}
      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Enrolled</span>
          <span className={styles.statValue}>{stats.total}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel} style={{ color: "#059669" }}>Present</span>
          <span className={styles.statValue} style={{ color: "#059669" }}>{stats.present}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel} style={{ color: "#DC2626" }}>Absent</span>
          <span className={styles.statValue} style={{ color: "#DC2626" }}>{stats.absent}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel} style={{ color: "#D97706" }}>Late</span>
          <span className={styles.statValue} style={{ color: "#D97706" }}>{stats.late}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel} style={{ color: "#0284C7" }}>Excused</span>
          <span className={styles.statValue} style={{ color: "#0284C7" }}>{stats.excused}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Rate</span>
          <span className={styles.statValue}>{stats.rate}%</span>
        </div>
      </div>

      {/* Roster Table Card */}
      <div className={styles.rosterCard}>
        <div className={styles.filterHeader}>
          <div className={styles.filterPills}>
            {["all", "present", "absent", "late", "excused"].map((cat) => (
              <button
                key={cat}
                type="button"
                className={`${styles.filterPill} ${statusFilter === cat ? styles.filterPillActive : ""}`}
                onClick={() => setStatusFilter(cat)}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>

          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
            Showing {filteredStudents.length} of {students.length} students
          </div>
        </div>

        {loading ? (
          <div className={styles.emptyState}>Loading classroom roster...</div>
        ) : filteredStudents.length === 0 ? (
          <div className={styles.emptyState}>
            {students.length === 0
              ? "No students enrolled in this classroom or you are not assigned as Form Teacher."
              : "No students match the selected status filter."}
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.rosterTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student</th>
                  <th>Status</th>
                  <th>Remarks / Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s, idx) => {
                  const current = attendanceMap[s.id] || { status: "present", remarks: "" };
                  return (
                    <tr key={s.id}>
                      <td style={{ width: 40, color: "var(--color-muted)", fontSize: "0.75rem" }}>
                        {idx + 1}
                      </td>
                      <td>
                        <div className={styles.studentInfo}>
                          <div className={styles.studentAvatar}>
                            {s.name ? s.name.charAt(0).toUpperCase() : "?"}
                          </div>
                          <div>
                            <span className={styles.studentName}>{s.name}</span>
                            <span className={styles.studentReg}>{s.reg_id || `REG-${s.id}`}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.statusPills}>
                          <button
                            type="button"
                            className={`${styles.statusBtn} ${
                              current.status === "present" ? styles.statusPresentActive : ""
                            }`}
                            onClick={() => handleStatusChange(s.id, "present")}
                          >
                            P (Present)
                          </button>
                          <button
                            type="button"
                            className={`${styles.statusBtn} ${
                              current.status === "absent" ? styles.statusAbsentActive : ""
                            }`}
                            onClick={() => handleStatusChange(s.id, "absent")}
                          >
                            A (Absent)
                          </button>
                          <button
                            type="button"
                            className={`${styles.statusBtn} ${
                              current.status === "late" ? styles.statusLateActive : ""
                            }`}
                            onClick={() => handleStatusChange(s.id, "late")}
                          >
                            L (Late)
                          </button>
                          <button
                            type="button"
                            className={`${styles.statusBtn} ${
                              current.status === "excused" ? styles.statusExcusedActive : ""
                            }`}
                            onClick={() => handleStatusChange(s.id, "excused")}
                          >
                            E (Excused)
                          </button>
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          className={styles.remarksInput}
                          placeholder="Optional note (e.g. Arrived 8:15 AM)..."
                          value={current.remarks}
                          onChange={(e) => handleRemarksChange(s.id, e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom Save Action */}
      <div className={styles.bottomActionRow}>
        <span style={{ fontSize: "0.8125rem", color: "var(--color-muted)" }}>
          Changes are staged locally. Click Submit to record and broadcast to guardians.
        </span>

        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSaveRegister}
          disabled={saving || loading || students.length === 0}
        >
          {saving ? "Broadcasting..." : "Submit Daily Register"}
        </button>
      </div>
    </div>
  );
}

export default function TeacherAttendancePage() {
  return (
    <RequireRole role="teacher">
      <TeacherAttendanceContent />
    </RequireRole>
  );
}
