"use client";

import React, { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { CheckCircleIcon, WarningIcon } from "../components/icons/Icons";

type ToastType = "success" | "error";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500); // Remove after animation
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div style={{ position: "fixed", bottom: "1rem", right: "1rem", zIndex: 9999, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`} style={{ position: "static", animation: "toastIn 300ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
              {toast.type === "success" ? (
                <CheckCircleIcon width="20" height="20" style={{ color: "var(--color-success)" }} />
              ) : (
                <WarningIcon width="20" height="20" style={{ color: "var(--color-danger)" }} />
              )}
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
