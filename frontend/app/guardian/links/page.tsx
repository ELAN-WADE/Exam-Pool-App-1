"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import {
  UsersIcon,
  PlusIcon,
  RefreshIcon,
  ActivityIcon,
  TrashIcon,
  CheckIcon,
} from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Modal, Button } from "../../../components/ui";
import styles from "./page.module.css";

interface GuardianLink {
  id: number;
  student_id: number;
  student_name: string;
  grade: string;
  reg_id: string;
  relationship: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  created_at: string;
}

type TabType = "all" | "pending" | "approved" | "rejected";
type Toast = { type: "success" | "error"; text: string } | null;

export default function GuardianLinksPage() {
  return (
    <RequireRole role="guardian">
      <LinksContent />
    </RequireRole>
  );
}

function LinksContent() {
  const [links, setLinks] = useState<GuardianLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabType>("all");
  const [toast, setToast] = useState<Toast>(null);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ student_id: "", relationship: "Parent" });
  const [saving, setSaving] = useState(false);

  const { selectedSession, selectedTerm } = useAcademic();

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const data = await api.get<any>("/api/guardian/links");
      setLinks(data ?? []);
    } catch (err: any) {
      setError(err.message || "Failed to load links");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredLinks = links.filter((link) => {
    if (tab === "all") return true;
    return link.status === tab;
  });

  const counts = {
    all: links.length,
    pending: links.filter((l) => l.status === "pending").length,
    approved: links.filter((l) => l.status === "approved").length,
    rejected: links.filter((l) => l.status === "rejected" || l.status === "revoked").length,
  };

  const handleCreateLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.student_id) {
      showToast("error", "Please enter a student ID.");
      return;
    }

    setSaving(true);
    try {
      await api.post<any>("/api/guardian/links", {
        student_id: Number(form.student_id),
        relationship: form.relationship,
      });
      showToast("success", "Link request created successfully. Waiting for approval.");
      setShowModal(false);
      setForm({ student_id: "", relationship: "Parent" });
      await loadData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to create link request");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelLink = async (linkId: number) => {
    try {
      await api.delete<any>(`/api/guardian/links/${linkId}`);
      showToast("success", "Link request cancelled.");
      await loadData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to cancel link");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <span className={`${styles.statusDot} ${styles.statusDotPending}`} />;
      case "approved":
        return <span className={`${styles.statusDot} ${styles.statusDotApproved}`} />;
      case "rejected":
        return <span className={`${styles.statusDot} ${styles.statusDotRejected}`} />;
      case "revoked":
        return <span className={`${styles.statusDot} ${styles.statusDotRevoked}`} />;
      default:
        return null;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case "pending":
        return styles.statusPending;
      case "approved":
        return styles.statusApproved;
      case "rejected":
        return styles.statusRejected;
      case "revoked":
        return styles.statusRevoked;
      default:
        return "";
    }
  };

  if (error) {
    return (
      <div style={{
        background: "var(--color-surface, #FFFFFF)",
        border: "1px solid var(--color-border, #E2E8F0)",
        borderRadius: "12px",
        padding: "3rem 2rem",
        textAlign: "center",
        maxWidth: "460px",
        margin: "3rem auto",
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          background: "rgba(220, 38, 38, 0.08)",
          color: "var(--color-danger, #DC2626)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1rem",
        }}>
          <ActivityIcon width="20" height="20" />
        </div>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-text, #0F172A)", marginBottom: "0.35rem" }}>
          Unable to Load Links
        </h3>
        <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.8125rem", marginBottom: "1.25rem", lineHeight: 1.5 }}>
          {error}
        </p>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => loadData()}
          style={{ padding: "0.45rem 1.25rem", borderRadius: "8px", fontWeight: 600 }}
        >
          <RefreshIcon width="13" height="13" /> Retry Connection
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.headerWrapper}>
          <div className={styles.headerLeft}>
            <Skeleton width={180} height={28} borderRadius="6px" />
            <Skeleton width={260} height={16} borderRadius="4px" style={{ marginTop: "0.35rem" }} />
          </div>
          <div className={styles.headerRight}>
            <Skeleton width={120} height={30} borderRadius="6px" />
          </div>
        </div>
        <div className={styles.commandStrip}>
          <div className={styles.tabList}>
            <Skeleton width={100} height={24} borderRadius="4px" />
            <Skeleton width={100} height={24} borderRadius="4px" />
          </div>
        </div>
        <div className={styles.linksList}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={styles.linkCard}>
              <div className={styles.linkInfo}>
                <Skeleton width={48} height={48} borderRadius="12px" />
                <div style={{ flex: 1 }}>
                  <Skeleton width={150} height={16} borderRadius="4px" />
                  <Skeleton width={100} height={12} borderRadius="4px" style={{ marginTop: "0.35rem" }} />
                </div>
              </div>
              <Skeleton width={80} height={24} borderRadius="4px" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "1.5rem",
            right: "1.5rem",
            zIndex: 50,
            padding: "0.85rem 1.25rem",
            borderRadius: "10px",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "#FFFFFF",
            background: toast.type === "success" ? "#166534" : "#991B1B",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
          }}
        >
          {toast.text}
        </div>
      )}

      {/* Page Header */}
      <div className={styles.headerWrapper}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <h1 className={styles.pageTitle}>Guardian Links</h1>
            <span className={styles.roleBadge}>Guardian</span>
          </div>
          <p className={styles.subtitle}>
            Manage your guardian-student link requests and view their status.
          </p>
        </div>

        <div className={styles.headerRight}>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="btn btn-outline btn-sm"
            style={{ padding: "0.35rem 0.7rem", borderRadius: "8px", fontWeight: 600 }}
          >
            <RefreshIcon width="12" height="12" style={{ color: "#6366F1", animation: refreshing ? "spin 1s linear infinite" : "none" }} />
            <span>{refreshing ? "Syncing…" : "Sync"}</span>
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="btn btn-primary btn-sm"
            style={{ padding: "0.35rem 0.7rem", borderRadius: "8px", fontWeight: 600 }}
          >
            <PlusIcon width="14" height="14" /> New Link
          </button>
        </div>
      </div>

      {/* Command Strip */}
      <div className={styles.commandStrip}>
        <div className={styles.tabList}>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "all" ? styles.tabActive : ""}`}
            onClick={() => setTab("all")}
          >
            All Links
            <span className={styles.tabCount}>{counts.all}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "pending" ? styles.tabActive : ""}`}
            onClick={() => setTab("pending")}
          >
            Pending
            <span className={styles.tabCount}>{counts.pending}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "approved" ? styles.tabActive : ""}`}
            onClick={() => setTab("approved")}
          >
            Approved
            <span className={styles.tabCount}>{counts.approved}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "rejected" ? styles.tabActive : ""}`}
            onClick={() => setTab("rejected")}
          >
            Rejected
            <span className={styles.tabCount}>{counts.rejected}</span>
          </button>
        </div>
      </div>

      {/* Links List */}
      {filteredLinks.length > 0 ? (
        <div className={styles.linksList}>
          {filteredLinks.map((link) => (
            <div key={link.id} className={styles.linkCard}>
              <div className={styles.linkInfo}>
                <div className={styles.linkAvatar}>
                  {link.student_name.charAt(0).toUpperCase()}
                </div>
                <div className={styles.linkDetails}>
                  <div className={styles.linkStudentName}>{link.student_name}</div>
                  <div className={styles.linkStudentMeta}>
                    {link.grade} • Reg: {link.reg_id || "—"}
                  </div>
                  <div className={styles.linkRelationship}>
                    Relationship: {link.relationship}
                  </div>
                </div>
              </div>

              <div className={styles.linkStatus}>
                {getStatusIcon(link.status)}
                <span className={getStatusClass(link.status)}>
                  {link.status.charAt(0).toUpperCase() + link.status.slice(1)}
                </span>
              </div>

              <div className={styles.linkActions}>
                {link.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => handleCancelLink(link.id)}
                    className="btn btn-outline btn-sm"
                    style={{ padding: "0.25rem 0.5rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, color: "#DC2626", borderColor: "#FECDD3" }}
                  >
                    <TrashIcon width="12" height="12" /> Cancel
                  </button>
                )}
                {link.status === "approved" && (
                  <span style={{ fontSize: "0.75rem", color: "#059669", fontWeight: 600 }}>
                    <CheckIcon width="14" height="14" /> Active
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={tab === "all" ? "No Guardian Links" : `No ${tab.charAt(0).toUpperCase() + tab.slice(1)} Links`}
          description={
            tab === "all"
              ? "You haven't created any guardian-student link requests yet. Create one to start monitoring a student's progress."
              : `No ${tab} link requests found.`
          }
          icon={<UsersIcon width="22" height="22" />}
          action={
            tab === "all" ? (
              <button
                onClick={() => setShowModal(true)}
                className="btn btn-primary btn-sm"
                style={{ padding: "0.35rem 1rem", borderRadius: "8px", fontWeight: 600 }}
              >
                <PlusIcon width="14" height="14" /> Create Link Request
              </button>
            ) : undefined
          }
        />
      )}

      {/* Create Link Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Create Guardian Link Request"
        size="md"
      >
        <form onSubmit={handleCreateLink}>
          <div className={styles.modalContent}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Student ID *</label>
              <input
                type="text"
                required
                className={styles.formInput}
                placeholder="Enter student's registration ID"
                value={form.student_id}
                onChange={(e) => setForm({ ...form, student_id: e.target.value })}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Relationship</label>
              <select
                className={styles.formSelect}
                value={form.relationship}
                onChange={(e) => setForm({ ...form, relationship: e.target.value })}
              >
                <option value="Parent">Parent</option>
                <option value="Guardian">Guardian</option>
                <option value="Uncle/Aunt">Uncle/Aunt</option>
                <option value="Sibling">Sibling</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className={styles.modalFooter}>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              leftIcon={<CheckIcon width="16" height="16" />}
              loading={saving}
            >
              Create Request
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}