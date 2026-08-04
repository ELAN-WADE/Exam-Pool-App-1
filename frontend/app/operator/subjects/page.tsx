"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then(mod => mod.Modal), { ssr: false });
import { PlusIcon, EditIcon, TrashIcon, UsersIcon, BookIcon, CheckCircleIcon, WarningIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Toast = { type: "success" | "error"; text: string } | null;
type Subject = {
  id: number; name: string; code: string; term: string;
  duration: number; total_score: number; exam_datetime: string;
  is_published: number; teacher_id: number; created_at: string;
  description?: string; class?: string; grade_level_id?: number; session?: string; mode?: string;
  can_retake?: number; is_assignment?: number;
};
type User = { id: number; name: string; email: string; role: string; grade?: string; is_active: number };
type EnrolledStudent = {
  id: number; name: string; email: string; grade?: string; reg_id?: string;
  enrolled_at: string; score?: number; total_score?: number; exam_status?: string;
};

const emptyForm = { name: "", code: "", term: "", duration: "", exam_datetime: "", teacher_id: "", description: "", grade_level_id: "", session: "", mode: "exam", can_retake: true, is_assignment: false };

export default function OperatorSubjectsPage() {
  return (
    <RequireRole role="operator">
      <SubjectsContent />
    </RequireRole>
  );
}

function SubjectsContent() {
  const { selectedSession, selectedTerm } = useAcademic();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [users,     setUsers]     = useState<User[]>([]);
  const [students,  setStudents]  = useState<User[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState<Toast>(null);
  const [gradeLevels, setGradeLevels] = useState<any[]>([]);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [editing,   setEditing]   = useState<Subject | null>(null);
  const [deleting,  setDeleting]  = useState<Subject | null>(null);
  const [form,      setForm]      = useState<typeof emptyForm>(emptyForm);
  const [search,    setSearch]    = useState("");
  const [saving,    setSaving]    = useState(false);
  const [isScheduled, setIsScheduled] = useState(true);

  // Enrollment panel state
  const [enrollSubject,   setEnrollSubject]   = useState<Subject | null>(null);
  const [enrolled,        setEnrolled]        = useState<EnrolledStudent[]>([]);
  const [enrollLoading,   setEnrollLoading]   = useState(false);
  const [enrollSearch,    setEnrollSearch]    = useState("");
  const [enrollGradeFilter, setEnrollGradeFilter] = useState("");
  const [enrollSaving,    setEnrollSaving]    = useState<number | null>(null);
  const [bulkSaving,      setBulkSaving]      = useState(false);

  const [assignTeacherModal, setAssignTeacherModal] = useState(false);
  const [assignTeacherForm, setAssignTeacherForm] = useState({ teacher_id: "", class_id: "" });
  const [assignTeacherSaving, setAssignTeacherSaving] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);

  useEffect(() => {
    api.getClasses().then(data => setClasses(Array.isArray(data) ? data : [])).catch(console.error);
  }, []);

  const openAssignClassTeacher = () => {
    setAssignTeacherForm({ teacher_id: "", class_id: "" });
    setAssignTeacherModal(true);
  };

  const submitAssignClassTeacher = async (e: FormEvent) => {
    e.preventDefault();
    if (!assignTeacherForm.teacher_id || !assignTeacherForm.class_id) {
      showToast("error", "Please select both a teacher and a class.");
      return;
    }
    setAssignTeacherSaving(true);
    try {
      await api.assignClassTeacher(Number(assignTeacherForm.class_id), Number(assignTeacherForm.teacher_id), "Assigned from Operator Subjects page");
      showToast("success", "Class Teacher assigned successfully.");
      setAssignTeacherModal(false);
      // refresh classes to get updated class_teacher_name
      const data = await api.getClasses();
      setClasses(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to assign teacher.");
    } finally {
      setAssignTeacherSaving(false);
    }
  };

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      const [s, u, g] = await Promise.all([
        api.getSubjects(selectedSession?.id, selectedTerm?.id), 
        api.getUsers(),
        api.getGradeLevels()
      ]);
      if (signal?.aborted) return;
      const allUsers = (u as User[]) ?? [];
      setSubjects((s as Subject[]) ?? []);
      setUsers(allUsers);
      setStudents(allUsers.filter((user) => user.role === "student" && user.is_active));
      setGradeLevels((g as any)?.grades ?? []);
    } catch {
      if (!signal?.aborted) showToast("error", "Failed to load data.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, selectedSession?.id, selectedTerm?.id]);

  const teachers = useMemo(() => users.filter((u) => u.role === "teacher" && u.is_active), [users]);

  const teacherMap = useMemo(() => {
    const m: Record<number, string> = {};
    for (const t of users) m[t.id] = t.name;
    return m;
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return subjects;
    return subjects.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.term.toLowerCase().includes(q),
    );
  }, [subjects, search]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setIsScheduled(true); setModalOpen(true); };
  const openEdit   = (s: Subject) => {
    setEditing(s);
    setForm({
      name:          s.name,
      code:          s.code,
      term:          s.term,
      duration:      String(s.duration),
      exam_datetime: s.exam_datetime ?? "",
      teacher_id:    String(s.teacher_id),
      description:   s.description ?? "",
      grade_level_id: s.grade_level_id ? String(s.grade_level_id) : "",
      session:       s.session ?? "",
      mode:          s.mode ?? "exam",
      can_retake:    s.can_retake !== 0,
      is_assignment: s.is_assignment === 1,
    });
    setIsScheduled(!!s.exam_datetime && s.exam_datetime !== "");
    setModalOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code || !form.term || !form.duration || !form.teacher_id) {
      showToast("error", "Please complete all required fields.");
      return;
    }
    if (isScheduled && !form.exam_datetime) {
      showToast("error", "Please provide the Exam Date & Time.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name:          form.name,
        code:          form.code,
        term:          form.term,
        duration:      Number(form.duration),
        exam_datetime: isScheduled ? form.exam_datetime : "",
        teacher_id:    Number(form.teacher_id),
        description:   form.description || null,
        grade_level_id: form.grade_level_id ? Number(form.grade_level_id) : null,
        session:       form.session || null,
        mode:          form.mode || "exam",
        can_retake:    form.can_retake ? 1 : 0,
        is_assignment: form.is_assignment ? 1 : 0,
        session_id:    selectedSession?.id,
        term_id:       selectedTerm?.id,
      };
      if (editing) {
        await api.updateSubject(editing.id, payload);
        showToast("success", `Subject "${form.name}" updated.`);
      } else {
        await api.createSubject(payload);
        showToast("success", `Subject "${form.name}" created.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (s: Subject) => {
    try {
      await api.updateSubject(s.id, { is_published: s.is_published ? 0 : 1 });
      showToast("success", s.is_published ? `"${s.name}" unpublished.` : `"${s.name}" published.`);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Toggle failed.");
    }
  };

  const remove = async (s: Subject) => {
    try {
      await api.deleteSubject(s.id);
      showToast("success", `Subject "${s.name}" deleted.`);
      setDeleting(null);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Delete failed.");
    }
  };

  // ---------- Enrollment ----------
  const enrollAbortController = useRef<AbortController | null>(null);

  const openEnroll = async (s: Subject) => {
    if (enrollAbortController.current) {
      enrollAbortController.current.abort();
    }
    const controller = new AbortController();
    enrollAbortController.current = controller;

    setEnrollSubject(s);
    setEnrollSearch("");
    setEnrollGradeFilter("");
    setEnrollLoading(true);
    try {
      const data = (await api.getSubjectStudents(s.id)) as EnrolledStudent[];
      if (controller.signal.aborted) return;
      setEnrolled(data ?? []);
    } catch {
      if (!controller.signal.aborted) showToast("error", "Failed to load enrolled students.");
    } finally {
      if (!controller.signal.aborted) setEnrollLoading(false);
    }
  };

  const enrolledIds = useMemo(() => new Set(enrolled.map((e) => e.id)), [enrolled]);

  const availableStudents = useMemo(() => {
    const q = enrollSearch.toLowerCase();
    return students
      .filter((s) => s.is_active && !enrolledIds.has(s.id))
      .filter((s) =>
        (!q || s.name.toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q) || (s.grade || "").toLowerCase().includes(q)) &&
        (!enrollGradeFilter || s.grade === enrollGradeFilter),
      );
  }, [students, enrolledIds, enrollSearch, enrollGradeFilter]);

  const allGrades = useMemo(() => {
    return (gradeLevels || []).map(g => g.name);
  }, [gradeLevels]);

  const enroll = async (studentId: number) => {
    if (!enrollSubject) return;
    setEnrollSaving(studentId);
    try {
      await api.enrollStudent(enrollSubject.id, studentId);
      const data = (await api.getSubjectStudents(enrollSubject.id)) as EnrolledStudent[];
      setEnrolled(data ?? []);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Enroll failed.");
    } finally {
      setEnrollSaving(null);
    }
  };

  const unenroll = async (studentId: number) => {
    if (!enrollSubject) return;
    setEnrollSaving(studentId);
    try {
      await api.unenrollStudent(enrollSubject.id, studentId);
      const data = (await api.getSubjectStudents(enrollSubject.id)) as EnrolledStudent[];
      setEnrolled(data ?? []);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Unenroll failed.");
    } finally {
      setEnrollSaving(null);
    }
  };

  const bulkEnroll = async () => {
    if (!enrollSubject || !enrollGradeFilter) return;
    setBulkSaving(true);
    try {
      await api.bulkEnrollByGrade(enrollSubject.id, enrollGradeFilter);
      const data = (await api.getSubjectStudents(enrollSubject.id)) as EnrolledStudent[];
      setEnrolled(data ?? []);
      showToast("success", `Enrolled students from ${enrollGradeFilter}.`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Bulk enroll failed.");
    } finally {
      setBulkSaving(false);
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;

  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      <div className="pageHeader">
        <h1 className="pageTitle">Subjects</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={openAssignClassTeacher} style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1.5px solid var(--color-border)" }}>
            <UsersIcon width="16" height="16" /> Assign Class Teacher
          </button>
          <button className="btn btn-primary" onClick={openCreate}>
            <PlusIcon width="16" height="16" /> Assign Subject
          </button>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statPill}><span className={styles.statNum}>{subjects.length}</span> Total</div>
        <div className={styles.statPill}><span className={styles.statNum}>{subjects.filter((s) => s.is_published).length}</span> Published</div>
        <div className={styles.statPill}><span className={styles.statNum}>{subjects.filter((s) => !s.is_published).length}</span> Draft</div>
        <div className={styles.statPill}><span className={styles.statNum}>{teachers.length}</span> Teachers</div>
        <div className={styles.statPill}><span className={styles.statNum}>{students.length}</span> Students</div>
      </div>

      <div className={`searchBar ${styles.search}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input placeholder="Search subjects…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className={styles.tableCard}>
        {/* Table Header */}
        <div className={styles.tblHeader}>
          <span className={styles.tblTitle}>All Subjects</span>
          <span className={styles.tblCount}>{filtered.length} subject{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <BookIcon width="48" height="48" />
            <p>{search ? "No subjects match your search." : "No subjects yet. Create one to get started."}</p>
          </div>
        ) : (
          <div className={styles.tableWrap} style={{ overflowX: "auto", width: "100%" }}>
            <table className="tbl" style={{ minWidth: "1000px" }}>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Code</th>
                  <th>Term</th>
                  <th>Teacher</th>
                  <th>Duration</th>
                  <th>Exam Date</th>
                  <th>Published</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className={styles.subjectName}>{s.name}</div>
                      {s.description && <div className={styles.subjectDesc}>{s.description}</div>}
                    </td>
                    <td><code className={styles.code}>{s.code}</code></td>
                    <td style={{ fontSize: "0.875rem", fontWeight: 600 }}>{s.term}</td>
                    <td>
                      <div className={styles.teacherCell}>
                        <div className={styles.teacherAvatar}>{(teacherMap[s.teacher_id] ?? "?").charAt(0)}</div>
                        <span className={styles.teacherName}>{teacherMap[s.teacher_id] ?? <em style={{ color: "var(--color-danger)", fontSize: "0.8rem", fontStyle: "normal" }}>Unassigned</em>}</span>
                      </div>
                    </td>
                    <td>
                      <span className={styles.durationCell}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {s.duration} min
                      </span>
                    </td>
                    <td className={styles.dateCell}>
                      {s.exam_datetime
                        ? new Date(s.exam_datetime).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                        : <span style={{ color: "var(--color-muted-2)" }}>—</span>}
                    </td>
                    <td>
                      <div className={styles.statusCell}>
                        <span className={s.is_published ? styles.statusDotPublished : styles.statusDotDraft} style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block" }} />
                        <span className={`badge ${s.is_published ? "badge-success" : "badge-muted"}`}>
                          {s.is_published ? "Published" : "Draft"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEnroll(s)} title="Manage enrolled students" style={{ color: "var(--color-primary)" }}>
                          <UsersIcon width="13" height="13" /> Students
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)} title="Edit">
                          <EditIcon width="13" height="13" /> Edit
                        </button>
                        <button className={`btn btn-sm ${s.is_published ? styles.unpublishBtn : styles.publishBtn}`} onClick={() => togglePublish(s)}>
                          {s.is_published ? "Unpublish" : "Publish"}
                        </button>
                        <button className="btn btn-sm" style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger-border)" }} onClick={() => setDeleting(s)}>
                          <TrashIcon width="13" height="13" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Enrollment Modal (XL Size) ── */}
      <Modal open={!!enrollSubject} onClose={() => setEnrollSubject(null)} size="xl">
        <div className={styles.enrollHeader}>
          <div>
            <h2>Manage Students — {enrollSubject?.name}</h2>
            <p className={styles.enrollSubtext}>
              <code>{enrollSubject?.code}</code> · Term: {enrollSubject?.term}
              <span className={styles.enrollCountDivider}>·</span>
              <strong style={{ color: "var(--color-primary)" }}>{enrolled.length}</strong> enrolled
            </p>
          </div>
        </div>

        <div className={styles.enrollGrid}>
          {/* Left: Available students */}
          <div className={styles.enrollPanel}>
            <div className={styles.enrollPanelHeader}>
              <h3>Available Students <span className={styles.enrollCount}>({availableStudents.length})</span></h3>
            </div>
            <div className={styles.enrollControls}>
              <input className="input" placeholder="Search students…" value={enrollSearch} onChange={(e) => setEnrollSearch(e.target.value)} />
              <select className="select" value={enrollGradeFilter} onChange={(e) => setEnrollGradeFilter(e.target.value)}>
                <option value="">All grades</option>
                {allGrades.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" disabled={!enrollGradeFilter || bulkSaving} onClick={bulkEnroll} title={enrollGradeFilter ? `Enroll ALL ${enrollGradeFilter}` : "Select a grade"}>
                {bulkSaving ? "Enrolling…" : `Enroll All`}
              </button>
            </div>
            
            <div className={styles.enrollList}>
              {enrollLoading ? (
                <div className="loadingWrap" style={{ minHeight: 120 }}><div className="spinner" /></div>
              ) : availableStudents.length === 0 ? (
                <div className={styles.enrollEmpty}>
                  {students.length === 0 ? "No students registered yet." : "All students are already enrolled, or no match."}
                </div>
              ) : (
                availableStudents.map((stu) => (
                  <div key={stu.id} className={styles.enrollItem}>
                    <div className={styles.enrollAvatar}>{stu.name.charAt(0).toUpperCase()}</div>
                    <div className={styles.enrollInfo}>
                      <div className={styles.enrollName}>{stu.name}</div>
                      <div className={styles.enrollGrade}>{stu.grade || "No grade"}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={enrollSaving === stu.id} onClick={() => enroll(stu.id)}>
                      {enrollSaving === stu.id ? "…" : "+ Enroll"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Enrolled students */}
          <div className={styles.enrollPanel}>
            <div className={styles.enrollPanelHeader}>
              <h3>Enrolled Students <span className={styles.enrollCount}>({enrolled.length})</span></h3>
            </div>
            <div className={styles.enrollList} style={{ marginTop: "3rem" }}>
              {enrollLoading ? (
                <div className="loadingWrap" style={{ minHeight: 120 }}><div className="spinner" /></div>
              ) : enrolled.length === 0 ? (
                <div className={styles.enrollEmpty}>No students enrolled yet.</div>
              ) : (
                enrolled.map((stu) => {
                  const done  = stu.exam_status === "completed";
                  return (
                    <div key={stu.id} className={styles.enrollItem}>
                      <div className={`${styles.enrollAvatar} ${styles.enrollAvatarActive}`}>
                        <CheckCircleIcon width="16" height="16" />
                      </div>
                      <div className={styles.enrollInfo}>
                        <div className={styles.enrollName}>{stu.name}</div>
                        <div className={styles.enrollGrade}>
                          <span>{stu.grade || "No grade"}</span>
                          {done ? (
                            <span className={styles.statusComplete}>Completed</span>
                          ) : (
                            <span className={styles.statusPending}>Pending</span>
                          )}
                        </div>
                      </div>
                      <button className="btn btn-sm" style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)" }} disabled={enrollSaving === stu.id} onClick={() => unenroll(stu.id)}>
                        {enrollSaving === stu.id ? "…" : "Remove"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Create / Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <h2>{editing ? "Edit Subject" : "Create Subject"}</h2>
        <form onSubmit={submit} className={styles.form}>
          <div className={styles.formGrid}>
            <div className="field">
              <label>Subject Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mathematics" required />
            </div>
            <div className="field">
              <label>Subject Code *</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MATH101" required />
            </div>
            <div className="field">
              <label>Term *</label>
              <input className="input" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="2026-T1" required />
            </div>
            <div className="field">
              <label>Duration (minutes) *</label>
              <input className="input" type="number" min={1} max={360} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} required />
            </div>
          </div>
          <div className="field">
            <label>Scheduling Mode</label>
            <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.25rem", marginBottom: "0.5rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", textTransform: "none", fontWeight: 500 }}>
                <input type="radio" name="schedule_mode" checked={isScheduled} onChange={() => setIsScheduled(true)} />
                Scheduled Exam
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", textTransform: "none", fontWeight: 500 }}>
                <input type="radio" name="schedule_mode" checked={!isScheduled} onChange={() => setIsScheduled(false)} />
                Available Anytime
              </label>
            </div>
          </div>
          {isScheduled && (
            <div className="field">
              <label>Exam Date & Time *</label>
              <input className="input" type="datetime-local" value={form.exam_datetime} onChange={(e) => setForm({ ...form, exam_datetime: e.target.value })} required />
            </div>
          )}
          <div className={styles.formGrid}>
            <div className="field">
              <label>Class / Grade</label>
              <select className="select" value={form.grade_level_id} onChange={(e) => setForm({ ...form, grade_level_id: e.target.value })}>
                <option value="">Select a class...</option>
                {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Session</label><input className="input" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} /></div>
            <div className="field">
              <label>Mode</label>
              <select className="select" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="exam">Exam</option><option value="test">Test</option><option value="quiz">Quiz</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Description</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
            <input type="checkbox" checked={form.can_retake} onChange={(e) => setForm({ ...form, can_retake: e.target.checked })} id="canRetakeToggle" style={{ width: "1.25rem", height: "1.25rem", cursor: "pointer" }} />
            <label htmlFor="canRetakeToggle" style={{ textTransform: "none", fontWeight: 500, margin: 0, cursor: "pointer" }}>Allow Students to Retake Exam</label>
          </div>
          <div className="field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem" }}>
            <input type="checkbox" checked={form.is_assignment} onChange={(e) => setForm({ ...form, is_assignment: e.target.checked })} id="isAssignmentToggle" style={{ width: "1.25rem", height: "1.25rem", cursor: "pointer" }} />
            <label htmlFor="isAssignmentToggle" style={{ textTransform: "none", fontWeight: 500, margin: 0, cursor: "pointer" }}>Is Offline Assignment (Allow students to cache and take home)</label>
          </div>
          <div className={`field ${styles.teacherField}`}>
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
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || teachers.length === 0}>{saving ? "Saving…" : "Save Subject"}</button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} size="sm">
        <h2>Delete Subject?</h2>
        <p className="modal-desc">This will permanently delete <strong>{deleting?.name}</strong> and all questions.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => deleting && remove(deleting)}>Delete</button>
        </div>
      </Modal>

      {/* ── Assign Class Teacher Modal ── */}
      <Modal open={assignTeacherModal} onClose={() => setAssignTeacherModal(false)} size="sm">
        <h2>Assign Class Teacher</h2>
        <form onSubmit={submitAssignClassTeacher} className={styles.form}>
          <div className="field">
            <label>Select Teacher *</label>
            {teachers.length === 0 ? (
              <div className={styles.noTeacher}><WarningIcon width="16" height="16" /> No active teachers found.</div>
            ) : (
              <select className="select" value={assignTeacherForm.teacher_id} onChange={(e) => setAssignTeacherForm({ ...assignTeacherForm, teacher_id: e.target.value })} required>
                <option value="">— Select a teacher —</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <div className="field">
            <label>Select Class / Grade *</label>
            <select
              className="select"
              value={assignTeacherForm.class_id}
              onChange={(e) => setAssignTeacherForm({ ...assignTeacherForm, class_id: e.target.value })}
              required
            >
              <option value="">— Select a class —</option>
              {(() => {
                const gradeOrder = new Map(gradeLevels.map((g, idx) => [g.name, idx]));
                const seen = new Set<string>();
                return classes
                  .filter((c: any) => !c.section || c.section.trim() === "")
                  .filter((c: any) => {
                    if (seen.has(c.name)) return false;
                    seen.add(c.name);
                    return true;
                  })
                  .sort((a: any, b: any) => {
                    const idxA = gradeOrder.has(a.name) ? gradeOrder.get(a.name)! : 999;
                    const idxB = gradeOrder.has(b.name) ? gradeOrder.get(b.name)! : 999;
                    return idxA - idxB;
                  })
                  .map((c: any) => {
                    const displayName = c.name + (c.section ? ` ${c.section}` : "");
                    const currentAssignment = c.class_teacher_name ? ` (currently: ${c.class_teacher_name})` : "";
                    return (
                      <option key={c.id} value={c.id}>
                        {displayName}{currentAssignment}
                      </option>
                    );
                  });
              })()}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setAssignTeacherModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={assignTeacherSaving || teachers.length === 0}>{assignTeacherSaving ? "Saving…" : "Assign Teacher"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
