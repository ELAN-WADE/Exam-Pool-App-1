import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  className?: string;
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: Props) {
  const cls = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  return <button className={cls} {...props} />;
}
