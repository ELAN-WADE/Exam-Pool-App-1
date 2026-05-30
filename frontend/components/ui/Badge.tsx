import type { HTMLAttributes } from "react";
import styles from "./Badge.module.css";

type Variant = "default" | "success" | "warning" | "danger";
type Props = HTMLAttributes<HTMLSpanElement> & { variant?: Variant; className?: string };

export function Badge({ variant = "default", className = "", ...props }: Props) {
  return <span className={[styles.badge, styles[variant], className].filter(Boolean).join(" ")} {...props} />;
}
