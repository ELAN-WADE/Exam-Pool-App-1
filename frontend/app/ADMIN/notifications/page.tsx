"use client";

import { RequireRole } from "../../../components/auth/RequireRole";
import { NotificationsPage } from "../../../components/ui/NotificationsPage";

export default function AdminNotificationsRoute() {
  return (
    <RequireRole role="operator">
      <NotificationsPage />
    </RequireRole>
  );
}
