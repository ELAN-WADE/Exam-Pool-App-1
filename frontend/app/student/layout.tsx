"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Sidebar } from "../../components/ui/Sidebar";
import { TopBar } from "../../components/ui/TopBar";

const studentNav = [
  {
    href: "/student/dashboard",
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },

  {
    href: "/student/settings",
    label: "Settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M2 12h2M20 12h2M19.07 19.07l-1.41-1.41M4.93 19.07l1.41-1.41" />
      </svg>
    ),
  },
];

export default function StudentLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="shell">
      <Sidebar
        items={studentNav}
        title="Student"
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="shellMain">
        <TopBar onMenuClick={() => setSidebarOpen((v) => !v)} />
        <main className="shellContent">
          {children}
        </main>
      </div>
    </div>
  );
}
