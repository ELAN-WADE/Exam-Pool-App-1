import type { InputHTMLAttributes } from "react";
import styles from "./Input.module.css";

type InputType = "text" | "email" | "password" | "number" | "datetime-local";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: InputType;
  className?: string;
};

export function Input({ type = "text", className = "", ...props }: Props) {
  return <input type={type} className={[styles.input, className].filter(Boolean).join(" ")} {...props} />;
}
