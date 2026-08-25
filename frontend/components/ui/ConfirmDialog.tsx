"use client";

import React from "react";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("./Modal").then((m) => m.Modal), { ssr: false });

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <h2>{title}</h2>
      <p className="modal-desc">{message}</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </button>
        <button
          className={`btn btn-${variant}`}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? "Processing..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
