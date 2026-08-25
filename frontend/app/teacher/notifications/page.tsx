"use client";

import { RequireRole } from "../../../components/auth/RequireRole";
import { NotificationsPage } from "../../../components/ui/NotificationsPage";

export default function TeacherNotificationsRoute() {
  return (
    <RequireRole role="teacher">
      <NotificationsPage />
    </RequireRole>
  );
}
