"use client";

import { RequireRole } from "../../../components/auth/RequireRole";
import { ReportCardPage } from "../../../components/report-card/ReportCardPage";

export default function TeacherReportCardPage() {
  return (
    <RequireRole role="teacher">
      <ReportCardPage />
    </RequireRole>
  );
}
