"use client";

import Link from "next/link";
import React, { useEffect, useState, useMemo } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import type { Subject } from "../../../lib/types";
import {
  PageHeader,
  Button,
} from "../../../components/ui";
import {
  SubjectIcon,
  BookIcon,
  UsersIcon,
  PlusIcon,
  CheckCircleIcon,
} from "../../../components/icons/Icons";
import { useToast } from "../../../hooks/useToast";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then((mod) => mod.Modal), { ssr: false });
import styles from "./page.module.css";

export default function TeacherAssignmentsPage() {
  return (
    <RequireRole role="teacher">
      <TeacherAssignments />
    </RequireRole>
  );
}

function TeacherAssignments() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>({});
  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();
  const currentSessionName = selectedSession?.name || activeSession?.name || "2026/2027";
  const currentTermName = selectedTerm?.name || activeTerm?.name || "First Term";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", term: "1", duration: "60", mode: "test", is_assignment: true });
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const termMap: Record<string, string> = { "1": "First Term", "2": "Second Term", "3": "Third Term" };
      const termName = termMap[form.term] || selectedTerm?.name || "First Term";
      await api.createSubject({
        name: form.name,
        code: form.code,
        term: termName,
        duration: Number(form.duration),
        exam_datetime: "",
        teacher_id: 0,
        mode: form.mode,
        assessment_type: "school_test",
        result_policy: "immediate",
        is_assignment: form.is_assignment ? 1 : 0,
        can_retake: 1,
        session_id: selectedSession?.id,
        term_id: selectedTerm?.id,
      });
      showToast("Assessment created successfully", "success");
      setModalOpen(false);
      setForm({ name: "", code: "", term: "1", duration: "60", mode: "test", is_assignment: true });

      const subs = await api.getSubjects(selectedSession?.id, selectedTerm?.id);
      if (subs) {
        setSubjects(subs.filter((s) => s.is_assignment === 1));
      }
    } catch (err: any) {
      showToast(err.message || "Failed to create assessment", "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    (async () => {
      try {
        setLoading(true);
        const subs = (await api.getSubjects(selectedSession?.id, selectedTerm?.id)) ?? [];
        if (signal.aborted) return;

        const assignmentSubs = subs.filter((s) => s.is_assignment === 1);
        setSubjects(assignmentSubs);

        const counts: Record<number, number> = {};
        await Promise.all(
          assignmentSubs.map(async (s) => {
            try {
              if (signal.aborted) return;
              const qs = await api.getQuestions(Number(s.id));
              if (signal.aborted) return;
              counts[Number(s.id)] = Array.isArray(qs) ? qs.length : 0;
            } catch {
              counts[Number(s.id)] = 0;
            }
          })
        );
        if (signal.aborted) return;
        setQuestionCounts(counts);
      } catch (err: any) {
        if (!signal.aborted) setError(err.message || "Failed to load assignments");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => abortController.abort();
  }, [selectedSession?.id, selectedTerm?.id]);

  const drafts = useMemo(() => subjects.filter((s) => !s.is_published).length, [subjects]);
  const published = useMemo(() => subjects.filter((s) => s.is_published).length, [subjects]);

  return (
    <div className={styles.container}>
      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Continuous Evaluation"
        title="Offline Assignments & Coursework"
        subtitle={`Session ${currentSessionName} · ${currentTermName}`}
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlusIcon width="13" height="13" />}
            onClick={() => setModalOpen(true)}
          >
            Create Assessment
          </Button>
        }
      />

      {error && (
        <div style={{ padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-danger, #DC2626)", fontSize: "0.8125rem" }}>
          {error}
        </div>
      )}

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Configured Tasks</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{subjects.length}</div>
            <div className={styles.statFootnote}>Take-home assessments</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Published Tasks</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{published}</div>
            <div className={styles.statFootnote}>Active for candidates</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Draft Items</span>
            <div className={styles.statIcon} style={{ color: "#6366F1" }}><SubjectIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{drafts}</div>
            <div className={styles.statFootnote}>Under authoring</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Assessment Mode</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue} style={{ fontSize: "1.125rem" }}>
              Take-Home
            </div>
            <div className={styles.statFootnote}>Continuous evaluation</div>
          </div>
        </div>
      </section>

      {/* ── Course Grid ────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
          Loading assignments…
        </div>
      ) : subjects.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3.5rem 2rem", background: "var(--color-surface)", border: "1px dashed var(--color-border)", borderRadius: "12px", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
          <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "0.9375rem", marginBottom: "0.35rem" }}>
            No Coursework or Assignments Found
          </div>
          <div>Click "Create Assessment" above to set up take-home or offline tests.</div>
        </div>
      ) : (
        <div className={styles.courseGrid}>
          {subjects.map((s) => {
            const qCount = questionCounts[Number(s.id)] ?? 0;
            const isLive = Boolean(s.is_published);
            return (
              <div key={s.id} className={styles.courseCard}>
                <div className={styles.courseCardTop}>
                  <div>
                    <div className={styles.courseName}>{s.name}</div>
                    <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.35rem" }}>
                      <span className={styles.codeBadge}>{s.code}</span>
                      {s.class && <span className={styles.codeBadge}>{s.class}</span>}
                    </div>
                  </div>
                  <span className={`${styles.statusTag} ${isLive ? styles.statusLive : styles.statusDraft}`}>
                    {isLive ? "Live" : "Draft"}
                  </span>
                </div>

                <div className={styles.courseMetaGrid}>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Item Bank</span>
                    <span className={styles.metaValue}>{qCount} Questions</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Total Marks</span>
                    <span className={styles.metaValue}>{s.total_score ?? 0} Pts</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Duration</span>
                    <span className={styles.metaValue}>{s.duration || 60} min</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Mode</span>
                    <span className={styles.metaValue}>{(s.mode || "test").toUpperCase()}</span>
                  </div>
                </div>

                <div className={styles.courseActions}>
                  <Link
                    href={`/teacher/questions?subjectId=${s.id}${!isLive ? "&action=create" : ""}`}
                    className={styles.primaryActionBtn}
                  >
                    {isLive ? "View Questions" : "Manage Questions"}
                  </Link>
                  <Link
                    href={`/teacher/students?subjectId=${s.id}`}
                    className={styles.secondaryActionBtn}
                    title="Enrolled Candidates"
                  >
                    <UsersIcon width="13" height="13" />
                  </Link>
                  <Link
                    href={`/teacher/results?subjectId=${s.id}`}
                    className={styles.secondaryActionBtn}
                    title="Exam Results"
                  >
                    <BookIcon width="13" height="13" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Assessment Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>Create Coursework Assessment</div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.15rem" }}>
              Define parameters for continuous assessment tests, homework, or take-home evaluations.
            </div>
          </div>

          <form onSubmit={handleCreateAssessment} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Assessment Name *</label>
              <input
                className={styles.formInput}
                placeholder="e.g. Mid-Term Chemistry Assignment"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Course Code *</label>
                <input
                  className={styles.formInput}
                  placeholder="e.g. CHM101-HW"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Assessment Mode</label>
                <select
                  className={styles.formSelect}
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value })}
                >
                  <option value="test">Continuous Assessment (Test)</option>
                  <option value="quiz">Quiz</option>
                  <option value="exam">Offline Examination</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Target Term</label>
                <select
                  className={styles.formSelect}
                  value={form.term}
                  onChange={(e) => setForm({ ...form, term: e.target.value })}
                >
                  <option value="1">First Term</option>
                  <option value="2">Second Term</option>
                  <option value="3">Third Term</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Time Limit (Minutes)</label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  className={styles.formInput}
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <Button type="button" variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={saving}>
                Create Assessment
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
