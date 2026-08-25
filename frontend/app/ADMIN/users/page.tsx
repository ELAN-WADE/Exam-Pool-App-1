"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import type { User } from "../../../lib/types";
import { PageHeader, Badge, Button, Modal, EmptyState, ConfirmDialog } from "../../../components/ui";
import {
  PlusIcon,
  TrashIcon,
  UsersIcon,
  SearchIcon,
  CheckCircleIcon,
  WarningIcon,
  CheckIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Toast = { type: "success" | "error"; text: string } | null;

function generateSecureCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "TCH-";
  const randomArray = new Uint32Array(6);
  window.crypto.getRandomValues(randomArray);
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(randomArray[i] % chars.length);
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
  const [users, setUsers] = useState<User[]>([]);
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [toast, setToast] = useState<Toast>(null);

  const [gradeLevels, setGradeLevels] = useState<any[]>([]);
  const [modal, setModal] = useState<"operator" | "user" | null>(null);
  const [form, setForm] = useState<any>({
    name: "",
    email: "",
    password: "",
    role: "student",
    grade_level_id: "",
    dob: "",
    phone: "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [resetModal, setResetModal] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true);
        const [userData, glData] = await Promise.all([
          api.getUsers(),
          api.getGradeLevels(),
        ]);
        if (signal?.aborted) return;
        setUsers((userData as User[]) ?? []);
        setGradeLevels(glData?.grades ?? []);
      } catch (err) {
        if (!signal?.aborted)
          showToast("error", err instanceof Error ? err.message : "Failed to load users");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, selectedSession?.id, selectedTerm?.id]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      const matchTab = tab === "all" || u.role === tab;
      const matchQ =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.grade && u.grade.toLowerCase().includes(q));
      return matchTab && matchQ;
    });
  }, [users, search, tab]);

  const counts = useMemo(
    () => ({
      all: users.length,
      student: users.filter((u) => u.role === "student").length,
      teacher: users.filter((u) => u.role === "teacher").length,
      guardian: users.filter((u) => u.role === "guardian").length,
      operator: users.filter((u) => u.role === "operator").length,
    }),
    [users]
  );

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      showToast("error", "Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      if (modal === "operator") {
        await api.createOperator({ name: form.name, email: form.email, password: form.password });
        showToast("success", `Operator "${form.name}" created successfully.`);
      } else {
        await api.register({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          grade_level_id:
            form.role === "student" ? Number(form.grade_level_id) || undefined : undefined,
          dob: form.role === "student" ? form.dob || undefined : undefined,
          phone: form.role === "teacher" ? form.phone || undefined : undefined,
        });
        showToast("success", `User "${form.name}" created successfully.`);
      }
      setModal(null);
      setForm({ name: "", email: "", password: "", role: "student", grade_level_id: "", dob: "", phone: "" });
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Creation failed");
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (user: User) => {
    try {
      await api.activateUser(user.id);
      showToast("success", `User "${user.name}" activated.`);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to activate user");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.deleteUser(confirmDelete.id);
      showToast("success", `User "${confirmDelete.name}" removed.`);
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    const pwd = newPassword.trim();
    if (!resetModal || !pwd) {
      showToast("error", "Please provide a new password");
      return;
    }
    if (pwd.length < 4) {
      showToast("error", "Password must be at least 4 characters");
      return;
    }
    setResetting(true);
    try {
      await api.resetPassword(resetModal.id, pwd);
      showToast("success", `Password successfully reset for ${resetModal.name}`);
      setResetModal(null);
      setNewPassword("");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Toast Notification */}
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.type === "success" ? styles.toastSuccess : styles.toastError
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* ── Page Header ── */}
      <PageHeader
        eyebrow="Administration"
        title="Users & Access Control"
        subtitle="Manage student cohorts, faculty members, and administrative operator accounts."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<UsersIcon width="14" height="14" />}
              onClick={() => {
                setForm({ name: "", email: "", password: "", role: "operator" });
                setModal("operator");
              }}
            >
              + New Operator
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<PlusIcon width="14" height="14" />}
              onClick={() => {
                setForm({ name: "", email: "", password: "", role: "student", grade_level_id: "", dob: "", phone: "" });
                setModal("user");
              }}
            >
              Register User
            </Button>
          </div>
        }
      />

      {/* ── 1. Unified Command Strip (Tabs + Filter/Search) ── */}
      <div className={styles.commandStrip}>
        <div className={styles.tabList}>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "all" ? styles.tabActive : ""}`}
            onClick={() => setTab("all")}
          >
            All Accounts
            <span className={styles.tabCount}>{counts.all}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "student" ? styles.tabActive : ""}`}
            onClick={() => setTab("student")}
          >
            Students
            <span className={styles.tabCount}>{counts.student}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "teacher" ? styles.tabActive : ""}`}
            onClick={() => setTab("teacher")}
          >
            Teachers
            <span className={styles.tabCount}>{counts.teacher}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "guardian" ? styles.tabActive : ""}`}
            onClick={() => setTab("guardian")}
          >
            Guardians
            <span className={styles.tabCount}>{counts.guardian}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${tab === "operator" ? styles.tabActive : ""}`}
            onClick={() => setTab("operator")}
          >
            Operators
            <span className={styles.tabCount}>{counts.operator}</span>
          </button>
        </div>

        <div className={styles.searchWrapper}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search name, email, cohort..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>
      </div>

      {/* ── 2. Invisible Data Table Container ── */}
      <div className={styles.tableContainer}>
        {loading ? (
          <div className={styles.emptyState}>
            <div className="w-8 h-8 border-2 border-slate-700 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <div className={styles.emptySubtitle}>Loading directory accounts...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <EmptyState
              title="No Users Found"
              description={
                search
                  ? "No accounts match your search filters. Try clearing your search query."
                  : "No registered accounts found under this tab category."
              }
              action={
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<PlusIcon width="14" height="14" />}
                  onClick={() => {
                    setForm({ name: "", email: "", password: "", role: "student", grade_level_id: "", dob: "", phone: "" });
                    setModal("user");
                  }}
                >
                  Register User
                </Button>
              }
            />
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.minimalTable}>
              <thead>
                <tr>
                  <th scope="col">User / Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Class / Cohort</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const roleClass =
                    u.role === "operator"
                      ? styles.roleOperator
                      : u.role === "teacher"
                      ? styles.roleTeacher
                      : styles.roleStudent;

                  return (
                    <tr key={u.id} className={styles.rowHover}>
                      {/* User Name & Mono Email */}
                      <td>
                        <div className={styles.userCell}>
                          <span className={styles.userName}>{u.name}</span>
                          <span className={styles.userEmail}>{u.email}</span>
                        </div>
                      </td>

                      {/* Role with deliberate typographic treatment */}
                      <td>
                        <span className={`${styles.roleCell} ${roleClass}`}>{u.role}</span>
                      </td>

                      {/* Cohort / Grade Level */}
                      <td>
                        <span className={u.grade ? styles.cohortCell : styles.cohortEmpty}>
                          {u.grade || "None assigned"}
                        </span>
                      </td>

                      {/* Status */}
                      <td>
                        {u.is_active ? (
                          <div className={`${styles.statusCell} ${styles.statusActive}`}>
                            <span className={`${styles.statusDot} ${styles.statusDotActive}`} />
                            Active
                          </div>
                        ) : (
                          <div className={`${styles.statusCell} ${styles.statusInactive}`}>
                            <span className={`${styles.statusDot} ${styles.statusDotInactive}`} />
                            <button
                              type="button"
                              onClick={() => handleActivate(u)}
                              className={styles.activateBtn}
                              title="Click to activate account"
                            >
                              Activate
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Progressive Disclosure Actions */}
                      <td>
                        <div className={styles.actionsCell}>
                          <Button
                            variant="ghost"
                            size="xs"
                            className={styles.actionTextBtn}
                            onClick={() => {
                              setResetModal(u);
                              setNewPassword("");
                            }}
                          >
                            Reset Pwd
                          </Button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(u)}
                            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                            title={`Delete ${u.name}`}
                          >
                            <TrashIcon width="14" height="14" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MODAL 1: CREATE USER / OPERATOR ── */}
      <Modal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal === "operator" ? "Create Administrator Operator" : "Register New Account"}
        size="md"
      >
        <form onSubmit={handleCreateUser}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              Full Name <span className={styles.requiredAsterisk}>*</span>
            </label>
            <input
              type="text"
              required
              className={styles.formInput}
              placeholder="e.g. Samuel Adebayo"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              Email / Username <span className={styles.requiredAsterisk}>*</span>
            </label>
            <input
              type="email"
              required
              className={styles.formInput}
              placeholder="e.g. samuel@school.edu.ng"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          {modal === "user" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className={styles.formLabel}>
                  Account Role <span className={styles.requiredAsterisk}>*</span>
                </label>
                <select
                  className={styles.formSelect}
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="student">Student / Candidate</option>
                  <option value="teacher">Faculty / Teacher</option>
                  <option value="guardian">Guardian / Parent</option>
                </select>
              </div>
              {form.role === "teacher" && (
                <div>
                  <label className={styles.formLabel}>Phone <span className={styles.requiredAsterisk}>*</span></label>
                  <input
                    type="tel"
                    className={styles.formInput}
                    placeholder="080..."
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                </div>
              )}

              {form.role === "student" && (
                <>
                  <div>
                    <label className={styles.formLabel}>Grade Level / Class</label>
                    <select
                      className={styles.formSelect}
                      value={form.grade_level_id}
                      onChange={(e) => setForm({ ...form, grade_level_id: e.target.value })}
                    >
                      <option value="">Select class...</option>
                      {gradeLevels.map((gl) => (
                        <option key={gl.id} value={gl.id}>
                          {gl.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={styles.formLabel}>Date of Birth <span className={styles.requiredAsterisk}>*</span></label>
                    <input
                      type="date"
                      className={styles.formInput}
                      value={form.dob}
                      onChange={(e) => setForm({ ...form, dob: e.target.value })}
                      required
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className={styles.formGroup}>
            <div className="flex items-center justify-between mb-1">
              <label className={styles.formLabel}>
                Password <span className={styles.requiredAsterisk}>*</span>
              </label>
              <button
                type="button"
                className="text-[11px] font-bold text-slate-700 hover:text-black hover:underline cursor-pointer"
                onClick={() => setForm({ ...form, password: generateSecureCode() })}
              >
                Generate Passcode
              </button>
            </div>
            <input
              type="text"
              required
              className={`${styles.formInput} ${styles.formInputMono}`}
              placeholder="Enter or generate password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>

          <div className={styles.modalFooter}>
            <Button type="button" variant="outline" size="md" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              leftIcon={<CheckIcon width="16" height="16" />}
              loading={saving}
            >
              Create Account
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL 2: RESET PASSWORD ── */}
      <Modal
        open={Boolean(resetModal)}
        onClose={() => setResetModal(null)}
        title={`Reset Password: ${resetModal?.name || ""}`}
        size="md"
      >
        <form onSubmit={handleResetPassword}>
          <p className="text-xs text-slate-600 mb-4">
            Enter a new access password for account <strong>{resetModal?.email}</strong>.
          </p>

          <div className={styles.formGroup}>
            <div className="flex items-center justify-between mb-1">
              <label className={styles.formLabel}>
                New Password <span className={styles.requiredAsterisk}>*</span>
              </label>
              <button
                type="button"
                className="text-[11px] font-bold text-slate-700 hover:text-black hover:underline cursor-pointer"
                onClick={() => setNewPassword(generateSecureCode())}
              >
                Generate Passcode
              </button>
            </div>
            <input
              type="text"
              required
              className={`${styles.formInput} ${styles.formInputMono}`}
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className={styles.modalFooter}>
            <Button type="button" variant="outline" size="md" onClick={() => setResetModal(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              leftIcon={<CheckIcon width="16" height="16" />}
              loading={resetting}
            >
              Update Password
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── CONFIRM DIALOG: DELETE USER ── */}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Confirm Account Deletion"
        message={`Are you sure you want to permanently delete account "${confirmDelete?.name}" (${confirmDelete?.email})? This action cannot be reversed.`}
      />
    </div>
  );
}
