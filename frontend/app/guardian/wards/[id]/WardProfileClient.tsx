"use client";

import React, { use } from "react";
import Link from "next/link";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { useGuardian } from "../../../../components/guardian/GuardianContext";
import styles from "./page.module.css";

interface Props {
  params: Promise<{ id: string }>;
}

export function WardProfileClient({ params }: Props) {
  const resolvedParams = use(params);
  const wardId = parseInt(resolvedParams.id, 10);

  return (
    <RequireRole role="guardian">
      <WardProfileContent wardId={wardId} />
    </RequireRole>
  );
}

function WardProfileContent({ wardId }: { wardId: number }) {
  const { wards } = useGuardian();
  const ward = wards.find((w) => w.id === wardId) || wards[0];

  if (!ward) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>Ward record not found.</div>;
  }

  return (
    <div className={styles.container}>
      {/* ── 1. Profile Hero ── */}
      <section className={styles.profileHero}>
        <div className={styles.avatarLarge}>{ward.name.charAt(0)}</div>
        <h1 className={styles.heroName}>{ward.name}</h1>
        <div className={styles.heroMeta}>
          <span>{ward.grade}</span>
          <span>•</span>
          <span>Adm: {ward.admission_number}</span>
        </div>
      </section>

      {/* ── 2. Bio & Medical Information ── */}
      <section className={styles.infoCard}>
        <h2 className={styles.cardTitle}>Personal & Medical Info</h2>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Date of Birth</span>
            <span className={styles.infoValue}>{ward.dob || "12 May 2010"}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Gender</span>
            <span className={styles.infoValue}>{ward.gender || "Male"}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Blood Group</span>
            <span className={styles.infoValue}>{ward.blood_group || "O+"}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Status</span>
            <span className={styles.infoValue} style={{ color: "#059669" }}>Enrolled & Active</span>
          </div>
        </div>
      </section>

      {/* ── 3. Parent & Emergency Contacts ── */}
      <section className={styles.infoCard}>
        <h2 className={styles.cardTitle}>Guardian & Emergency Contact</h2>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Parent Name</span>
            <span className={styles.infoValue}>{ward.parent_name || "Mrs. Adenike Adeleke"}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Relationship</span>
            <span className={styles.infoValue}>{ward.relationship || "Mother"}</span>
          </div>
          <div className={styles.infoItem} style={{ gridColumn: "span 2" }}>
            <span className={styles.infoLabel}>Phone Number</span>
            <span className={styles.infoValue}>{ward.parent_phone || "+234 801 234 5678"}</span>
          </div>
          <div className={styles.infoItem} style={{ gridColumn: "span 2" }}>
            <span className={styles.infoLabel}>Emergency Contact</span>
            <span className={styles.infoValue}>{ward.emergency_contact || "+234 802 987 6543 (Mr. Tunde Adeleke)"}</span>
          </div>
        </div>
      </section>

      {/* ── 4. Quick Navigation Links ── */}
      <div className={styles.actionLinks}>
        <Link href="/guardian/performance" className={styles.actionBtn}>
          <span>View Subject Performance</span>
          <span>→</span>
        </Link>
        <Link href="/guardian/attendance" className={styles.actionBtn}>
          <span>View Attendance Audit</span>
          <span>→</span>
        </Link>
        <Link href="/guardian/reports" className={styles.actionBtn}>
          <span>View Term Reports & Transcripts</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}
