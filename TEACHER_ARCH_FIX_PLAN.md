# Teacher Architecture Fix Plan
**Generated:** 2026-08-17 | **Based on:** Deep audit of `server.ts`, `db.ts`, `auth.ts`

---

## Phase 0: Foundation (Week 1) — Core Infrastructure

### 0.1 Centralized Authorization Service
**File:** `src/services/authorization.service.ts` (NEW)
```typescript
export class AuthorizationService {
  constructor(private db: Database, private queries: any) {}

  async canAccessSubject(auth: Auth, subjectId: number, action: SubjectAction): Promise<boolean>
  async canAccessGradingSubject(auth: Auth, gsId: number, action: GradingAction): Promise<boolean>
  async canManageEnrollment(auth: Auth, subjectId: number): Promise<boolean>
  async isClassTeacherForStudent(auth: Auth, studentId: number): Promise<boolean>
  async getTeacherSubjects(auth: Auth): Promise<number[]>
}
```
- **Replace** 37 `sameUserId()` calls across routes
- **Declarative policies** per resource/action
- **Unit testable** with mock DB

### 0.2 Permission-Based RBAC Migration
**Files:** `db.ts`, `validation.ts`, `src/types/index.ts`
```sql
-- Add permissions table
CREATE TABLE role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

-- Seed default permissions
INSERT INTO role_permissions VALUES 
  ('teacher', 'subject:create'), ('teacher', 'subject:read:own'),
  ('teacher', 'question:manage:own'), ('teacher', 'enrollment:manage:own'),
  ('teacher', 'grade:essay:own'), ('teacher', 'grade:ca:own'),
  ('teacher', 'results:read:own'), ('teacher', 'results:publish:own'),
  ('operator', '*'), ('student', 'exam:take'), ('student', 'results:read:own');
```

---

## Phase 1: Teacher Autonomy (Week 1-2) — P0 Fixes

### 1.1 Teacher Enrollment Management
**File:** `server.ts:3196-3265`
```typescript
// CHANGE: POST /api/subjects/:id/students
// FROM: requireRole(auth.role, ["operator"])
// TO:   requireRole(auth.role, ["teacher", "operator"])
// ADD:  ownership check via authz.canManageEnrollment()

// CHANGE: DELETE /api/subjects/:id/students/:studentId  
// FROM: requireRole(auth.role, ["operator"])
// TO:   requireRole(auth.role, ["teacher", "operator"])
// ADD:  ownership check + completed exam guard (keep)
```

### 1.2 Teacher Subject Delete/Archive
**File:** `server.ts:3013-3023`
```typescript
// CHANGE: DELETE /api/subjects/:id
// FROM: requireRole(auth.role, ["operator"])
// TO:   requireRole(auth.role, ["teacher", "operator"])
// ADD:  ownership check + no-completed-exams guard
// ADD:  Soft delete (archived_at) instead of hard delete
```

**DB Migration:** `db.ts` — add `archived_at` to subjects table

### 1.3 Publish Gate for Class Teacher View
**Files:** `db.ts` (schema), `server.ts:2114-2119` (class-center), `server.ts:1540-1662` (grading/subjects)
```sql
-- Add to grading_subjects
ALTER TABLE grading_subjects ADD COLUMN is_published_to_class INTEGER NOT NULL DEFAULT 0;
```

```typescript
// CHANGE: class-center query
WHERE gs.term_id = ? AND gs.session_id = ? AND gs.is_published_to_class = 1

// ADD: POST /api/grading/subjects/:id/publish-to-class (teacher only)
// ADD: POST /api/grading/subjects/:id/unpublish-from-class (teacher only)
```

### 1.4 Grading Policy Row-Level Security
**File:** `server.ts` (new routes)
```typescript
// ADD: GET /api/grading/policies/:subjectId — ownership check
// ADD: PUT /api/grading/policies/:subjectId — ownership check  
// ADD: Audit log on policy changes
```

---

