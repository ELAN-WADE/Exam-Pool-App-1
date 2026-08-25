"use client";

import React, { useEffect, useState, FormEvent, useMemo } from "react";
import { api } from "../../lib/api";
import { User } from "../../lib/types";
import { Modal } from "../ui/Modal";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { PageHeader, Tabs, Button } from "../ui";
import { UsersIcon, SearchIcon, CheckCircleIcon, WarningIcon } from "../icons/Icons";
import styles from "./AssignClassTeacherPage.module.css";

const STANDARDIZED_GRADES = [
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3",
  "SS 1", "SS 2", "SS 3",
  "100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "600 Level",
  "ND 1", "ND 2", "HND 1", "HND 2"
];

function getGradeCategory(gradeName: string): { label: string; key: "primary" | "junior" | "senior" | "higher" } {
  if (gradeName.startsWith("Primary")) return { label: "Primary", key: "primary" };
  if (gradeName.startsWith("JSS")) return { label: "Junior Secondary", key: "junior" };
  if (gradeName.startsWith("SS")) return { label: "Senior Secondary", key: "senior" };
  return { label: "Higher Institution", key: "higher" };
}

export function AssignClassTeacherPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("classes");

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

  // Toast / Feedback
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void } | null>(null);

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
      showToast("error", err.message || "Failed to load class roster");
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
      showToast("error", err.message || "Failed to load audit history");
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

  // Deduplicated standardized classes
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

  const handleQuickUnassign = (cls: any) => {
    setConfirmState({
      open: true,
      title: "Unassign Class Teacher?",
      message: `Unassign ${cls.class_teacher_name} from ${cls.name}?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          setSaving(true);
          await api.assignClassTeacher(cls.id, null, "Direct unassignment");
          showToast("success", `Unassigned class teacher for ${cls.name}`);
          await loadData();
        } catch (err: any) {
          showToast("error", err.message || "Failed to unassign class teacher");
        } finally {
          setSaving(false);
        }
      },
    });
  };

  // Detect conflict
  const existingTeacherClass = useMemo(() => {
    if (!selectedTeacherId || !selectedClass) return null;
    const tid = Number(selectedTeacherId);
    return standardizedClasses.find((c) => c.class_teacher_id === tid && c.id !== selectedClass.id);
  }, [selectedTeacherId, selectedClass, standardizedClasses]);

  return (
    <div className={styles.container}>
      <ConfirmDialog
        open={Boolean(confirmState?.open)}
        onClose={() => setConfirmState(null)}
        onConfirm={() => confirmState?.onConfirm()}
        title={confirmState?.title || ""}
        message={confirmState?.message || ""}
      />

      {toast && (
        <div style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          zIndex: 50,
          padding: "0.6rem 1rem",
          borderRadius: "8px",
          fontSize: "0.8125rem",
          fontWeight: 600,
          background: "var(--color-text, #0F172A)",
          color: "#FFFFFF",
          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.15)",
        }}>
          {toast.text}
        </div>
      )}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Academic Structure"
        title="Class Teachers"
        subtitle="Authorize faculty members to oversee class cohorts, broadsheets, and cumulative report cards."
      />

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Standard Classes</span>
            <div className={styles.statIcon} style={{ color: "#3B82F6" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{totalClasses}</div>
            <div className={styles.statFootnote}>Curriculum grade levels</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Assigned Classes</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{assignedCount}</div>
            <div className={styles.statFootnote}>Active faculty appointed</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Unassigned Classes</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><WarningIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{unassignedCount}</div>
            <div className={styles.statFootnote}>Pending appointment</div>
          </div>
        </div>
      </section>

      {/* ── Navigation Tabs ────────────────────────────────── */}
      <Tabs
        tabs={[
          { id: "classes", label: "Classes Matrix", count: totalClasses },
          { id: "history", label: "Assignment Audit History" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "classes" ? (
        <>
          {/* ── Filter Strip ─────────────────────────────────── */}
          <div className={styles.filterStrip}>
            <div className={styles.searchBox}>
              <SearchIcon width="14" height="14" className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search class or faculty name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <select
                value={selectedTier}
                onChange={(e) => setSelectedTier(e.target.value)}
                className={styles.selectFilter}
              >
                <option value="all">All Education Tiers</option>
                <option value="primary">Primary (Grades 1-6)</option>
                <option value="junior">Junior Secondary (JSS 1-3)</option>
                <option value="senior">Senior Secondary (SS 1-3)</option>
                <option value="higher">Higher Institution (100L-600L)</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={styles.selectFilter}
              >
                <option value="all">All Statuses</option>
                <option value="assigned">Assigned Only</option>
                <option value="unassigned">Unassigned Only</option>
              </select>
            </div>
          </div>

          {/* ── Structured Directory Table ───────────────────── */}
          <div className={styles.tableCard}>
            <div className={styles.tableWrapper}>
              <table className={styles.tbl}>
                <thead>
                  <tr>
                    <th>Class / Level</th>
                    <th>Tier</th>
                    <th>Assigned Faculty</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                        Loading class assignments…
                      </td>
                    </tr>
                  ) : filteredClasses.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                        No classes match the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredClasses.map((cls) => {
                      const cat = getGradeCategory(cls.name);
                      const isAssigned = Boolean(cls.class_teacher_id);

                      return (
                        <tr key={cls.id}>
                          <td>
                            <span className={styles.className}>{cls.name}</span>
                          </td>
                          <td>
                            <span className={styles.tierTag}>{cat.label}</span>
                          </td>
                          <td>
                            {isAssigned ? (
                              <div>
                                <div className={styles.teacherName}>{cls.class_teacher_name}</div>
                                <div className={styles.teacherEmail}>{cls.class_teacher_email}</div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--color-muted, #64748B)", fontSize: "0.75rem", fontStyle: "italic" }}>
                                Not Assigned
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`${styles.statusPill} ${isAssigned ? styles.statusAssigned : styles.statusUnassigned}`}>
                              {isAssigned ? "Assigned" : "Unassigned"}
                            </span>
                          </td>
                          <td>
                            <div className={styles.actionsCell}>
                              <button
                                type="button"
                                className={styles.actionBtn}
                                onClick={() => openAssignModal(cls)}
                              >
                                {isAssigned ? "Reassign" : "Assign"}
                              </button>
                              {isAssigned && (
                                <button
                                  type="button"
                                  className={styles.unassignBtn}
                                  onClick={() => handleQuickUnassign(cls)}
                                >
                                  Unassign
                                </button>
                              )}
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
        </>
      ) : (
        /* ── Audit History Tab ──────────────────────────────── */
        <div className={styles.tableCard}>
          {historyLoading ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
              Loading audit logs…
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
              No assignment changes recorded yet.
            </div>
          ) : (
            <div>
              {history.map((log) => (
                <div key={log.id} className={styles.auditItem}>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--color-text, #0F172A)" }}>{log.class_name}</span>
                    {" → "}
                    <span style={{ fontWeight: 600 }}>{log.teacher_name || "Unassigned"}</span>
                    {log.notes && (
                      <div style={{ color: "var(--color-muted, #64748B)", fontSize: "0.75rem", marginTop: "0.15rem" }}>
                        {log.notes}
                      </div>
                    )}
                  </div>
                  <div className={styles.auditMeta}>
                    {new Date(log.created_at).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: ASSIGN CLASS TEACHER ─────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Assign Class Teacher: ${selectedClass?.name || ""}`}
        size="md"
      >
        <form onSubmit={handleSaveAssignment} style={{ display: "flex", flexDirection: "column", gap: "1.125rem" }}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-muted, #64748B)", margin: 0, lineHeight: 1.4 }}>
            Appoint a faculty member responsible for <strong>{selectedClass?.name}</strong> term broadsheets and report card remarks.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text, #0F172A)" }}>
              Faculty Member
            </label>
            <select
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                fontSize: "0.8125rem",
                color: "var(--color-text, #0F172A)",
                background: "var(--color-surface, #FFFFFF)",
                border: "1px solid var(--color-border, #CBD5E1)",
                borderRadius: "6px",
                outline: "none",
              }}
              value={selectedTeacherId}
              onChange={(e) => setSelectedTeacherId(e.target.value)}
            >
              <option value="">-- No Teacher (Unassigned) --</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.email})
                </option>
              ))}
            </select>
          </div>

          {existingTeacherClass && (
            <div className={styles.conflictNotice}>
              <strong>Note:</strong> This teacher is already assigned as the Class Teacher for <strong>{existingTeacherClass.name}</strong>. Assigning them here will transfer their role to {selectedClass?.name}.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text, #0F172A)" }}>
              Directive / Notes (Optional)
            </label>
            <textarea
              rows={2}
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                fontSize: "0.8125rem",
                color: "var(--color-text, #0F172A)",
                background: "var(--color-surface, #FFFFFF)",
                border: "1px solid var(--color-border, #CBD5E1)",
                borderRadius: "6px",
                outline: "none",
                resize: "none",
              }}
              placeholder="e.g. Appointed for 2026/2027 academic session…"
              value={assignmentNotes}
              onChange={(e) => setAssignmentNotes(e.target.value)}
            />
          </div>

          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "0.625rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--color-border, #E2E8F0)",
            marginTop: "0.5rem",
          }}>
            <Button type="button" variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Confirm Assignment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
