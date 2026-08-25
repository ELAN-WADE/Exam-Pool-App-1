import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeVariant = "default" | "neutral" | "primary" | "info" | "success" | "warning" | "danger" | "purple";
export type BadgeSize = "sm" | "md";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  size?: BadgeSize;
  rounded?: boolean;
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Badge({
  variant = "default",
  size = "md",
  rounded = false,
  dot = false,
  icon,
  className = "",
  children,
  ...props
}: BadgeProps) {
  const cls = [
    styles.badge,
    styles[variant],
    styles[size],
    rounded ? styles.rounded : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <span className={cls} {...props}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {icon && <span className="inline-flex items-center text-[0.85em]">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