## Phase 2: Authorization Hardening (Week 2) — P1 Fixes

### 2.1 Class Teacher Per-Request Verification
**File:** `server.ts:386-405` (stripPassword), `server.ts:2092-2105` (class-center)
```typescript
// REMOVE: Class teacher status from login token
// ADD: Per-request check via authz.isClassTeacherForStudent()
// ADD: Cache with 5-min TTL to avoid N+1 queries
```

### 2.2 Grading Config Teacher Access
**File:** `server.ts:1522-1536`
```typescript
// CHANGE: GET/PUT /api/grading/config
// FROM: requireRole(auth.role, ["operator"])
// TO:   requireRole(auth.role, ["teacher", "operator"])
// ADD: Teacher sees read-only; Operator read-write
```

### 2.3 Rate Limiting on Grading Operations
**File:** `server.ts:1540-1750`
```typescript
// ADD: checkRateLimit(`grading_${auth.userId}`, 100, 60_000) on:
//   - POST /api/grading/subjects
//   - PUT /api/grading/policies/:id
//   - POST /api/grading/scores/:id
//   - POST /api/grading/approve/:id
```

---

## Phase 3: Enhanced Features (Week 3) — P2 Improvements

### 3.1 Subject Archival (vs Delete)
**Files:** `db.ts`, `server.ts`
```sql
-- Add to subjects
ALTER TABLE subjects ADD COLUMN archived_at TEXT;
CREATE INDEX idx_subjects_archived ON subjects(archived_at);
```

```typescript
// Teacher: Soft delete (archived_at = now)
// Operator: Hard delete (only if no exams)
// GET /api/subjects: Exclude archived by default; ?include_archived=1
```

### 3.2 Class Teacher Opt-In for Grading Subjects
**Files:** `db.ts`, `server.ts:1540-1662`, `server.ts:2114-2119`
```sql
-- Add to grading_subjects
ALTER TABLE grading_subjects ADD COLUMN class_teacher_opt_in INTEGER NOT NULL DEFAULT 0;
```

```typescript
// Teacher: POST /api/grading/subjects/:id/class-opt-in
// Class Teacher: Sees only opted-in subjects in class-center
// Operator: Can override
```

### 3.3 Grading Policy Change Audit
**File:** `server.ts` (new audit calls)
```typescript
// ADD: auditLog on CREATE/UPDATE/DELETE grading_policies
// ACTION: "GRADING_POLICY_CREATE" | "GRADING_POLICY_UPDATE" | "GRADING_POLICY_DELETE"
// RESOURCE: "grading_policy"
// DETAILS: { old: {...}, new: {...} }
```

### 3.4 Enrollment Audit Enhancement
**File:** `db.ts:1211-1212`, `server.ts:3230-3247`
```sql
-- Add to subject_enrollments
ALTER TABLE subject_enrollments ADD COLUMN enrolled_by_role TEXT;
```

```typescript
// Record teacher vs operator enrollment
```

---

## Phase 4: Advanced RBAC (Week 4) — Future-Proofing

### 4.1 Permission Middleware
**File:** `src/middleware/requirePermission.ts` (NEW)
```typescript
export function requirePermission(permission: string) {
  return async (req: Request, auth: Auth) => {
    const hasPerm = await authz.hasPermission(auth, permission);
    if (!hasPerm) throw new HttpError(403, `Requires permission: ${permission}`);
  };
}
```

### 4.2 Replace All `requireRole` Calls
```typescript
// BEFORE: requireRole(auth.role, ["teacher", "operator"])
// AFTER:  await requirePermission("subject:read")(req, auth)
```

### 4.3 Admin Permission Management UI
- Operator endpoint: `PUT /api/roles/:role/permissions`
- Audit all permission changes

---

## Implementation Checklist

### Week 1: Foundation + Teacher Autonomy
- [ ] Create `AuthorizationService` class
- [ ] Add `archived_at` to subjects table
- [ ] Enable teacher enrollment management (POST/DELETE `/subjects/:id/students`)
- [ ] Enable teacher subject soft-delete
- [ ] Add `is_published_to_class` flag + publish/unpublish endpoints
- [ ] Add grading policy RLS + audit

