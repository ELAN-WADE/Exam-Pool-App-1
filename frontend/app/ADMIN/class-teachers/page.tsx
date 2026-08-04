"use client";

import { RequireRole } from "../../../components/auth/RequireRole";
import { AssignClassTeacherPage } from "../../../components/admin/AssignClassTeacherPage";

export default function ClassTeachersRoute() {
  return (
    <RequireRole role="operator">
      <AssignClassTeacherPage />
    </RequireRole>
  );
}
