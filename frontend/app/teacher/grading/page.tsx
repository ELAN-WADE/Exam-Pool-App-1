"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import {
  PageHeader,
  Button,
  FilterBar,
  Table,
  type TableColumn,
} from "../../../components/ui";
import {
  BookIcon,
  CheckCircleIcon,
  ClockIcon,
  SubjectIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function GradingCenterPage() {
  return (
    <RequireRole role="teacher">
      <GradingCenter />
    </RequireRole>
  );
}

function GradingCenter() {
  const { selectedSession, selectedTerm } = useAcademic();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [gradingConfig, setGradingConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const [subs, cfg] = await Promise.all([
          api.getGradingSubjects(selectedSession?.id, selectedTerm?.id),
          api.getGradingConfig(),
        ]);
        if (!signal.aborted) {
          setSubjects(subs || []);
          setGradingConfig(cfg);
        }
      } catch (e: unknown) {
        if (!signal.aborted) setError(e instanceof Error ? e.message : "Failed to load grading data");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedSession?.id, selectedTerm?.id]);

  const caMax = gradingConfig?.ca_max ?? 40;
  const examMax = gradingConfig?.exam_max ?? 60;

  const filtered = useMemo(() => {
    return subjects.filter((s) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        s.name?.toLowerCase().includes(q) ||
        s.code?.toLowerCase().includes(q) ||
        s.class?.toLowerCase().includes(q);

      const matchMode = modeFilter === "all" || (s.mode || "exam") === modeFilter;
      return matchSearch && matchMode;
    });
  }, [subjects, search, modeFilter]);

  const approvedCount = useMemo(() => subjects.filter((s) => s.is_approved).length, [subjects]);
  const pendingCount = useMemo(() => subjects.filter((s) => !s.is_approved).length, [subjects]);

  const columns: TableColumn<any>[] = [
    {
      key: "name",
      header: "Subject & Code",
      sortable: true,
      render: (s) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{s.name}</div>
          <span className={styles.codeBadge}>{s.code}</span>
        </div>
      ),
    },
    {
      key: "class",
      header: "Class / Cohort",
      render: (s) => (
        <span style={{ fontSize: "0.8125rem", color: s.class ? "var(--color-text)" : "var(--color-muted)" }}>
          {s.class || "All Cohorts"}
        </span>
      ),
    },
    {
      key: "mode",
      header: "Assessment Mode",
      width: "140px",
      render: (s) => (
        <span className={styles.codeBadge}>
          {(s.mode || "exam").toUpperCase()}
        </span>
      ),
    },
    {
      key: "status",
      header: "Gradebook Status",
      align: "center",
      width: "160px",
      render: (s) => (
        <span className={`${styles.statusTag} ${s.is_approved ? styles.statusApproved : styles.statusPending}`}>
          {s.is_approved ? "Approved" : "In Progress"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Action",
      align: "right",
      width: "160px",
      render: (s) => (
        <Link href={`/teacher/grading/details?id=${s.id}`}>
          <Button variant="secondary" size="xs">
            Open Gradebook →
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <PageHeader
        eyebrow="Evaluation & Gradebook"
        title="Subject Grading Center"
        subtitle={`Continuous Assessment (${caMax}%) + Examination (${examMax}%) = 100% total weight.`}
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
            <span className={styles.statLabel}>Gradebook Courses</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{subjects.length}</div>
            <div className={styles.statFootnote}>Active subject gradebooks</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Approved Records</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{approvedCount}</div>
            <div className={styles.statFootnote}>Finalized and locked</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Pending Grading</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><ClockIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{pendingCount}</div>
            <div className={styles.statFootnote}>Awaiting score input</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Evaluation Policy</span>
            <div className={styles.statIcon} style={{ color: "#6366F1" }}><SubjectIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue} style={{ fontSize: "1.125rem" }}>
              {caMax} CA / {examMax} Exam
            </div>
            <div className={styles.statFootnote}>Institutional standard</div>
          </div>
        </div>
      </section>

      {/* ── Filter Bar ─────────────────────────────────────────── */}
      <FilterBar
        searchQuery={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by subject name, code, or class cohort..."
        filters={[
          {
            id: "mode",
            value: modeFilter,
            onChange: setModeFilter,
            options: [
              { label: "All Assessment Modes", value: "all" },
              { label: "Final Exams", value: "exam" },
              { label: "Continuous Assessment Tests", value: "test" },
              { label: "Quizzes", value: "quiz" },
            ],
          },
        ]}
        hasActiveFilters={Boolean(search || modeFilter !== "all")}
        onReset={() => {
          setSearch("");
          setModeFilter("all");
        }}
      />

      {/* ── Gradebook Table ────────────────────────────────────── */}
      <div className={styles.tableContainer}>
        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(s) => s.id}
          loading={loading}
          emptyTitle="No Grading Activities Found"
          emptySubtitle="Subject gradebooks will appear here once candidates complete tests or exams."
        />
      </div>
    </div>
  );
}
