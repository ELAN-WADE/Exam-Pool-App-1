"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then((mod) => mod.Modal), { ssr: false });
import {
  PageHeader,
  Drawer,
  Button,
} from "../../../components/ui";
import {
  PlusIcon,
  UsersIcon,
  BookIcon,
  SearchIcon,
  CalendarIcon,
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
  total_score: number;
  teacher_id: number;
  created_at: string;
  description?: string;
  class?: string;
  grade_level_id?: number;
  session?: string;
  is_published?: number;
  can_retake?: number;
  mode?: "test" | "exam" | "quiz";
  assessment_type?: string;
  result_policy?: string;
  result_release_time?: string | null;
  enrolled_count?: number;
};

type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  grade?: string;
  is_active: number;
};

type EnrolledStudent = {
  id: number;
  student_user_id?: number;
  name: string;
  email: string;
  grade?: string;
  reg_id?: string;
  enrolled_at: string;
  score?: number;
  total_score?: number;
  exam_status?: string;
};

const emptyForm = {
  name: "",
  code: "",
  term: "",
  description: "",
  class: "",
  grade_level_id: "",
  session: "",
  mode: "exam" as "test" | "exam" | "quiz",
  assessment_type: "school_exam",
  result_policy: "immediate" as "immediate" | "manual" | "scheduled",
  result_release_time: "",
  teacher_id: "",
};

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
  const [users, setUsers] = useState<User[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);
  const [gradeLevels, setGradeLevels] = useState<{ id: number; name: string }[]>([]);

  // Modals & Drawers
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState<Subject | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [publishFilter, setPublishFilter] = useState("all");

  // Enrollment Drawer State
  const [enrollSubject, setEnrollSubject] = useState<Subject | null>(null);
  const [enrolled, setEnrolled] = useState<EnrolledStudent[]>([]);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState("");
  const [enrollStudentId, setEnrollStudentId] = useState("");
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Assign Class Teacher Modal
  const [assignTeacherModal, setAssignTeacherModal] = useState(false);
  const [assignTeacherForm, setAssignTeacherForm] = useState({ teacher_id: "", class_id: "" });
  const [assignTeacherSaving, setAssignTeacherSaving] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      const [s, u, gl, c] = await Promise.all([
        api.getSubjects(selectedSession?.id, selectedTerm?.id),
        api.getUsers(),
        api.getGradeLevels(),
        api.getClasses(),
      ]);
      if (signal?.aborted) return;
      const allUsers = (u as User[]) ?? [];
      setSubjects((s as Subject[]) ?? []);
      setUsers(allUsers);
      setStudents(allUsers.filter((user) => user.role === "student" && user.is_active));
      setGradeLevels(gl?.grades ?? []);
      setClasses(Array.isArray(c) ? c : []);
    } catch {
      if (!signal?.aborted) showToast("error", "Failed to load subjects data.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [showToast, selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const teachers = useMemo(() => users.filter((u) => u.role === "teacher" && u.is_active), [users]);

  const teacherMap = useMemo(() => {
    const m: Record<number, string> = {};
    for (const t of users) m[t.id] = t.name;
    return m;
  }, [users]);

  // Filtered Subject List
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.term && s.term.toLowerCase().includes(q)) ||
        (s.class && s.class.toLowerCase().includes(q));

      const matchMode = modeFilter === "all" || (s.mode || "exam") === modeFilter;
      const matchGrade = gradeFilter === "all" || s.class === gradeFilter;
      const matchPublish =
        publishFilter === "all" ||
        (publishFilter === "published" && Boolean(s.is_published)) ||
        (publishFilter === "draft" && !s.is_published);

      return matchSearch && matchMode && matchGrade && matchPublish;
    });
  }, [subjects, search, modeFilter, gradeFilter, publishFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = subjects.length;
    const published = subjects.filter((s) => Number(s.is_published) === 1).length;
    const exams = subjects.filter((s) => (s.mode || "exam") === "exam").length;
    const teachersAssigned = new Set(subjects.map((s) => s.teacher_id).filter(Boolean)).size;
    return { total, published, exams, teachersAssigned };
  }, [subjects]);

  // Toggle Subject Publish Status
  const togglePublish = async (s: Subject) => {
    const nextState = Number(s.is_published) === 1 ? 0 : 1;
    try {
      await api.togglePublish(s.id, Boolean(nextState));
      showToast("success", `"${s.name}" is now ${nextState ? "Published" : "Draft"}.`);
      setSubjects((prev) => prev.map((item) => (item.id === s.id ? { ...item, is_published: nextState } : item)));
    } catch {
      showToast("error", "Failed to update publish state.");
    }
  };

  // Create / Edit
  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      term: selectedTerm?.name || "",
      session: selectedSession?.name || "",
    });
    setModalOpen(true);
  };

  const openEdit = (s: Subject) => {
    setEditing(s);
    setForm({
      name: s.name,
      code: s.code,
      term: s.term,
      description: s.description ?? "",
      class: s.class ?? "",
      grade_level_id: s.grade_level_id ? String(s.grade_level_id) : (s.class ? String(gradeLevels.find((gl) => gl.name === s.class)?.id || "") : ""),
      session: s.session ?? "",
      mode: s.mode ?? "exam",
      assessment_type: s.assessment_type || (s.mode === "exam" ? "school_exam" : s.mode === "test" ? "school_test" : "learning_practice"),
      result_policy: (s.result_policy as any) || "immediate",
      result_release_time: s.result_release_time ? new Date(s.result_release_time).toISOString().slice(0, 16) : "",
      teacher_id: String(s.teacher_id ?? ""),
    });
    setModalOpen(true);
  };

  const handleSaveSubject = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code || !form.term || !form.teacher_id) {
      showToast("error", "Please fill in all required fields (Name, Code, Term, Teacher).");
      return;
    }
    setSaving(true);
    try {
      const selectedGl = gradeLevels.find(
        (gl) => String(gl.id) === String(form.grade_level_id) || gl.name === form.class
      );
      const payload = {
        name: form.name,
        code: form.code,
        term: form.term,
        description: form.description || null,
        class: selectedGl ? selectedGl.name : form.class || null,
        grade_level_id: selectedGl ? selectedGl.id : (Number(form.grade_level_id) || null),
        session: form.session || null,
        mode: form.mode,
        assessment_type: form.assessment_type,
        result_policy: form.result_policy,
        result_release_time: form.result_policy === "scheduled" && form.result_release_time ? new Date(form.result_release_time).toISOString() : null,
        teacher_id: Number(form.teacher_id),
        session_id: selectedSession?.id,
        term_id: selectedTerm?.id,
      };

      if (editing) {
        await api.updateSubject(editing.id, payload);
        showToast("success", `Subject "${form.name}" updated successfully.`);
      } else {
        await api.createSubject(payload);
        showToast("success", `Subject "${form.name}" created successfully.`);
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save subject.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubject = async () => {
    if (!deleting) return;
    try {
      await api.deleteSubject(deleting.id);
      showToast("success", `Subject "${deleting.name}" deleted.`);
      setDeleting(null);
      await loadData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete subject.");
    }
  };

  // Enrollment Drawer Operations
  const openEnrollDrawer = async (s: Subject) => {
    setEnrollSubject(s);
    setEnrollSearch("");
    setEnrollStudentId("");
    setEnrollLoading(true);
    try {
      const data = (await api.getSubjectStudents(s.id)) as EnrolledStudent[];
      setEnrolled(data ?? []);
    } catch {
      showToast("error", "Failed to load candidate roster.");
    } finally {
      setEnrollLoading(false);
    }
  };

  const handleEnrollSingle = async () => {
    if (!enrollSubject || !enrollStudentId) return;
    setEnrollSaving(true);
    try {
      await api.enrollStudent(enrollSubject.id, Number(enrollStudentId));
      showToast("success", "Student enrolled in subject.");
      setEnrollStudentId("");
      const data = (await api.getSubjectStudents(enrollSubject.id)) as EnrolledStudent[];
      setEnrolled(data ?? []);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Enrollment failed.");
    } finally {
      setEnrollSaving(false);
    }
  };

  const handleBulkEnroll = async (gradeName: string) => {
    if (!enrollSubject || !gradeName) return;
    setBulkSaving(true);
    try {
      await api.bulkEnrollByGrade(enrollSubject.id, gradeName);
      showToast("success", `All students in ${gradeName} enrolled.`);
      const data = (await api.getSubjectStudents(enrollSubject.id)) as EnrolledStudent[];
      setEnrolled(data ?? []);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Bulk enrollment failed.");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleUnenroll = async (studentId: number) => {
    if (!enrollSubject) return;
    try {
      await api.unenrollStudent(enrollSubject.id, studentId);
      showToast("success", "Student removed from roster.");
      setEnrolled((prev) => prev.filter((st) => st.id !== studentId && (st as any).student_user_id !== studentId));
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to unenroll student.");
    }
  };

  // Assign Class Teacher
  const handleAssignClassTeacher = async (e: FormEvent) => {
    e.preventDefault();
    if (!assignTeacherForm.teacher_id || !assignTeacherForm.class_id) {
      showToast("error", "Please select both a class and a teacher.");
      return;
    }
    setAssignTeacherSaving(true);
    try {
      await api.assignClassTeacher(
        Number(assignTeacherForm.class_id),
        Number(assignTeacherForm.teacher_id),
        "Assigned from Subjects page"
      );
      showToast("success", "Class Teacher assigned successfully.");
      setAssignTeacherModal(false);
      const cData = await api.getClasses();
      setClasses(Array.isArray(cData) ? cData : []);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to assign class teacher.");
    } finally {
      setAssignTeacherSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      {toast && <div className={styles.toast}>{toast.text}</div>}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        title="Subjects & Curricula"
        subtitle="Manage academic courses, examination assessments, and candidate enrollments."
        eyebrow="Academic Management"
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<UsersIcon width="13" height="13" />}
              onClick={() => {
                setAssignTeacherForm({ teacher_id: "", class_id: "" });
                setAssignTeacherModal(true);
              }}
            >
              Assign Class Teacher
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<PlusIcon width="13" height="13" />}
              onClick={openCreate}
            >
              New Subject
            </Button>
          </div>
        }
      />

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Configured Subjects</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.total}</div>
            <div className={styles.statFootnote}>Academic courses</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Published & Active</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.published}</div>
            <div className={styles.statFootnote}>Available for exams</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Examination Modes</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><CalendarIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.exams}</div>
            <div className={styles.statFootnote}>Official CBT exams</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Faculty Appointed</span>
            <div className={styles.statIcon} style={{ color: "#8B5CF6" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.teachersAssigned}</div>
            <div className={styles.statFootnote}>Assigned instructors</div>
          </div>
        </div>
      </section>

      {/* ── Filter Strip ─────────────────────────────────────── */}
      <div className={styles.filterStrip}>
        <div className={styles.searchBox}>
          <SearchIcon width="14" height="14" className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by subject name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            className={styles.selectFilter}
          >
            <option value="all">All Assessment Modes</option>
            <option value="exam">Official Examinations</option>
            <option value="test">Continuous Assessment (CA)</option>
            <option value="quiz">Classroom Quizzes</option>
          </select>

          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className={styles.selectFilter}
          >
            <option value="all">All Cohorts / Grades</option>
            {gradeLevels.map((gl) => (
              <option key={gl.id} value={gl.name}>{gl.name}</option>
            ))}
          </select>

          <select
            value={publishFilter}
            onChange={(e) => setPublishFilter(e.target.value)}
            className={styles.selectFilter}
          >
            <option value="all">All Statuses</option>
            <option value="published">Published Only</option>
            <option value="draft">Drafts Only</option>
          </select>
        </div>
      </div>

      {/* ── Structured Directory Table ───────────────────────── */}
      <div className={styles.tableCard}>
        <div className={styles.tableWrapper}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Subject / Assessment</th>
                <th>Code</th>
                <th>Mode</th>
                <th>Class / Cohort</th>
                <th>Assigned Teacher</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                    Loading subjects…
                  </td>
                </tr>
              ) : filteredSubjects.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                    No subjects found matching the filter.
                  </td>
                </tr>
              ) : (
                filteredSubjects.map((s) => {
                  const isPub = Number(s.is_published) === 1;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className={styles.subjectTitle}>{s.name}</div>
                        {s.description && (
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.1rem" }}>
                            {s.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={styles.codeBadge}>{s.code}</span>
                      </td>
                      <td>
                        <span className={styles.typeTag}>{(s.mode || "exam").toUpperCase()}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "0.8125rem" }}>{s.class || "All Cohorts"}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "0.8125rem", color: teacherMap[s.teacher_id] ? "inherit" : "var(--color-muted)" }}>
                          {teacherMap[s.teacher_id] || "Unassigned"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => togglePublish(s)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                          title={`Click to switch to ${isPub ? "Draft" : "Published"}`}
                        >
                          <span className={`${styles.statusTag} ${isPub ? styles.statusPublished : styles.statusDraft}`}>
                            {isPub ? "Published" : "Draft"}
                          </span>
                        </button>
                      </td>
                      <td>
                        <div className={styles.actionBtnGroup}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => openEnrollDrawer(s)}
                          >
                            Roster
                          </button>
                          <Link href="/ADMIN/timetable" className={styles.actionBtnSecondary}>
                            Schedule
                          </Link>
                          <button
                            type="button"
                            className={styles.actionBtnSecondary}
                            onClick={() => openEdit(s)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={styles.actionBtnDanger}
                            onClick={() => setDeleting(s)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODAL: CREATE / EDIT SUBJECT ─────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Subject: ${editing.name}` : "Create New Subject"}
        size="md"
      >
        <form onSubmit={handleSaveSubject} className={styles.formGrid}>
          <div className={styles.formGrid2}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Subject Name <span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                required
                className={styles.formInput}
                placeholder="e.g. Mathematics"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Subject Code <span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                required
                className={styles.formInput}
                placeholder="e.g. MTH101"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </div>
          </div>

          <div className={styles.formGrid2}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Assessment Architecture <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.formSelect}
                value={form.assessment_type}
                onChange={(e) => {
                  const at = e.target.value;
                  const isLearn = at.startsWith("learning");
                  setForm({
                    ...form,
                    assessment_type: at,
                    mode: at === "school_exam" ? "exam" : at === "school_test" ? "test" : "quiz",
                    result_policy: isLearn ? "immediate" : form.result_policy,
                  });
                }}
              >
                <optgroup label="Learning Mode (Self-Paced & Solution Reveals)">
                  <option value="learning_practice">Learning Mode: Practice (Immediate Feedback + 5 Reveals)</option>
                  <option value="learning_mock">Learning Mode: Mock Exam (Immediate Feedback + 5 Reveals)</option>
                </optgroup>
                <optgroup label="School Mode (Formal Evaluation & Proctored)">
                  <option value="school_test">School Mode: Continuous Assessment / Test</option>
                  <option value="school_exam">School Mode: Official Examination</option>
                </optgroup>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Assigned Teacher <span className={styles.required}>*</span>
              </label>
              <select
                required
                className={styles.formSelect}
                value={form.teacher_id}
                onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
              >
                <option value="">Select a teacher…</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.email})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* School Mode Result Policy Configuration */}
          {form.assessment_type.startsWith("school") && (
            <div className={styles.formGrid2} style={{ background: "#F8FAFC", padding: "0.85rem", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Result Release Policy <span className={styles.required}>*</span>
                </label>
                <select
                  className={styles.formSelect}
                  value={form.result_policy}
                  onChange={(e) => setForm({ ...form, result_policy: e.target.value as any })}
                >
                  <option value="immediate">Immediate (Scores visible on submit)</option>
                  <option value="manual">Manual (Held until instructor clicks Publish)</option>
                  <option value="scheduled">Scheduled (Auto-unlock at specified time)</option>
                </select>
              </div>

              {form.result_policy === "scheduled" && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    Scheduled Release Time <span className={styles.required}>*</span>
                  </label>
                  <input
                    type="datetime-local"
                    required
                    className={styles.formInput}
                    value={form.result_release_time}
                    onChange={(e) => setForm({ ...form, result_release_time: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          <div className={styles.formGrid2}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Target Class / Grade</label>
              <select
                className={styles.formSelect}
                value={form.grade_level_id}
                onChange={(e) => {
                  const glId = e.target.value;
                  const found = gradeLevels.find((g) => String(g.id) === glId);
                  setForm({
                    ...form,
                    grade_level_id: glId,
                    class: found ? found.name : "",
                  });
                }}
              >
                <option value="">All Cohorts / General</option>
                {gradeLevels.map((gl) => (
                  <option key={gl.id} value={gl.id}>
                    {gl.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Academic Term <span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                required
                className={styles.formInput}
                placeholder="e.g. First Term"
                value={form.term}
                onChange={(e) => setForm({ ...form, term: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Subject Description & Instructions</label>
            <textarea
              rows={3}
              className={styles.formTextarea}
              placeholder="Instructions for students taking this subject…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "1rem", borderTop: "1px solid var(--color-border)" }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              {editing ? "Save Changes" : "Create Subject"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL: DELETE CONFIRMATION ───────────────────────── */}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete Subject"
        size="sm"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text)", margin: 0 }}>
            Are you sure you want to delete <strong>{deleting?.name}</strong> ({deleting?.code})? This action cannot be undone.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDeleteSubject}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── DRAWER: CANDIDATE ENROLLMENT ROSTER ──────────────── */}
      <Drawer
        isOpen={Boolean(enrollSubject)}
        onClose={() => setEnrollSubject(null)}
        title={`Candidate Roster: ${enrollSubject?.name || ""}`}
        subtitle={`${enrollSubject?.code || ""} · ${enrolled.length} candidate(s)`}
        size="wide"
        footer={
          <Button variant="secondary" size="sm" onClick={() => setEnrollSubject(null)}>
            Close Roster
          </Button>
        }
      >
        <div className={styles.enrollSection}>
          <div className={styles.enrollActionBox}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text)" }}>
              Enroll Individual Candidate
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <select
                className={styles.formSelect}
                value={enrollStudentId}
                onChange={(e) => setEnrollStudentId(e.target.value)}
                style={{ flex: 1, minWidth: "200px" }}
              >
                <option value="">Select student…</option>
                {students
                  .filter((st) => !enrolled.some((e) => e.id === st.id || (e as any).student_user_id === st.id))
                  .map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} ({st.grade || "No class"}) - {st.email}
                    </option>
                  ))}
              </select>
              <Button
                variant="primary"
                size="sm"
                onClick={handleEnrollSingle}
                disabled={!enrollStudentId}
                loading={enrollSaving}
              >
                Enroll
              </Button>
            </div>

            <div style={{ paddingTop: "0.5rem", borderTop: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
                Bulk Enroll Cohort:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {gradeLevels.map((gl) => (
                  <Button
                    key={gl.id}
                    variant="secondary"
                    size="xs"
                    loading={bulkSaving}
                    onClick={() => handleBulkEnroll(gl.name)}
                  >
                    + {gl.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text)" }}>
              Enrolled Candidates ({enrolled.length})
            </span>
            <input
              type="text"
              placeholder="Filter roster…"
              value={enrollSearch}
              onChange={(e) => setEnrollSearch(e.target.value)}
              className={styles.searchInput}
              style={{ maxWidth: "200px", padding: "0.35rem 0.65rem" }}
            />
          </div>

          {enrollLoading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
              Loading roster…
            </div>
          ) : enrolled.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
              No candidates enrolled in this subject yet.
            </div>
          ) : (
            <div className={styles.enrollList}>
              {enrolled
                .filter((st) => !enrollSearch || st.name.toLowerCase().includes(enrollSearch.toLowerCase()))
                .map((st) => (
                  <div key={st.id || (st as any).student_user_id} className={styles.enrollItem}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{st.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                        {st.grade || "General"} · {st.reg_id || st.email}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnenroll(st.id || (st as any).student_user_id)}
                      className={styles.actionBtnDanger}
                    >
                      Remove
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Drawer>

      {/* ── MODAL: ASSIGN CLASS TEACHER ──────────────────────── */}
      <Modal
        open={assignTeacherModal}
        onClose={() => setAssignTeacherModal(false)}
        title="Assign Class Teacher"
        size="md"
      >
        <form onSubmit={handleAssignClassTeacher} className={styles.formGrid}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-muted)", margin: 0 }}>
            Authorize faculty member to enter marks and report card remarks for a class.
          </p>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              Class / Arm <span className={styles.required}>*</span>
            </label>
            <select
              required
              className={styles.formSelect}
              value={assignTeacherForm.class_id}
              onChange={(e) => setAssignTeacherForm({ ...assignTeacherForm, class_id: e.target.value })}
            >
              <option value="">Select a class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.class_teacher_name ? `(Current: ${c.class_teacher_name})` : "(Unassigned)"}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              Faculty Member <span className={styles.required}>*</span>
            </label>
            <select
              required
              className={styles.formSelect}
              value={assignTeacherForm.teacher_id}
              onChange={(e) => setAssignTeacherForm({ ...assignTeacherForm, teacher_id: e.target.value })}
            >
              <option value="">Select a teacher…</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.email})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "1rem", borderTop: "1px solid var(--color-border)" }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAssignTeacherModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={assignTeacherSaving}>
              Assign
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
