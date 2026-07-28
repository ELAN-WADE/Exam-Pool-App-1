"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then(mod => mod.Modal), { ssr: false });
import { UsersIcon, SearchIcon, PlusIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Toast = { type: "success" | "error"; text: string } | null;
type Tab = "all" | "student" | "teacher" | "operator";

const roleBadge: Record<string, string> = {
  student:  "badge-info",
  teacher:  "badge-success",
  operator: "badge-warning",
};

function generateSecureCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "TCH-";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function OperatorUsersPage() {
  return (
    <RequireRole role="operator">
      <UsersContent />
    </RequireRole>
  );
}

function UsersContent() {
  const [users,   setUsers]   = useState<any[]>([]);
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [tab,     setTab]     = useState<Tab>("all");
  const [toast,   setToast]   = useState<Toast>(null);

  const [modal, setModal] = useState<"operator" | "user" | null>(null);
  const [form,  setForm]  = useState<any>({ name: "", email: "", password: "", role: "student", grade: "" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const [resetModal, setResetModal] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = (await api.getUsers()) as any[];
      setUsers(data ?? []);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { refresh(); }, [refresh, selectedSession?.id, selectedTerm?.id]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      const matchTab = tab === "all" || u.role === tab;
      const matchQ   = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      return matchTab && matchQ;
    });
  }, [users, search, tab]);

  const counts = useMemo(() => ({
    all:      users.length,
    student:  users.filter((u) => u.role === "student").length,
    teacher:  users.filter((u) => u.role === "teacher").length,
    operator: users.filter((u) => u.role === "operator").length,
  }), [users]);

  const openOperator = () => { setForm({ name: "", email: "", password: "" }); setModal("operator"); };
  const openUser     = () => { setForm({ name: "", email: "", password: "", role: "student", grade: "" }); setModal("user"); };

  const createOperator = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createOperator({ name: form.name, email: form.email, password: form.password });
      showToast("success", `Operator "${form.name}" created.`);
      setModal(null);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to create operator");
    } finally { setSaving(false); }
  };

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.register({
        name:     form.name,
        email:    form.email,
        password: form.password,
        role:     form.role,
        ...(form.role === "student" ? { grade: form.grade } : {}),
      });
      showToast("success", `${form.role === "teacher" ? "Teacher" : "Student"} "${form.name}" created.`);
      setModal(null);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to create user");
    } finally { setSaving(false); }
  };

  const deactivate = async (u: any) => {
    try {
      await api.deleteUser(u.id);
      showToast("success", `"${u.name}" deactivated.`);
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Deactivate failed");
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      showToast("error", "Password must be at least 8 characters");
      return;
    }
    setResetting(true);
    try {
      await api.resetPassword(resetModal.id, newPassword);
      showToast("success", `Password reset for ${resetModal.name}`);
      setResetModal(null);
      setNewPassword("");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "all",      label: `All (${counts.all})` },
    { key: "student",  label: `Students (${counts.student})` },
    { key: "teacher",  label: `Teachers (${counts.teacher})` },
    { key: "operator", label: `Operators (${counts.operator})` },
  ];

  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Users</h1>
          <p className="pageSubtitle">Manage students, teachers, and operators</p>
        </div>
        <div className={styles.headerActions}>
          <button className={`btn btn-ghost`} onClick={openUser}>
            <PlusIcon width="14" height="14" />
            Add Student / Teacher
          </button>
          <button className={`btn btn-primary`} onClick={openOperator}>
            <PlusIcon width="14" height="14" />
            Add Operator
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button key={t.key} className={`${styles.tabBtn} ${tab === t.key ? styles.tabActive : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className={`searchBar ${styles.search}`}>
        <SearchIcon width="14" height="14" />
        <input placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className={`card ${styles.tableCard}`}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIconWrapper}>
              <UsersIcon width="48" height="48" />
            </div>
            <p>{search ? "No users match your search." : "No users in this group."}</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>User</th>
                <th>Reg ID</th>
                <th>Email</th>
                <th>Role</th>
                <th>Grade</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className={styles.userCell}>
                      <div className={styles.avatar}>{u.name?.charAt(0)?.toUpperCase()}</div>
                      <span style={{ fontWeight: 500 }}>{u.name}</span>
                    </div>
                  </td>
                  <td><code className={styles.code}>{u.reg_id || "—"}</code></td>
                  <td style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>{u.email}</td>
                  <td><span className={`badge ${roleBadge[u.role] ?? "badge-muted"}`}>{u.role}</span></td>
                  <td style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>{u.grade || "—"}</td>
                  <td>
                    <span className={`badge ${u.is_active ? "badge-success" : "badge-danger"}`}>
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      {u.is_active ? (
                        <>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => { setResetModal(u); setNewPassword(""); }}
                          >
                            Reset Pwd
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger-border)" }}
                            onClick={() => setConfirmDelete(u)}
                          >
                            Deactivate
                          </button>
                        </>
                      ) : (
                        <span style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>Inactive</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add Operator Modal ── */}
      <Modal open={modal === "operator"} onClose={() => setModal(null)} size="sm">
        <h2>Add Operator</h2>
        <p className="modal-desc">Operators have full admin access to the platform.</p>
        <form onSubmit={createOperator} className={styles.form}>
          <div className="field">
            <label>Full Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. John Smith" required />
          </div>
          <div className="field">
            <label>Email *</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@school.edu" required />
          </div>
          <div className="field">
            <label>Password *</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" required />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Creating…" : "Create Operator"}</button>
          </div>
        </form>
      </Modal>

      {/* ── Add Student / Teacher Modal ── */}
      <Modal open={modal === "user"} onClose={() => setModal(null)} size="sm">
        <h2>Add {form.role === "teacher" ? "Teacher" : "Student"}</h2>
        <form onSubmit={createUser} className={styles.form}>
          <div className="field">
            <label>Role</label>
            <div className={styles.roleToggle}>
              <button type="button" className={`${styles.roleBtn} ${form.role === "student" ? styles.roleBtnActive : ""}`} onClick={() => setForm({ ...form, role: "student" })}>Student</button>
              <button type="button" className={`${styles.roleBtn} ${form.role === "teacher" ? styles.roleBtnActive : ""}`} onClick={() => setForm({ ...form, role: "teacher" })}>Teacher</button>
            </div>
          </div>
          <div className="field">
            <label>Full Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" required />
          </div>
          <div className="field">
            <label>Email *</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@school.edu" required />
          </div>
          <div className="field">
            <label>Password *</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" required style={{ flex: 1 }} />
              {form.role === "teacher" && (
                <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...form, password: generateSecureCode() })}>Generate Code</button>
              )}
            </div>
            {form.password && form.role === "teacher" && form.password.startsWith("TCH-") && (
              <div style={{ fontSize: "0.85rem", color: "var(--color-primary)", marginTop: "0.4rem" }}>
                Teacher Code: <strong>{form.password}</strong> (Share this with the teacher)
              </div>
            )}
          </div>
          {form.role === "student" && (
            <div className="field">
              <label>Grade / Class *</label>
              <input className="input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="e.g. Grade 10A" required />
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Creating…" : `Create ${form.role === "teacher" ? "Teacher" : "Student"}`}</button>
          </div>
        </form>
      </Modal>

      {/* ── Deactivate Confirm Modal ── */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} size="sm">
        <h2>Deactivate User?</h2>
        <p className="modal-desc">
          <strong style={{ color: "var(--color-text)" }}>{confirmDelete?.name}</strong> will be deactivated and unable to log in.
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => deactivate(confirmDelete)}>Deactivate</button>
        </div>
      </Modal>

      {/* ── Reset Password Modal ── */}
      <Modal open={!!resetModal} onClose={() => { setResetModal(null); setNewPassword(""); }} size="sm">
        <h2>Reset Password</h2>
        <p className="modal-desc">
          Set a new password for <strong style={{ color: "var(--color-text)" }}>{resetModal?.name}</strong>.
        </p>
        <form onSubmit={handleResetPassword} className={styles.form}>
          <div className="field">
            <label>New Password *</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                required
                minLength={8}
                autoFocus
                style={{ flex: 1 }}
              />
              {resetModal?.role === "teacher" && (
                <button type="button" className="btn btn-ghost" onClick={() => setNewPassword(generateSecureCode())}>Generate Code</button>
              )}
            </div>
            {newPassword && resetModal?.role === "teacher" && newPassword.startsWith("TCH-") && (
              <div style={{ fontSize: "0.85rem", color: "var(--color-primary)", marginTop: "0.4rem" }}>
                New Teacher Code: <strong>{newPassword}</strong> (Share this with the teacher)
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setResetModal(null); setNewPassword(""); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={resetting}>{resetting ? "Resetting…" : "Reset Password"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
