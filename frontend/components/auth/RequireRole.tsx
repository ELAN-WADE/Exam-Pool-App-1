"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

type Props = {
  role: "student" | "teacher" | "operator" | "guardian";
  children: React.ReactNode;
};

export function RequireRole({ role, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, isAuthenticated, setupRequired } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      if (setupRequired) {
        if (normalizePath(pathname) !== "/setup") {
          router.replace("/setup/");
        }
      } else {
        router.replace("/");
      }
      return;
    }
    if (user.role !== role) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, user, role, setupRequired, pathname, router]);

  if (isLoading || !isAuthenticated || !user || user.role !== role) {
    return (
      <main style={{ padding: "2rem", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 1rem" }} />
          <p style={{ color: "var(--color-muted)" }}>Loading...</p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
