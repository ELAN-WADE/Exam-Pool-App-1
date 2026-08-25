import React from "react";
import { WarningIcon } from "../icons/Icons";
import styles from "./ErrorState.module.css";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.container}>
      <div className={styles.iconWrapper}>
        <WarningIcon width="32" height="32" style={{ color: "var(--color-danger)" }} />
      </div>
      <h3 className={styles.title}>Something went wrong</h3>
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button className="btn btn-primary" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  );
}
