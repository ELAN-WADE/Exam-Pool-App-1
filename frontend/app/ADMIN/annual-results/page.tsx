"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import { useToast } from "../../../hooks/useToast";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then((mod) => mod.Modal), { ssr: false });
import {
  PageHeader,
  Button,
  ActiveGoldBadge,
} from "../../../components/ui";
import {
  UsersIcon,
  SearchIcon,
  CheckCircleIcon,
  BookIcon,
  WarningIcon,
  CrownIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function AnnualResultsPage() {
  return (
    <RequireRole role="operator">
      <AnnualResultsContent />
    </RequireRole>
  );
}

function AnnualResultsContent() {
  const { selectedSession, activeSession } = useAcademic();
  const isSessionActive = Boolean(selectedSession?.is_active || (activeSession && selectedSession?.id === activeSession?.id));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [studentAverages, setStudentAverages] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [existingResults, setExistingResults] = useState<any[]>([]);
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    studentName: string;
    studentId: number;
    classId: number;
    avg: number;
    status: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getAnnualResults(selectedSession?.id);
      setStudentAverages(data?.studentAverages || []);
      setEnrollments(data?.classEnrollments || []);
      setExistingResults(data?.existingResults || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load annual results");
    } finally {
      setLoading(false);
    }
  }, [selectedSession]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    (async () => {
      try {
        setLoading(true);
        const data = await api.getAnnualResults(selectedSession?.id);
        if (!signal.aborted) {
          setStudentAverages(data?.studentAverages || []);
          setEnrollments(data?.classEnrollments || []);
          setExistingResults(data?.existingResults || []);
        }
      } catch (e: unknown) {
        if (!signal.aborted) setError(e instanceof Error ? e.message : "Failed to load annual results");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedSession]);

  function getDecision(studentId: number) {
    return existingResults.find((r: any) => r.student_id === studentId);
  }

  async function executePromotion() {
    if (!confirmState) return;
    const { studentId, classId, avg, status } = confirmState;
    setConfirmState(null);
    try {
      await api.promoteStudent({
        student_id: studentId,
        session_id: selectedSession?.id,
        class_id: classId,
        total_average: avg,
        promotion_status: status,
      });
      showToast(`Student marked as "${status}".`, "success");
      loadData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to record promotion decision.", "error");
    }
  }

  // Summary Metrics
  const stats = useMemo(() => {
    const total = studentAverages.length;
    const decisions = studentAverages.map((sa) => getDecision(sa.student_id));
    const promoted = decisions.filter((d) => d?.promotion_status === "Promoted").length;
    const repeated = decisions.filter((d) => d?.promotion_status === "Repeated").length;
    const graduated = decisions.filter((d) => d?.promotion_status === "Graduated").length;
    const pending = total - (promoted + repeated + graduated);

    const overallAvg =
      total > 0
        ? studentAverages.reduce((acc, curr) => acc + (Number(curr.annual_average) || 0), 0) / total
        : 0;

    return { total, promoted, repeated, graduated, pending, overallAvg };
  }, [studentAverages, existingResults]);

  // Filtered rows
  const filteredStudents = useMemo(() => {
    return studentAverages.filter((sa) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        sa.student_name?.toLowerCase().includes(q) ||
        sa.reg_id?.toLowerCase().includes(q);

      const decision = getDecision(sa.student_id);
      const currentStatus = decision?.promotion_status || "Pending";

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "pending" && !decision) ||
        currentStatus.toLowerCase() === statusFilter.toLowerCase();

      return matchSearch && matchStatus;
    });
  }, [studentAverages, search, statusFilter, existingResults]);

  return (
    <div className={styles.container}>
      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Academic Outcomes"
        title="Annual Results & Promotion"
        subtitle={`Cumulative performance broadsheet and promotion decisions for ${selectedSession?.name || "the active session"}.`}
      />

      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-danger, #DC2626)", fontSize: "0.8125rem" }}>
          <WarningIcon width="16" height="16" />
          {error}
        </div>
      )}

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Candidates Assessed</span>
            <div className={styles.statIcon} style={{ color: "#3B82F6" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.total}</div>
            <div className={styles.statFootnote}>With approved results</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Cohort Mean Average</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.overallAvg.toFixed(1)}%</div>
            <div className={styles.statFootnote}>Across all assessed terms</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Promoted / Graduated</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.promoted + stats.graduated}</div>
            <div className={styles.statFootnote}>{stats.promoted} promoted, {stats.graduated} graduated</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Pending Decisions</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><WarningIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.pending}</div>
            <div className={styles.statFootnote}>Awaiting outcome</div>
          </div>
        </div>
      </section>

      {/* ── Filter Strip ─────────────────────────────────────── */}
      <div className={styles.filterStrip}>
        <div className={styles.searchBox}>
          <SearchIcon width="14" height="14" className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search candidate by name or registration ID…"
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
          <option value="all">All Outcomes</option>
          <option value="promoted">Promoted Only</option>
          <option value="graduated">Graduated Only</option>
          <option value="repeated">Repeated Only</option>
          <option value="pending">Pending Only</option>
        </select>
      </div>

      {/* ── Broadsheet Performance Table ─────────────────────── */}
      <div className={styles.tableCard}>
        <div className={styles.tableWrapper}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Reg ID</th>
                <th>Subjects</th>
                <th>Terms</th>
                <th>Cumulative Average</th>
                <th>Outcome Status</th>
                <th style={{ textAlign: "right" }}>Promotion Decision</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                    Loading annual records…
                  </td>
                </tr>
              ) : filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)" }}>
                    No annual results found for this session.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((sa: any) => {
                  const avg = Number(sa.annual_average) || 0;
                  const classId = enrollments.find((ce: any) => ce.student_id === sa.student_id)?.class_id || 0;
                  const decision = getDecision(sa.student_id);
                  const status = decision?.promotion_status;

                  return (
                    <tr key={sa.student_id}>
                      <td>
                        <div className={styles.studentName}>{sa.student_name}</div>
                      </td>
                      <td>
                        <span className={styles.regIdBadge}>{sa.reg_id || "—"}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "0.8125rem" }}>{sa.subjects_count}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: "0.8125rem" }}>{sa.terms_count}</span>
                      </td>
                      <td>
                        <span className={styles.scoreVal}>{avg.toFixed(1)}%</span>
                      </td>
                      <td>
                        {status === "Promoted" && <span className={`${styles.statusTag} ${styles.statusPromoted}`}>Promoted</span>}
                        {status === "Graduated" && <span className={`${styles.statusTag} ${styles.statusGraduated}`}>Graduated</span>}
                        {status === "Repeated" && <span className={`${styles.statusTag} ${styles.statusRepeated}`}>Repeated</span>}
                        {!status && <span className={`${styles.statusTag} ${styles.statusPending}`}>Pending</span>}
                      </td>
                      <td>
                        <div className={styles.actionBtnGroup}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() =>
                              setConfirmState({
                                open: true,
                                studentName: sa.student_name,
                                studentId: sa.student_id,
                                classId,
                                avg,
                                status: "Promoted",
                              })
                            }
                          >
                            Promote
                          </button>
                          <button
                            type="button"
                            className={styles.actionBtnSecondary}
                            onClick={() =>
                              setConfirmState({
                                open: true,
                                studentName: sa.student_name,
                                studentId: sa.student_id,
                                classId,
                                avg,
                                status: "Repeated",
                              })
                            }
                          >
                            Repeat
                          </button>
                          <button
                            type="button"
                            className={styles.actionBtnSecondary}
                            onClick={() =>
                              setConfirmState({
                                open: true,
                                studentName: sa.student_name,
                                studentId: sa.student_id,
                                classId,
                                avg,
                                status: "Graduated",
                              })
                            }
                          >
                            Graduate
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

      {/* ── CONFIRMATION MODAL ── */}
      <Modal
        open={Boolean(confirmState?.open)}
        onClose={() => setConfirmState(null)}
        title="Confirm Promotion Decision"
        size="sm"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text)", margin: 0, lineHeight: 1.5 }}>
            Mark <strong>{confirmState?.studentName}</strong> as <strong>"{confirmState?.status}"</strong> for this academic year?
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
            <Button variant="secondary" size="sm" onClick={() => setConfirmState(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={executePromotion}>
              Confirm Decision
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
