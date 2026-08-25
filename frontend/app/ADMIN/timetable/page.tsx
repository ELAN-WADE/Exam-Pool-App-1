"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then((mod) => mod.Modal), { ssr: false });
import {
  PageHeader,
  Button,
} from "../../../components/ui";
import {
  CalendarIcon,
  ClockIcon,
  SearchIcon,
  CheckCircleIcon,
  WarningIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Toast = { type: "success" | "error"; text: string } | null;

type Subject = {
  id: number;
  name: string;
  code: string;
  term: string;
  teacher_id: number;
  can_retake?: number;
  mode?: string;
  class?: string;
};

type Timetable = {
  id: number;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  class: string | null;
  section: string | null;
  exam_date: string;
  start_time: string;
  end_time: string;
  duration: number;
  exam_mode: string;
  allow_students: number;
};

type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: number;
};

const emptyForm = {
  subject_id: "",
  class: "",
  section: "",
  exam_date: "",
  start_time: "",
  end_time: "",
  duration: "60",
  exam_mode: "CBT",
  allow_students: true,
  teacher_id: "",
  can_retake: true,
  schedule_status: "scheduled",
  subject_mode: "exam",
};

export default function OperatorTimetablePage() {
  return (
    <RequireRole role="operator">
      <TimetableContent />
    </RequireRole>
  );
}

