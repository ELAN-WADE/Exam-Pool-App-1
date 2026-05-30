import type { HTMLAttributes } from "react";
import styles from "./Card.module.css";

type Props = HTMLAttributes<HTMLDivElement> & { className?: string };

export function Card({ className = "", ...props }: Props) {
  return <div className={[styles.card, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardHeader({ className = "", ...props }: Props) {
  return <div className={[styles.header, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardTitle({ className = "", ...props }: HTMLAttributes<HTMLHeadingElement> & { className?: string }) {
  return <h3 className={[styles.title, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardContent({ className = "", ...props }: Props) {
  return <div className={[styles.content, className].filter(Boolean).join(" ")} {...props} />;
}
