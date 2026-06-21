"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
              ["Class/Grade", user?.grade ?? "—"],
              ["Reg ID",      profile?.user?.reg_id ?? "—"],
              ["Phone",       profile?.user?.phone ?? "—"],
            ] as [string, string | null | undefined][]).map(([label, val]) => (
              <React.Fragment key={label}>
                <div className={styles.fieldLabel}>{label}</div>
                <div className={styles.fieldValue}>{val || "—"}</div>
              </React.Fragment>
            ))}
          </div>
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
              onClick={async () => { await logout(); router.replace("/"); }}
            >
              Logout
            </button>
          </div>
        </div>

      </div>
    </>
  );
}