### Week 2: Authorization Hardening
- [ ] Move class teacher check to per-request
- [ ] Add teacher read access to grading config
- [ ] Add rate limiting on grading endpoints
- [ ] Add enrollment audit enhancement

### Week 3: Enhanced Features
- [ ] Subject archival UI + API
- [ ] Class teacher opt-in flag + filtering
- [ ] Grading policy change audit
- [ ] Integration tests for all P0/P1 fixes

### Week 4: Advanced RBAC
- [ ] Permission middleware
- [ ] Gradual migration from `requireRole` to `requirePermission`
- [ ] Admin permission management
- [ ] Documentation + runbook

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing teacher workflows | Feature flags per change; gradual rollout |
| Performance regression from authz checks | Redis cache for `getTeacherSubjects()`; 5-min TTL |
| Data loss on subject delete | Soft delete default; hard delete operator-only with confirmation |
| Class teacher sees empty results | Default `is_published_to_class=1` for existing; new subjects default=0 |

---

## Testing Strategy

### Unit Tests (Jest)
```typescript
// src/services/authorization.service.test.ts
describe('AuthorizationService', () => {
  test('teacher can access own subject', () => {});
  test('teacher cannot access other teacher subject', () => {});
  test('class teacher sees opted-in subjects only', () => {});
  test('operator bypasses all checks', () => {});
});
```

### Integration Tests (Existing test suite)
```bash
# Run after each phase
bun test tests/auth.test.ts
bun test tests/subjects.test.ts
bun test tests/exams.test.ts
bun test tests/grading.test.ts  # NEW
```

### E2E Scenarios
1. Teacher creates subject → adds questions → publishes → students take exam → teacher grades → publishes to class teacher → class teacher generates report cards
2. Operator assigns subject to teacher → teacher manages enrollments → teacher archives subject
3. Teacher tries to access other teacher's grading policies → 403

---

## Rollback Plan

Each phase deployed behind feature flag:
```typescript
const FEATURES = {
  TEACHER_ENROLLMENT: Bun.env.FEATURE_TEACHER_ENROLLMENT === 'true',
  SUBJECT_ARCHIVAL: Bun.env.FEATURE_SUBJECT_ARCHIVAL === 'true',
  PUBLISH_GATE: Bun.env.FEATURE_PUBLISH_GATE === 'true',
  CLASS_OPT_IN: Bun.env.FEATURE_CLASS_OPT_IN === 'true',
};
```

Rollback: Set env var to `false` → restart server.

---

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Teacher enrollment API calls | 0 (operator only) | >50/day |
| Subject deletions by teachers | 0 | >5/week |
| Grading policy audit entries | 0 | 100% coverage |
| Class teacher unauthorized access | N/A (no control) | 0 incidents |
| Authorization check latency | N/A (inline) | <5ms p99 |

---

## File Inventory for Changes

### New Files
- `src/services/authorization.service.ts`
- `src/middleware/requirePermission.ts`
- `tests/grading.test.ts`

### Modified Files
- `db.ts` — schema migrations, new queries
- `server.ts` — all route handlers (37 ownership checks → authz calls)
- `auth.ts` — remove class teacher from token
- `validation.ts` — permission types
- `src/types/index.ts` — new types

### Configuration
- `.env` — feature flags
- `package.json` — test scripts

---

## Estimated Effort

| Phase | Days | Engineer |
|-------|------|----------|
| 0. Foundation | 2 | 1 |
| 1. Teacher Autonomy | 4 | 1-2 |
| 2. Auth Hardening | 3 | 1 |
| 3. Enhanced Features | 4 | 1-2 |
| 4. Advanced RBAC | 5 | 1 |
| **Total** | **18** | **1-2** |

---

*Plan ready for review. Next step: Approve Phase 0 start or adjust priorities.*