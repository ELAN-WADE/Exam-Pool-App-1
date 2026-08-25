"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { StudentTopBar } from "../../components/ui/StudentTopBar";
import { AcademicProvider } from "../../components/context/AcademicContext";
import styles from "./layout.module.css";

export default function StudentLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Keep exam hall completely clean and full-screen
  if (pathname === "/student/exam" || pathname === "/student/exam/") {
    return <>{children}</>;
  }

  return (
    <AcademicProvider>
      <div className={styles.wrapper}>
        <StudentTopBar />
        <main className={styles.mainContent}>
          {children}
        </main>
      </div>
    </AcademicProvider>
  );
}
