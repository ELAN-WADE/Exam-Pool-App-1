"use client";

import React, { useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian } from "../../../components/guardian/GuardianContext";
import { api } from "../../../lib/api";
import styles from "./page.module.css";

export default function GuardianFeesPage() {
  return (
    <RequireRole role="guardian">
      <FeesContent />
    </RequireRole>
  );
}

function FeesContent() {
  const { activeWard, refreshData } = useGuardian();
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [receiptRef, setReceiptRef] = useState<string>("");

  if (!activeWard) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>No active ward selected.</div>;
  }

  const fees = activeWard.fees;

  const handlePayBalance = async () => {
    try {
      setPaying(true);
      const pendingItem = fees.items.find((i) => i.status !== "paid");
      const feeId = pendingItem ? Number(pendingItem.id) : 1;
      const res = await api.post<any>(`/api/guardian/wards/${activeWard.id}/fees/pay`, {
        fee_id: feeId,
        amount: fees.balance,
        method: "card",
      });
      setReceiptRef(res?.paymentRef || `PAY-${Date.now()}`);
      setSuccess(true);
      refreshData();
    } catch (err: any) {
      alert(err.message || "Payment processing failed. Please check connection.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>School Fees & Billing</h1>

      {/* ── 1. Fees Summary Banner ── */}
      <section className={styles.feesBanner}>
        <div className={styles.bannerTop}>
          <div>
            <span className={styles.bannerLabel}>Outstanding Balance</span>
            <div className={styles.bannerBalance}>
              {success ? "₦0.00" : `₦${fees.balance.toLocaleString()}`}
            </div>
          </div>
          <span className={styles.bannerPaidBadge}>
            {success ? "100% Cleared" : `${fees.percentage}% Paid`}
          </span>
        </div>

        <div className={styles.progressBarContainer}>
          <div className={styles.progressBarTrack}>
            <div
              className={styles.progressBarFill}
              style={{ width: success ? "100%" : `${fees.percentage}%` }}
            />
          </div>
          <div className={styles.progressLabelRow}>
            <span>Paid: ₦{(success ? fees.total_fees : fees.amount_paid).toLocaleString()}</span>
            <span>Total: ₦{fees.total_fees.toLocaleString()}</span>
          </div>
        </div>
      </section>

      {/* ── 2. Itemized Breakdown ── */}
      <section className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>First Term 2025/2026 Breakdown</h2>

        <div className={styles.itemList}>
          {fees.items.map((item) => {
            const isItemPaid = success || item.status === "paid";
            return (
              <div key={item.id} className={styles.itemRow}>
                <div className={styles.itemLeft}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  <span className={styles.itemDate}>
                    {isItemPaid ? `Paid • ${item.paid_date}` : "Due by Term 1 Exams"}
                  </span>
                </div>
                <div className={styles.itemRight}>
                  <span className={styles.itemAmount}>₦{item.amount.toLocaleString()}</span>
                  <span className={isItemPaid ? styles.statusPaid : styles.statusPending}>
                    {isItemPaid ? "✓ Paid" : "Pending"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 3. Pay CTA ── */}
      {!success && fees.balance > 0 && (
        <button
          type="button"
          className={styles.payBtn}
          onClick={handlePayBalance}
          disabled={paying}
        >
          {paying ? "Processing Secure Payment…" : `Pay Outstanding ₦${fees.balance.toLocaleString()}`}
        </button>
      )}

      {success && (
        <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 14, padding: "1rem", textAlign: "center", color: "#065F46", fontSize: "0.8125rem", fontWeight: 600 }}>
          ✓ Payment successful! Receipt #{receiptRef || "REC-2026-001"} has been recorded and verified.
        </div>
      )}
    </div>
  );
}
