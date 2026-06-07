"use client";

import { RequireRole } from "../../../components/auth/RequireRole";
import { ReportCardPage } from "../../../components/report-card/ReportCardPage";

export default function OperatorReportCardPage() {
  return (
    <RequireRole role="operator">
      <ReportCardPage />
    </RequireRole>
  );
}
