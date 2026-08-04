"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then(mod => mod.Modal), { ssr: false });
import { CalendarIcon, ClockIcon, EditIcon, CheckCircleIcon, WarningIcon, PlusIcon, TrashIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Toast = { type: "success" | "error"; text: string } | null;
type Subject = {
  id: number; name: string; code: string; term: string;
  teacher_id: number; can_retake?: number; mode?: string;
};
type Timetable = {
  id: number; subject_id: number; subject_name: string; subject_code: string;
  class: string | null; section: string | null;
  exam_date: string; start_time: string; end_time: string;
  duration: number; exam_mode: string; allow_students: number;
};
type User = { id: number; name: string; email: string; role: string; is_active: number };

export default function OperatorTimetablePage() {
  return (
    <RequireRole role="operator">
      <TimetableContent />
    </RequireRole>
  );
}

const emptyForm = {
  subject_id: "",
  class: "",
  section: "",
  exam_date: "",
  start_time: "",
  end_time: "",
  duration: "60",
  exam_mode: "CBT",
  allow_students: false,
  teacher_id: "",
  can_retake: true,
  schedule_status: "scheduled",
  subject_mode: "exam"
};

function TimetableContent() {
  const [subjects,  setSubjects]  = useState<Subject[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [gradeLevels, setGradeLevels] = useState<any[]>([]);
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState<Toast>(null);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [editing,   setEditing]   = useState<Timetable | null>(null);
  const [deleting,  setDeleting]  = useState<Timetable | null>(null);
  const [search,    setSearch]    = useState("");
  const [saving,    setSaving]    = useState(false);

  const [form, setForm] = useState(emptyForm);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [s, t, u, g] = await Promise.all([
        api.getSubjects(selectedSession?.id, selectedTerm?.id),
        api.getTimetables(),
        api.getUsers(),
        api.getGradeLevels()
      ]);
      setSubjects((s as Subject[]) ?? []);
      setTimetables((t as Timetable[]) ?? []);
      setUsers((u as User[]) ?? []);
      setGradeLevels((g as any)?.grades ?? []);
    } catch {
      showToast("error", "Failed to load timetable data.");
    } finally {
      setLoading(false);
    }
  }, [showToast, selectedSession?.id, selectedTerm?.id]);

  useEffect(() => { load(); }, [load]);

  const teachers = useMemo(() => users.filter((u) => u.role === "teacher" && u.is_active), [users]);

  const filteredSubjects = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return subjects;
    return subjects.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [subjects, search]);

  const openSchedule = (subject: Subject, existingTimetable?: Timetable) => {
    setEditing(existingTimetable || null);
    if (existingTimetable) {
      setForm({
        subject_id: String(subject.id),
        class: existingTimetable.class || "",
        section: existingTimetable.section || "",
        exam_date: existingTimetable.exam_date,
        start_time: existingTimetable.start_time,
        end_time: existingTimetable.end_time,
        duration: String(existingTimetable.duration),
        exam_mode: existingTimetable.exam_mode,
        allow_students: existingTimetable.allow_students === 1,
        teacher_id: String(subject.teacher_id || ""),
        can_retake: subject.can_retake !== 0,
        schedule_status: "scheduled",
        subject_mode: subject.mode || "exam",
      });
    } else {
      setForm({
        ...emptyForm,
        subject_id: String(subject.id),
        teacher_id: String(subject.teacher_id || ""),
        can_retake: subject.can_retake !== 0,
        schedule_status: "unscheduled",
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
        subject_mode: form.subject_mode
      };
      
      if (editing) {
        await api.updateTimetable(editing.id, payload);
        showToast("success", "Timetable updated.");
      } else {
        await api.createTimetable(payload);
        showToast("success", "Timetable created.");
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: Timetable) => {
    try {
      await api.deleteTimetable(t.id);
      showToast("success", "Timetable deleted.");
      setDeleting(null);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Delete failed.");
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;

  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      <div className="pageHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="pageTitle">Exam Timetable</h1>
      </div>

      <div className={`searchBar ${styles.search}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input placeholder="Search subjects to schedule…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tblHeader}>
          <span className={styles.tblTitle}>Timetable Schedule</span>
          <span className={styles.tblCount}>{filteredSubjects.length} subjects</span>
        </div>

        {filteredSubjects.length === 0 ? (
          <div className={styles.empty}>
            <CalendarIcon width="48" height="48" />
            <p>{search ? "No subjects match your search." : "No subjects available."}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Schedule</th>
                  <th>Time Window</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubjects.map((s) => {
                  const t = timetables.find(tt => tt.subject_id === s.id);
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className={styles.subjectName}>{s.name}</div>
                        <div className={styles.subjectDesc}><code>{s.code}</code></div>
                      </td>
                      <td className={styles.dateCell}>
                        {t ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <CalendarIcon width="14" height="14" />
                            {t.exam_date}
                          </div>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>Unscheduled</span>
                        )}
                      </td>
                      <td>
                        {t ? (
                          <>
                            {t.start_time} - {t.end_time}
                            <span className={styles.durationCell} style={{ display: "block", marginTop: "4px" }}>
                              <ClockIcon width="12" height="12" /> {t.duration} min | {t.exam_mode}
                            </span>
                          </>
                        ) : "—"}
                      </td>
                      <td>
                        {t ? (
                          <span className={`badge ${t.allow_students ? "badge-success" : "badge-muted"}`}>
                            {t.allow_students ? "Allowed" : "Locked"}
                          </span>
                        ) : "—"}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {t ? (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => openSchedule(s, t)} title="Edit Schedule">
                                <EditIcon width="13" height="13" /> Edit
                              </button>
                              <button className="btn btn-sm" style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger-border)" }} onClick={() => setDeleting(t)}>
                                <TrashIcon width="13" height="13" />
                              </button>
                            </>
                          ) : (
                            <button className="btn btn-primary btn-sm" onClick={() => openSchedule(s)}>
                              <PlusIcon width="13" height="13" /> Schedule
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <h2>{editing ? "Edit Timetable" : "Create Timetable"}</h2>
        <form onSubmit={submit} className={styles.form}>
          <div className="field">
            <label>Subject *</label>
            <select className="select" value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} required disabled>
              <option value="">-- Select a subject --</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </div>

          <div className="field">
            <label>Assign Teacher *</label>
            {teachers.length === 0 ? (
              <div className={styles.noTeacher}><WarningIcon width="16" height="16" /> No active teachers found.</div>
            ) : (
              <select className="select" value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} required>
                <option value="">— Select a teacher —</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          
          <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="field">
              <label>Class</label>
              <select className="select" value={form.class} onChange={(e) => setForm({ ...form, class: e.target.value })}>
                <option value="">Select a class...</option>
                {gradeLevels.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Section</label>
              <input className="input" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} />
            </div>
          </div>
          
          <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="field">
              <label>Schedule Status</label>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", textTransform: "none", fontWeight: 500 }}>
                  <input type="radio" name="schedule_status" value="scheduled" checked={form.schedule_status === "scheduled"} onChange={() => setForm({ ...form, schedule_status: "scheduled" })} /> Scheduled
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", textTransform: "none", fontWeight: 500 }}>
                  <input type="radio" name="schedule_status" value="unscheduled" checked={form.schedule_status === "unscheduled"} onChange={() => setForm({ ...form, schedule_status: "unscheduled" })} /> Unscheduled
                </label>
              </div>
            </div>
            <div className="field">
              <label>Assessment Mode *</label>
              <select className="select" value={form.subject_mode} onChange={(e) => setForm({ ...form, subject_mode: e.target.value })}>
                <option value="exam">Exam</option>
                <option value="test">Test</option>
                <option value="quiz">Quiz</option>
              </select>
            </div>
          </div>
          
          {form.schedule_status === "scheduled" && (
            <>
              <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div className="field">
                  <label>Exam Date *</label>
                  <input className="input" type="date" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Exam Mode *</label>
                  <select className="select" value={form.exam_mode} onChange={(e) => setForm({ ...form, exam_mode: e.target.value })} required>
                    <option value="CBT">CBT</option>
                    <option value="Assignment">Assignment</option>
                    <option value="Offline">Offline</option>
                  </select>
                </div>
              </div>

              <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
                <div className="field">
                  <label>Start Time *</label>
                  <input className="input" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
                </div>
                <div className="field">
                  <label>End Time *</label>
                  <input className="input" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Duration (min) *</label>
                  <input className="input" type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} required />
                </div>
              </div>
              
              <div className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
                <input type="checkbox" id="allow_students" checked={form.allow_students} onChange={(e) => setForm({ ...form, allow_students: e.target.checked })} style={{ width: "1.25rem", height: "1.25rem", cursor: "pointer" }} />
                <label htmlFor="allow_students" style={{ textTransform: "none", fontWeight: 500, margin: 0, cursor: "pointer" }}>Allow Students to Take Exam</label>
              </div>
            </>
          )}
          <div className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input type="checkbox" id="can_retake" checked={form.can_retake} onChange={(e) => setForm({ ...form, can_retake: e.target.checked })} style={{ width: "1.25rem", height: "1.25rem", cursor: "pointer" }} />
            <label htmlFor="can_retake" style={{ textTransform: "none", fontWeight: 500, margin: 0, cursor: "pointer" }}>Allow Students to Retake Exam</label>
          </div>
          
          <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Timetable"}</button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} size="sm">
        <h2>Delete Timetable?</h2>
        <p className="modal-desc">This will permanently delete the timetable for <strong>{deleting?.subject_name}</strong>.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => deleting && remove(deleting)}>Delete</button>
        </div>
      </Modal>
    </>
  );
}
