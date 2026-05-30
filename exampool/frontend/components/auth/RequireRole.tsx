"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

type Props = {
  role: "student" | "teacher" | "operator";
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
        if (normalizePath(pathname) !== "/setup") router.replace("/setup/");
      } else {
        router.replace("/");
      }
      return;
    }
    if (user.role !== role) {
      router.replace("/");
    }
  }, [isLoading, isAuthenticated, user, role, router, setupRequired, pathname]);

  if (isLoading || !isAuthenticated || !user || user.role !== role) {
    return <main style={{ padding: "2rem" }}>Loading...</main>;
  }

  return <>{children}</>;
}
