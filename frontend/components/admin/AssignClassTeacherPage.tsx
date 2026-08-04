"use client";

import React, { useEffect, useState, FormEvent, useMemo } from "react";
import { api } from "../../lib/api";
import { User } from "../../lib/types";
import { Modal } from "../ui/Modal";
import { UsersIcon, WarningIcon } from "../icons/Icons";
import styles from "./AssignClassTeacherPage.module.css";

const STANDARDIZED_GRADES = [
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SS 1", "SS 2", "SS 3",
  "100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "600 Level",
  "ND 1", "ND 2", "HND 1", "HND 2"
];

function getGradeCategory(gradeName: string): { label: string; key: "primary" | "junior" | "senior" | "higher"; badgeClass: string } {
  if (gradeName.startsWith("Primary")) return { label: "Primary", key: "primary", badgeClass: styles.badgePrimary };
  if (gradeName.startsWith("JSS")) return { label: "Junior Secondary", key: "junior", badgeClass: styles.badgeJunior };
  if (gradeName.startsWith("SS")) return { label: "Senior Secondary", key: "senior", badgeClass: styles.badgeSenior };
  return { label: "Higher Institution", key: "higher", badgeClass: styles.badgeHigher };
}

export function AssignClassTeacherPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"classes" | "history">("classes");

  // Filtering
  const [selectedTier, setSelectedTier] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [assignmentNotes, setAssignmentNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [classList, teacherList] = await Promise.all([
        api.getClasses(),
        api.getTeachers(),
      ]);
      setClasses(classList || []);
      setTeachers(teacherList || []);
    } catch (err: any) {
      showToast("error", err.message || "Failed to load class data");
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await api.getClassTeacherAssignmentHistory();
      setHistory(res || []);
    } catch (err: any) {
      showToast("error", err.message || "Failed to load assignment history");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === "history") {
      loadHistory();
    }
  }, [activeTab]);

  // Standardized unique classes (deduplicated)
  const standardizedClasses = useMemo(() => {
    const seen = new Set<string>();
    return classes
      .filter((c: any) => STANDARDIZED_GRADES.includes(c.name) && !c.section)
      .filter((c: any) => {
        if (seen.has(c.name)) return false;
        seen.add(c.name);
        return true;
      })
      .sort((a: any, b: any) => STANDARDIZED_GRADES.indexOf(a.name) - STANDARDIZED_GRADES.indexOf(b.name));
  }, [classes]);

  // Stats calculation
  const totalClasses = standardizedClasses.length;
  const assignedCount = standardizedClasses.filter((c) => c.class_teacher_id).length;
  const unassignedCount = totalClasses - assignedCount;

  // Filtered classes list
  const filteredClasses = useMemo(() => {
    return standardizedClasses.filter((c) => {
      const cat = getGradeCategory(c.name);
      if (selectedTier !== "all" && cat.key !== selectedTier) return false;
      if (statusFilter === "assigned" && !c.class_teacher_id) return false;
      if (statusFilter === "unassigned" && c.class_teacher_id) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesTeacher = c.class_teacher_name?.toLowerCase().includes(q);
        const matchesEmail = c.class_teacher_email?.toLowerCase().includes(q);
        if (!matchesName && !matchesTeacher && !matchesEmail) return false;
      }
      return true;
    });
  }, [standardizedClasses, selectedTier, statusFilter, search]);

  const openAssignModal = (cls: any) => {
    setSelectedClass(cls);
    setSelectedTeacherId(cls.class_teacher_id ? String(cls.class_teacher_id) : "");
    setAssignmentNotes("");
    setModalOpen(true);
  };

  const handleSaveAssignment = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;

    try {
      setSaving(true);
      const teacherIdNum = selectedTeacherId ? Number(selectedTeacherId) : null;
      await api.assignClassTeacher(selectedClass.id, teacherIdNum, assignmentNotes);

      showToast("success", teacherIdNum ? `Assigned class teacher for ${selectedClass.name}` : `Unassigned class teacher for ${selectedClass.name}`);
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to save assignment");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickUnassign = async (cls: any) => {
    if (!confirm(`Are you sure you want to unassign ${cls.class_teacher_name} from ${cls.name}?`)) return;
    try {
      setSaving(true);
      await api.assignClassTeacher(cls.id, null, "Quick unassign via class card");
      showToast("success", `Unassigned class teacher for ${cls.name}`);
      await loadData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to unassign class teacher");
    } finally {
      setSaving(false);
    }
  };

  // Find if currently selected teacher in modal is already assigned to a different class
  const existingTeacherClass = useMemo(() => {
    if (!selectedTeacherId || !selectedClass) return null;
    const tid = Number(selectedTeacherId);
    return standardizedClasses.find((c) => c.class_teacher_id === tid && c.id !== selectedClass.id);
  }, [selectedTeacherId, selectedClass, standardizedClasses]);

  return (
    <div className={styles.pageWrapper}>
      {toast && (
        <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Class Teachers Management</h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem", margin: "0.25rem 0 0 0" }}>
            Assign authorized class teachers to standardized grades. Only class teachers can generate cumulative term report cards and evaluate broad class performance.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconPrimary}`}>
            <UsersIcon width="24" height="24" />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{totalClasses}</span>
            <span className={styles.statLabel}>Standard Classes</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconSuccess}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{assignedCount}</span>
            <span className={styles.statLabel}>Assigned Classes</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconWarning}`}>
            <WarningIcon width="24" height="24" />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{unassignedCount}</span>
            <span className={styles.statLabel}>Unassigned Classes</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconInfo}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{teachers.length}</span>
            <span className={styles.statLabel}>Active Teachers</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tabButton} ${activeTab === "classes" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("classes")}
        >
          Classes & Assignments ({totalClasses})
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === "history" ? styles.tabButtonActive : ""}`}
          onClick={() => setActiveTab("history")}
        >
          Assignment Audit History
        </button>
      </div>

      {activeTab === "classes" ? (
        <>
          {/* Controls / Filter Bar */}
          <div className={styles.controlsRow}>
            <div className={styles.categoryPills}>
              <button
                className={`${styles.pillBtn} ${selectedTier === "all" ? styles.pillBtnActive : ""}`}
                onClick={() => setSelectedTier("all")}
              >
                All Grades
              </button>
              <button
                className={`${styles.pillBtn} ${selectedTier === "primary" ? styles.pillBtnActive : ""}`}
                onClick={() => setSelectedTier("primary")}
              >
                Primary (1-6)
              </button>
              <button
                className={`${styles.pillBtn} ${selectedTier === "junior" ? styles.pillBtnActive : ""}`}
                onClick={() => setSelectedTier("junior")}
              >
                Junior Sec (JSS 1-3)
              </button>
              <button
                className={`${styles.pillBtn} ${selectedTier === "senior" ? styles.pillBtnActive : ""}`}
                onClick={() => setSelectedTier("senior")}
              >
                Senior Sec (SS 1-3)
              </button>
              <button
                className={`${styles.pillBtn} ${selectedTier === "higher" ? styles.pillBtnActive : ""}`}
                onClick={() => setSelectedTier("higher")}
              >
                Tertiary & Higher
              </button>
            </div>

            <div className={styles.searchFilters}>
              <select
                className="select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: "160px" }}
              >
                <option value="all">All Statuses</option>
                <option value="assigned">Assigned Only</option>
                <option value="unassigned">Unassigned Only</option>
              </select>

              <div className={styles.searchInput}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search class or teacher…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </div>

          {/* Classes Cards Grid */}
          {loading ? (
            <div className="loadingWrap"><div className="spinner" /></div>
          ) : filteredClasses.length === 0 ? (
            <div className={styles.emptyHistory}>
              <UsersIcon width="48" height="48" />
              <p>No classes match your search or filter criteria.</p>
            </div>
          ) : (
            <div className={styles.classesGrid}>
              {filteredClasses.map((cls) => {
                const cat = getGradeCategory(cls.name);
                const hasTeacher = Boolean(cls.class_teacher_id);
                return (
                  <div key={cls.id} className={styles.classCard}>
                    <div>
                      <div className={styles.cardHeader}>
                        <h3 className={styles.className}>{cls.name}</h3>
                        <span className={`${styles.classBadge} ${cat.badgeClass}`}>
                          {cat.label}
                        </span>
                      </div>

                      <div className={styles.teacherBox} style={{ marginTop: "1rem" }}>
                        <div className={`${styles.teacherAvatar} ${!hasTeacher ? styles.teacherAvatarUnassigned : ""}`}>
                          {hasTeacher ? (
                            cls.class_teacher_name
                              ? cls.class_teacher_name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
                              : "CT"
                          ) : (
                            "?"
                          )}
                        </div>
                        <div className={styles.teacherInfo}>
                          {hasTeacher ? (
                            <>
                              <span className={styles.teacherName}>{cls.class_teacher_name}</span>
                              <span className={styles.teacherMeta}>{cls.class_teacher_email || "Class Teacher"}</span>
                            </>
                          ) : (
                            <>
                              <span className={styles.teacherName}>Unassigned</span>
                              <span className={styles.unassignedText}>No class teacher assigned</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={styles.cardFooter}>
                      <span className={styles.studentCount}>
                        👥 {cls.enrolled_students_count ?? 0} Students
                      </span>
                      <div className={styles.cardActions}>
                        {hasTeacher && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleQuickUnassign(cls)}
                            title="Unassign Teacher"
                            style={{ color: "var(--color-danger, #ef4444)" }}
                          >
                            Unassign
                          </button>
                        )}
                        <button
                          className={`btn ${hasTeacher ? "btn-secondary" : "btn-primary"} btn-sm`}
                          onClick={() => openAssignModal(cls)}
                        >
                          {hasTeacher ? "Change Teacher" : "Assign Teacher"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* History Tab */
        <div className={styles.historyTableCard}>
          {historyLoading ? (
            <div className="loadingWrap" style={{ padding: "3rem" }}><div className="spinner" /></div>
          ) : history.length === 0 ? (
            <div className={styles.emptyHistory}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <p>No class teacher assignment activity recorded yet.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className={styles.historyTable}>
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Class</th>
                    <th>Teacher</th>
                    <th>Action</th>
                    <th>Assigned By</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const actionClass =
                      h.action === "assigned"
                        ? styles.actionAssigned
                        : h.action === "reassigned"
                        ? styles.actionReassigned
                        : styles.actionUnassigned;
                    return (
                      <tr key={h.id}>
                        <td>{new Date(h.assigned_at).toLocaleString()}</td>
                        <td><strong>{h.class_name}</strong></td>
                        <td>{h.teacher_name ? `${h.teacher_name} (${h.teacher_email || ""})` : <span style={{ color: "#94a3b8" }}>— None —</span>}</td>
                        <td><span className={`${styles.actionBadge} ${actionClass}`}>{h.action}</span></td>
                        <td>{h.assigned_by_name || "System Admin"}</td>
                        <td style={{ color: "var(--color-text-muted)", fontSize: "0.82rem" }}>{h.notes || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Assign / Reassign Modal ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <h2>{selectedClass?.class_teacher_id ? "Change Class Teacher" : "Assign Class Teacher"}</h2>
        {selectedClass && (
          <form onSubmit={handleSaveAssignment} className={styles.modalForm}>
            <div className={styles.classSummaryBanner}>
              <div>
                <strong>Class: </strong> {selectedClass.name}
              </div>
              <div>
                <strong>Current: </strong> {selectedClass.class_teacher_name || "Unassigned"}
              </div>
            </div>

            <div className="field">
              <label>Select Teacher *</label>
              {teachers.length === 0 ? (
                <div className={styles.warningBox}>
                  <WarningIcon width="16" height="16" /> No active teachers registered in the system.
                </div>
              ) : (
                <select
                  className="select"
                  value={selectedTeacherId}
                  onChange={(e) => setSelectedTeacherId(e.target.value)}
                >
                  <option value="">— Unassign / No Teacher —</option>
                  {teachers.map((t) => {
                    const otherClass = standardizedClasses.find(
                      (c) => c.class_teacher_id === t.id && c.id !== selectedClass.id
                    );
                    const tag = otherClass ? ` (already class teacher for ${otherClass.name})` : "";
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.email} {tag}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {existingTeacherClass && (
              <div className={styles.warningBox}>
                <WarningIcon width="16" height="16" />
                <span>
                  <strong>Note:</strong> This teacher is currently the class teacher for <strong>{existingTeacherClass.name}</strong>. Assigning them here will automatically unassign them from {existingTeacherClass.name}.
                </span>
              </div>
            )}

            <div className="field">
              <label>Assignment Notes (Optional)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Assigned for 2026 Academic Session"
                value={assignmentNotes}
                onChange={(e) => setAssignmentNotes(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? "Saving…" : selectedTeacherId ? "Confirm Assignment" : "Unassign Teacher"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
