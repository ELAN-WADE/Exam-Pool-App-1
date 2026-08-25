"use client";

import { RequireRole } from "../../../components/auth/RequireRole";
import { ReportCardPage } from "../../../components/report-card/ReportCardPage";

export default function StudentReportCardPage() {
  return (
    <RequireRole role="student">
      <ReportCardPage />
    </RequireRole>
  );
}
