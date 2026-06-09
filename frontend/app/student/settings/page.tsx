"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ChangePasswordModal } from "../../../components/auth/ChangePasswordModal";
import { useAuth } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import { examWindowStatus } from "../../../lib/gradeUtils";
import { BookIcon, CheckCircleIcon, BarChartIcon, DocumentIcon, PlayIcon, LockIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function StudentSettingsPage() {
  return (
    <RequireRole role="student">
      <StudentSettings />
    </RequireRole>
  );
}

function StudentSettings() {
  const { user, logout } = useAuth();
  const [showPwModal, setShowPwModal] = useState(false);
  const [profile, setProfile]         = useState<any>(null);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    api.getMyProfile().then((p) => {
      setProfile(p);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const initial   = user?.name?.charAt(0)?.toUpperCase() ?? "S";
  const enrolled  = (profile?.enrolled_subjects ?? []) as any[];
  const stats     = profile?.stats ?? { total_enrolled: 0, exams_completed: 0, avg_score_pct: 0 };

  const getStatusBadge = (s: any) => {
    const status = examWindowStatus(s);
    const map: Record<string, React.ReactElement> = {
      completed:    <span className="badge badge-success">Completed</span>,
      "in-progress": <span className="badge badge-warning">In Progress</span>,
      open:         <span className="badge badge-warning">Open Now</span>,
      closed:       <span className="badge badge-danger">Closed</span>,
      upcoming:     <span className="badge badge-info">Upcoming</span>,
      unpublished:  <span className="badge badge-muted">Unpublished</span>,
    };
    return map[status] ?? null;
  };

  return (
    <>
      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}

      <div className={styles.page}>
        <div className="pageHeader" style={{ padding: "0 0.5rem" }}>
          <h1 className="pageTitle">My Profile</h1>
          <Link href="/student/dashboard" className="btn btn-ghost">← Dashboard</Link>
        </div>

        {/* ── Profile Card ── */}
        <div className={styles.profileCard}>
          <div className={styles.profileHeader}>
            <div className={styles.profileAvatar}>{initial}</div>
            <div>
              <div className={styles.profileName}>{user?.name ?? "—"}</div>
              <div className={styles.profileEmail}>{user?.email ?? "—"}</div>
              <div className={styles.profileBadges}>
                <span className="badge badge-info">Student</span>
                {(user as any)?.grade && <span className="badge badge-success">{(user as any).grade}</span>}
              </div>
            </div>
          </div>

          <div className={styles.profileFields}>
            {([
              ["Full Name",   user?.name],
              ["Email",       user?.email],
              ["Class/Grade", (user as any)?.grade ?? "—"],
              ["Reg ID",      (profile?.user as any)?.reg_id ?? "—"],
              ["Phone",       (profile?.user as any)?.phone ?? "—"],
            ] as [string, string | null | undefined][]).map(([label, val]) => (
              <React.Fragment key={label}>
                <div className={styles.fieldLabel}>{label}</div>
                <div className={styles.fieldValue}>{val || "—"}</div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div className={styles.statsRow}>
          {[
            { icon: <BookIcon width="24" height="24" />,         label: "Enrolled",  value: stats.total_enrolled },
            { icon: <CheckCircleIcon width="24" height="24" />,   label: "Completed", value: stats.exams_completed },
            { icon: <BarChartIcon width="24" height="24" />,      label: "Avg Score", value: `${stats.avg_score_pct ?? 0}%` },
          ].map((s) => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statIcon}>{s.icon}</div>
              <div className={styles.statValue}>{s.value}</div>
              <div className={styles.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Enrolled Subjects ── */}
        <div className={styles.sectionCard}>
          <h3 className={styles.sectionTitle}>
            <DocumentIcon width="16" height="16" /> My Subjects
          </h3>
          {loading ? (
            <div className="loadingWrap" style={{ minHeight: 80 }}><div className="spinner" /></div>
          ) : enrolled.length === 0 ? (
            <p style={{ color: "var(--color-muted)", textAlign: "center", padding: "1rem 0" }}>
              You are not enrolled in any subjects yet.
            </p>
          ) : (
            <div className={styles.subjectList}>
              {enrolled.map((s: any) => (
                <div key={s.id} className={styles.subjectRow}>
                  <div className={styles.subjectInfo}>
                    <div className={styles.subjectName}>{s.name}</div>
                    <div className={styles.subjectMeta}>
                      {s.code} · {s.duration} min
                      {s.exam_status === "completed" && s.score != null && (
                        <> · Score: <strong>{s.score}/{s.total_score}</strong></>
                      )}
                    </div>
                  </div>
                  <div className={styles.subjectActions}>
                    {getStatusBadge(s)}
                    {s.exam_status === "completed" && (
                      <Link href="/student/results" className="btn btn-ghost btn-sm">Result</Link>
                    )}
                    {s.is_published && s.exam_status !== "completed" && (() => {
                      const status = examWindowStatus(s);
                      if (status === "open" || status === "in-progress") {
                        return (
                          <Link
                            href={`/student/exam?subjectId=${s.id}`}
                            className="btn btn-primary btn-sm"
                            style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
                          >
                            {status === "in-progress" ? <><PlayIcon width="12" height="12" /> Resume</> : "Start →"}
                          </Link>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Security ── */}
        <div className={styles.sectionCard}>
          <h3 className={styles.sectionTitle}>
            <LockIcon width="16" height="16" /> Security
          </h3>
          <div className={styles.securityRow}>
            <div>
              <div className={styles.securityLabel}>Password</div>
              <div className={styles.securitySub}>Update your login password</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowPwModal(true)}>
              Change Password
            </button>
          </div>
          <div className={styles.securityRow}>
            <div>
              <div className={styles.securityLabel}>Logout</div>
              <div className={styles.securitySub}>Sign out of all sessions</div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--color-danger)" }}
              onClick={async () => { await logout(); window.location.href = "/"; }}
            >
              Logout
            </button>
          </div>
        </div>

      </div>
    </>
  );
}
