"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then(mod => mod.Modal), { ssr: false });
import { CalendarIcon, ClockIcon, EditIcon, CheckCircleIcon, WarningIcon, PlusIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Toast = { type: "success" | "error"; text: string } | null;
type Subject = {
  id: number; name: string; code: string; term: string;
  duration: number; total_score: number; exam_datetime: string;
  is_published: number; teacher_id: number; created_at: string;
  description?: string; class?: string; grade_level_id?: number; session?: string; mode?: string;
  is_timetable_published?: number; window_duration?: number;
};
type User = { id: number; name: string; email: string; role: string; grade?: string; is_active: number };

export default function OperatorTimetablePage() {
  return (
    <RequireRole role="operator">
      <TimetableContent />
    </RequireRole>
  );
}

function TimetableContent() {
  const [subjects,  setSubjects]  = useState<Subject[]>([]);
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState<Toast>(null);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editing,   setEditing]   = useState<Subject | null>(null);
  const [search,    setSearch]    = useState("");
  const [saving,    setSaving]    = useState(false);
  const [teachers,  setTeachers]  = useState<User[]>([]);

  const [gradeLevels, setGradeLevels] = useState<any[]>([]);

  // Create Form State
  const [form, setForm] = useState({
    name: "", code: "", term: "", duration: "60", window_duration: "120", exam_datetime: "", teacher_id: "", grade_level_id: "", session: "", mode: "exam"
  });

  const [examDate, setExamDate] = useState("");
  const [duration, setDuration] = useState("");
  const [windowDuration, setWindowDuration] = useState("120");
  const [isPublished, setIsPublished] = useState(false);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [s, u, g] = await Promise.all([api.getSubjects(selectedSession?.id, selectedTerm?.id), api.getUsers(), api.getGradeLevels()]);
      setSubjects((s as Subject[]) ?? []);
      setTeachers(((u as User[]) ?? []).filter(user => user.role === "teacher" && user.is_active));
      setGradeLevels((g as any)?.grades ?? []);
    } catch {
      showToast("error", "Failed to load subjects.");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load, selectedSession?.id, selectedTerm?.id]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let res = subjects;
    if (q) {
      res = res.filter(
        (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.term.toLowerCase().includes(q),
      );
    }
    // Sort by exam_datetime, nulls last
    res.sort((a, b) => {
      if (!a.exam_datetime && !b.exam_datetime) return 0;
      if (!a.exam_datetime) return 1;
      if (!b.exam_datetime) return -1;
      return new Date(a.exam_datetime).getTime() - new Date(b.exam_datetime).getTime();
    });
    return res;
  }, [subjects, search]);

  const openEdit = (s: Subject) => {
    setEditing(s);
    setExamDate(s.exam_datetime ?? "");
    setDuration(String(s.duration));
    setWindowDuration(String(s.window_duration ?? 120));
    setIsPublished(!!s.is_timetable_published);
    setModalOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!examDate || !duration) {
      showToast("error", "Please complete all required fields.");
      return;
    }
    setSaving(true);
    try {
      await api.updateSubject(editing.id, {
        exam_datetime: examDate,
        duration: Number(duration),
        window_duration: Number(windowDuration),
        is_timetable_published: isPublished ? 1 : 0,
      });
      showToast("success", `Timetable updated for "${editing.name}".`);
      setModalOpen(false);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };
  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code || !form.term || !form.duration || !form.exam_datetime || !form.teacher_id) {
      showToast("error", "Please complete all required fields.");
      return;
    }
    setSaving(true);
    try {
      await api.createSubject({
        name: form.name, code: form.code, term: form.term,
        duration: Number(form.duration), window_duration: Number(form.window_duration), exam_datetime: form.exam_datetime,
        teacher_id: Number(form.teacher_id), grade_level_id: form.grade_level_id ? Number(form.grade_level_id) : null,
        session: form.session || null, mode: form.mode || "exam",
        session_id: selectedSession?.id, term_id: selectedTerm?.id
      });
      showToast("success", `Subject "${form.name}" created and scheduled.`);
      setCreateModalOpen(false);
      setForm({ name: "", code: "", term: "", duration: "60", window_duration: "120", exam_datetime: "", teacher_id: "", grade_level_id: "", session: "", mode: "exam" });
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Create failed.");
    } finally {
      setSaving(false);
    }
  };
  const togglePublish = async (s: Subject) => {
    try {
      await api.updateSubject(s.id, { is_timetable_published: s.is_timetable_published ? 0 : 1 });
      showToast("success", s.is_timetable_published ? `"${s.name}" unpublished.` : `"${s.name}" published.`);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Toggle failed.");
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;

  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      <div className="pageHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="pageTitle">Exam Timetable</h1>
        <button className="btn btn-primary btn-sm inline" onClick={() => setCreateModalOpen(true)}>
          <PlusIcon width="15" height="15" /> Create Timetable
        </button>
      </div>

      <div className={`searchBar ${styles.search}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input placeholder="Search subjects…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tblHeader}>
          <span className={styles.tblTitle}>Timetable Schedule</span>
          <span className={styles.tblCount}>{filtered.length} scheduled</span>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <CalendarIcon width="48" height="48" />
            <p>{search ? "No subjects match your search." : "No subjects available for scheduling."}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Code</th>
                  <th>Exam Date & Time</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const hasDate = !!s.exam_datetime;
                  const dateObj = hasDate ? new Date(s.exam_datetime) : null;
                  const isPast = dateObj && dateObj.getTime() + s.duration * 60000 < Date.now();
                  
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className={styles.subjectName}>{s.name}</div>
                        <div className={styles.subjectDesc}>{s.term} {s.class ? `· ${s.class}` : ""}</div>
                      </td>
                      <td><code className={styles.code}>{s.code}</code></td>
                      <td className={styles.dateCell}>
                        {dateObj ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: isPast ? "var(--color-muted)" : "var(--color-text)" }}>
                            <CalendarIcon width="14" height="14" />
                            {dateObj.toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        ) : (
                          <span style={{ color: "var(--color-warning)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                            <WarningIcon width="14" height="14" /> Unscheduled
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={styles.durationCell}>
                          <ClockIcon width="14" height="14" />
                          {s.duration} min
                        </span>
                      </td>
                      <td>
                        <div className={styles.statusCell}>
                          <span className={s.is_timetable_published ? styles.statusDotPublished : styles.statusDotDraft} style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block" }} />
                          <span className={`badge ${s.is_timetable_published ? "badge-success" : "badge-muted"}`}>
                            {s.is_timetable_published ? "Published" : "Draft"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.actions}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)} title="Schedule">
                            <EditIcon width="13" height="13" /> Schedule
                          </button>
                          <button className={`btn btn-sm ${s.is_timetable_published ? styles.unpublishBtn : styles.publishBtn}`} onClick={() => togglePublish(s)}>
                            {s.is_timetable_published ? "Unpublish" : "Publish"}
                          </button>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="sm">
        <h2>Schedule Exam</h2>
        {editing && <p className="modal-desc" style={{ marginBottom: "1rem" }}>{editing.name} ({editing.code})</p>}
        <form onSubmit={submit} className={styles.form}>
          <div className="field">
            <label>Exam Date & Time *</label>
            <input className="input" type="datetime-local" value={examDate} onChange={(e) => setExamDate(e.target.value)} required />
          </div>
          <div className="field">
            <label>Session Duration (minutes) *</label>
            <input className="input" type="number" min={1} max={360} value={duration} onChange={(e) => setDuration(e.target.value)} required />
          </div>
          <div className="field">
            <label>Overall Time Window (minutes) *</label>
            <input className="input" type="number" min={1} max={1440} value={windowDuration} onChange={(e) => setWindowDuration(e.target.value)} required />
          </div>
          <div className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
            <input type="checkbox" id="publish-toggle" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
            <label htmlFor="publish-toggle" style={{ margin: 0, cursor: "pointer" }}>Publish instantly</label>
          </div>
        </form>
      </Modal>

      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} size="md">
        <h2>Create Timetable Subject</h2>
        <p className="modal-desc">Create a new subject and schedule its exam instantly.</p>
        <form onSubmit={submitCreate} className={styles.form}>
          <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="field">
              <label>Subject Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Subject Code *</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </div>
          </div>
          
          <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div className="field">
              <label>Term *</label>
              <input className="input" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} required />
            </div>
            <div className="field">
              <label>Class</label>
              <select className="select" value={form.grade_level_id} onChange={(e) => setForm({ ...form, grade_level_id: e.target.value })}>
                <option value="">Select a class...</option>
                {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Session</label>
              <input className="input" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} />
            </div>
          </div>
          
          <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div className="field">
              <label>Exam Date & Time *</label>
              <input className="input" type="datetime-local" value={form.exam_datetime} onChange={(e) => setForm({ ...form, exam_datetime: e.target.value })} required />
            </div>
            <div className="field">
              <label>Session (min) *</label>
              <input className="input" type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} required />
            </div>
            <div className="field">
              <label>Window (min) *</label>
              <input className="input" type="number" min={1} value={form.window_duration} onChange={(e) => setForm({ ...form, window_duration: e.target.value })} required />
            </div>
          </div>
          
          <div className="field">
            <label>Assign Teacher *</label>
            <select className="select" value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} required>
              <option value="">-- Select a teacher --</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
            </select>
          </div>
          
          <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setCreateModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Create & Schedule"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
