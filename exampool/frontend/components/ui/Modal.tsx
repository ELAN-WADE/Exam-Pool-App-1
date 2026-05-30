import type { ReactNode } from "react";
import { CloseIcon } from "../icons/Icons";
import styles from "./Modal.module.css";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  size?: ModalSize;
  hideCloseButton?: boolean;
};

export function Modal({ open, onClose, children, className = "", size = "md", hideCloseButton = false }: Props) {
  if (!open) return null;
  
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div 
        className={`${styles.modal} ${styles[`size-${size}`]} ${className}`.trim()} 
        onClick={(e) => e.stopPropagation()}
      >
        {!hideCloseButton && (
          <button className={styles.close} onClick={onClose} aria-label="Close modal" type="button">
            <CloseIcon width="20" height="20" />
          </button>
        )}
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
