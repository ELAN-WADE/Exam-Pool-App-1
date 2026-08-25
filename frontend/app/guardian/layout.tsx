"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AcademicProvider } from "../../components/context/AcademicContext";
import { GuardianProvider } from "../../components/guardian/GuardianContext";
import { GuardianMobileShell } from "../../components/guardian/GuardianMobileShell";
import "./design-tokens.css";

export default function GuardianLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const lowerPath = (pathname || "").toLowerCase();

  // Do not wrap the guardian login page in the mobile app shell
  if (lowerPath === "/guardian" || lowerPath === "/guardian/") {
    return <>{children}</>;
  }

  return (
    <AcademicProvider>
      <GuardianProvider>
        <GuardianMobileShell>{children}</GuardianMobileShell>
      </GuardianProvider>
    </AcademicProvider>
  );
}

