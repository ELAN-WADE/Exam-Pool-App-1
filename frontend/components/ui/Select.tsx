import type { SelectHTMLAttributes } from "react";
import styles from "./Select.module.css";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { className?: string };

export function Select({ className = "", ...props }: Props) {
  return <select className={[styles.select, className].filter(Boolean).join(" ")} {...props} />;
}
