"use client";

import React, { ReactNode } from "react";
import { CloseIcon } from "../icons/Icons";
import styles from "./Modal.module.css";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  size?: ModalSize;
  hideCloseButton?: boolean;
};

export function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
  size = "md",
  hideCloseButton = false,
}: ModalProps) {
  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles[`size-${size}`]} ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            {!hideCloseButton && (
              <button
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
                onClick={onClose}
              >
                <CloseIcon width="16" height="16" />
              </button>
            )}
          </div>
        )}
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