function TimetableContent() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [gradeLevels, setGradeLevels] = useState<any[]>([]);
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Timetable | null>(null);
  const [deleting, setDeleting] = useState<Timetable | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(emptyForm);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      const [s, t, u, g] = await Promise.all([
        api.getSubjects(selectedSession?.id, selectedTerm?.id),
        api.getTimetables(selectedSession?.id, selectedTerm?.id),
        api.getUsers(),
        api.getGradeLevels(),
      ]);
      if (signal?.aborted) return;
      setSubjects((s as Subject[]) ?? []);
      setTimetables((t as Timetable[]) ?? []);
      setUsers((u as User[]) ?? []);
      setGradeLevels((g as any)?.grades ?? []);
    } catch {
      if (!signal?.aborted) showToast("error", "Failed to load timetable schedule.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [showToast, selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const teachers = useMemo(() => users.filter((u) => u.role === "teacher" && u.is_active), [users]);

  // Combined subject & timetable rows
  const scheduleItems = useMemo(() => {
    return subjects.map((s) => {
      const t = timetables.find((tt) => tt.subject_id === s.id);
      return { subject: s, timetable: t };
    });
  }, [subjects, timetables]);

  const filteredItems = useMemo(() => {
    return scheduleItems.filter(({ subject, timetable }) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        subject.name.toLowerCase().includes(q) ||
        subject.code.toLowerCase().includes(q) ||
        (timetable?.exam_date && timetable.exam_date.includes(q)) ||
        (timetable?.class && timetable.class.toLowerCase().includes(q));

      if (statusFilter === "scheduled" && !timetable) return false;
      if (statusFilter === "unscheduled" && timetable) return false;

      return matchSearch;
    });
  }, [scheduleItems, search, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = subjects.length;
    const scheduled = timetables.length;
    const allowed = timetables.filter((t) => t.allow_students === 1).length;
    const pending = total - scheduled;
    return { total, scheduled, allowed, pending };
  }, [subjects, timetables]);

  const openSchedule = (subject: Subject, existingTimetable?: Timetable) => {
    setEditing(existingTimetable || null);
    if (existingTimetable) {
      setForm({
        subject_id: String(subject.id),
        class: existingTimetable.class || subject.class || "",
        section: existingTimetable.section || "",
        exam_date: existingTimetable.exam_date,
        start_time: existingTimetable.start_time,
        end_time: existingTimetable.end_time,
        duration: String(existingTimetable.duration || 60),
        exam_mode: existingTimetable.exam_mode || "CBT",
        allow_students: existingTimetable.allow_students === 1,
        teacher_id: String(subject.teacher_id || (teachers[0]?.id || "")),
        can_retake: subject.can_retake !== 0,
        schedule_status: "scheduled",
        subject_mode: subject.mode || "exam",
      });
    } else {
      setForm({
        ...emptyForm,
        subject_id: String(subject.id),
        class: subject.class || "",
        teacher_id: String(subject.teacher_id || (teachers[0]?.id || "")),
        can_retake: subject.can_retake !== 0,
        schedule_status: "scheduled",
        subject_mode: subject.mode || "exam",
      });
    }
    setModalOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.schedule_status === "scheduled") {
      if (!form.subject_id || !form.exam_date || !form.start_time || !form.end_time || !form.duration || !form.teacher_id) {
        showToast("error", "Please complete all required fields for a scheduled exam.");
        return;
      }
    } else {
      if (!form.subject_id || !form.teacher_id) {
        showToast("error", "Subject and Teacher are required.");
        return;
      }
    }
    setSaving(true);
    try {
      const selectedGl = gradeLevels.find((gl) => gl.name === form.class || String(gl.id) === String(form.class));
      const payload = {
        subject_id: Number(form.subject_id),
        class: selectedGl ? selectedGl.name : form.class || null,
        grade_level_id: selectedGl ? selectedGl.id : null,
        section: form.section || null,
        exam_date: form.exam_date,
        start_time: form.start_time,
        end_time: form.end_time,
        duration: Number(form.duration),
        exam_mode: form.exam_mode,
        allow_students: form.allow_students ? 1 : 0,
        teacher_id: Number(form.teacher_id),
        can_retake: form.can_retake ? 1 : 0,
        schedule_status: form.schedule_status,
        subject_mode: form.subject_mode,
      };

      if (editing) {
        await api.updateTimetable(editing.id, payload);
        showToast("success", "Timetable window updated.");
      } else {
        await api.createTimetable(payload);
        showToast("success", "Timetable slot created.");
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: Timetable) => {
    try {
      await api.deleteTimetable(t.id);
      showToast("success", "Timetable slot removed.");
      setDeleting(null);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <div className={styles.container}>
      {toast && <div className={styles.toast}>{toast.text}</div>}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Academic Structure"
        title="Timetable & CBT Windows"
        subtitle="Schedule examination dates, access windows, and candidate testing slots."
      />

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Total Subjects</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><CalendarIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.total}</div>
            <div className={styles.statFootnote}>Curriculum courses</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Scheduled Slots</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.scheduled}</div>
            <div className={styles.statFootnote}>Active exam windows</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Open for Candidates</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><ClockIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.allowed}</div>
            <div className={styles.statFootnote}>Unlocked test sessions</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Unscheduled</span>
            <div className={styles.statIcon} style={{ color: "#F59E0B" }}><WarningIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.pending}</div>
            <div className={styles.statFootnote}>Awaiting time slots</div>
          </div>
        </div>
      </section>

      {/* ── Filter Strip ─────────────────────────────────────── */}
      <div className={styles.filterStrip}>
        <div className={styles.searchBox}>
          <SearchIcon width="14" height="14" className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search subject, date, or class…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={styles.selectFilter}
        >
          <option value="all">All Statuses</option>
          <option value="scheduled">Scheduled Only</option>
          <option value="unscheduled">Unscheduled Only</option>
        </select>
      </div>

      {/* ── Schedule Table ───────────────────────────────────── */}
      <div className={styles.tableCard}>
        <div className={styles.tableWrapper}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Subject / Code</th>
                <th>Target Class</th>
                <th>Exam Date</th>
                <th>Time Window</th>
                <th>Student Access</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                    Loading timetable schedule…
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                    No subjects found matching the filter.
                  </td>
                </tr>
              ) : (
                filteredItems.map(({ subject, timetable }) => (
                  <tr key={subject.id}>
                    <td>
                      <div className={styles.subjectName}>{subject.name}</div>
                      <div style={{ marginTop: "0.15rem" }}>
                        <span className={styles.codeBadge}>{subject.code}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: "0.8125rem" }}>
                        {timetable?.class || subject.class || "All Cohorts"}
                        {timetable?.section ? ` (${timetable.section})` : ""}
                      </span>
                    </td>
                    <td>
                      {timetable ? (
                        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.8125rem", color: "var(--color-text)" }}>
                          {timetable.exam_date}
                        </div>
                      ) : (
                        <span style={{ color: "var(--color-muted)", fontSize: "0.75rem", fontStyle: "italic" }}>
                          Not scheduled
                        </span>
                      )}
                    </td>
                    <td>
                      {timetable ? (
                        <div>
                          <div className={styles.timeWindow}>
                            {timetable.start_time} – {timetable.end_time}
                          </div>
                          <div className={styles.durationTag}>
                            <ClockIcon width="11" height="11" /> {timetable.duration} min · {timetable.exam_mode}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {timetable ? (
                        <span className={`${styles.statusPill} ${timetable.allow_students ? styles.statusAllowed : styles.statusLocked}`}>
                          {timetable.allow_students ? "Open" : "Locked"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className={styles.actionBtnGroup}>
                        {timetable ? (
                          <>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => openSchedule(subject, timetable)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={styles.actionBtnDanger}
                              onClick={() => setDeleting(timetable)}
                            >
                              Unschedule
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => openSchedule(subject)}
                          >
                            Schedule
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODAL: SCHEDULE EXAM ─────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Timetable Slot" : "Schedule Exam Window"}
        size="md"
      >
        <form onSubmit={submit} className={styles.formGrid}>
          <div className={styles.formGrid2}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Target Class</label>
              <select
                className={styles.formSelect}
                value={form.class}
                onChange={(e) => setForm({ ...form, class: e.target.value })}
              >
                <option value="">Select a class…</option>
                {gradeLevels.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Section / Arm (Optional)</label>
              <input
                className={styles.formInput}
                placeholder="e.g. Gold, Diamond"
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.formGrid2}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Invigilating Faculty *</label>
              <select
                className={styles.formSelect}
                value={form.teacher_id}
                onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
                required
              >
                <option value="">Select a teacher…</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Testing Mode *</label>
              <select
                className={styles.formSelect}
                value={form.exam_mode}
                onChange={(e) => setForm({ ...form, exam_mode: e.target.value })}
                required
              >
                <option value="CBT">CBT (Computer Based Test)</option>
                <option value="Offline">Offline Written Exam</option>
                <option value="Assignment">Take-Home Assignment</option>
              </select>
            </div>
          </div>

          <div className={styles.formGrid3}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Exam Date *</label>
              <input
                className={styles.formInput}
                type="date"
                value={form.exam_date}
                onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Start Time *</label>
              <input
                className={styles.formInput}
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>End Time *</label>
              <input
                className={styles.formInput}
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                required
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Time Limit / Duration (Minutes) *</label>
            <input
              className={styles.formInput}
              type="number"
              min={1}
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value })}
              required
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", paddingTop: "0.5rem" }}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={form.allow_students}
                onChange={(e) => setForm({ ...form, allow_students: e.target.checked })}
              />
              Allow Candidates to Access & Start Exam
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={form.can_retake}
                onChange={(e) => setForm({ ...form, can_retake: e.target.checked })}
              />
              Allow Candidate Retakes / Resits
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "1rem", borderTop: "1px solid var(--color-border)", marginTop: "0.5rem" }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              {editing ? "Save Schedule" : "Confirm Schedule"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL: DELETE / UNSCHEDULE ───────────────────────── */}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Unschedule Exam"
        size="sm"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text)", margin: 0 }}>
            Remove the timetable slot for <strong>{deleting?.subject_name}</strong>? Students will no longer see this scheduled exam time.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => deleting && remove(deleting)}>
              Remove Schedule
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
