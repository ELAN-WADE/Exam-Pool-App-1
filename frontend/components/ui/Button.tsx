import React, { type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "dangerOutline" | "success";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  leftIcon,
  rightIcon,
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const cls = [
    styles.button,
    styles[variant],
    styles[size],
    loading ? styles.loading : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <button
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        leftIcon && <span className="inline-flex items-center">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="inline-flex items-center">{rightIcon}</span>}
    </button>
  );
}
