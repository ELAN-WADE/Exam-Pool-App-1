# Exampool — Full System Documentation

> **Version:** 4.1 (Schema v4.1 Naija Hybrid)
> **Stack:** Bun HTTP · SQLite (WAL) + ATTACHED DBs · Next.js 15 (static export)
> **Last updated:** 2026-07-24

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Database Schema & Entity Relationships](#2-database-schema--entity-relationships)
3. [Authentication & Session Management](#3-authentication--session-management)
4. [Request Routing & API Design](#4-request-routing--api-design)
5. [Authorization Model (RBAC)](#5-authorization-model-rbac)
6. [Exam Lifecycle & State Machine](#6-exam-lifecycle--state-machine)
7. [Grading Algorithms](#7-grading-algorithms)
8. [Concurrency & Data Integrity](#8-concurrency--data-integrity)
9. [Anti-Cheat Mechanisms (Frontend)](#9-anti-cheat-mechanisms-frontend)
10. [Frontend Exam Engine](#10-frontend-exam-engine)
11. [Schema Migration Strategy](#11-schema-migration-strategy)
12. [Input Validation Rules](#12-input-validation-rules)
13. [Static File Serving Algorithm](#13-static-file-serving-algorithm)
14. [Audit Logging System](#14-audit-logging-system)
15. [Complete API Reference](#15-complete-api-reference)
16. [Real-Time Features (SSE)](#16-real-time-features-sse)
17. [Practice Mode & Content Bank](#17-practice-mode--content-bank)
18. [Kiosk Mode](#18-kiosk-mode)
19. [Offline Assignment Mode](#19-offline-assignment-mode)
20. [File Upload System](#20-file-upload-system)
21. [Licensing System](#21-licensing-system)
22. [Security Vulnerabilities & Fixes Applied](#22-security-vulnerabilities--fixes-applied)
23. [Deployment Architecture](#23-deployment-architecture)
24. [Environment Variables Reference](#24-environment-variables-reference)

---

## 1. System Architecture Overview

```
+-------------------------------------------------------------+
|                       Client Browser                        |
|          (Next.js SPA -- served as static HTML/JS)          |
|                                                             |
|  Roles:  Student . Teacher . Operator(Admin) . Kiosk        |
+----------------------+--------------------------------------+
                       |  HTTP (LAN / public internet)
                       |  Cookie: __exampool_session (JWT)
                       v
+-------------------------------------------------------------+
|               Bun HTTP Server  (server.ts)                  |
|   Port: 8001 (default) -- listen 0.0.0.0                    |
|                                                             |
|   +-------------------+  +------------------------------+  |
|   |  API Router       |  |  Static File Server          |  |
|   |  /api/* ->        |  |  /* -> serveStatic()         |  |
|   |  handleApi()      |  |  distDir (auto-resolved)     |  |
|   +--------+----------+  +------------------------------+  |
|            |                                                |
|   +--------v------------------------------------------+    |
|   |  Middleware Stack                                  |    |
|   |  . CORS headers (corsHeaders)                      |    |
|   |  . Security headers (X-Frame, CSP, HSTS etc.)      |    |
|   |  . Rate limiter (in-memory Map, IP-keyed)          |    |
|   |  . requireAuth() -> verifyToken() -> DB user check  |    |
|   |  . requireRole() -> RBAC enforcement               |    |
|   +--------+------------------------------------------+    |
|            |                                                |
|   +--------v------------------------------------------+    |
|   |  auth.ts . validation.ts . crypto_utils.ts        |    |
|   |  db.ts (prepared queries)                          |    |
|   +------------------------+---------------------------+    |
|                            |                                |
|   +------------------------v---------------------------+    |
|   |         SQLite  (exampool.db)  -- WAL mode        |    |
|   |         SQLite  (content_bank.db)  -- ATTACHED    |    |
|   |         SQLite  (practice_logs.db) -- ATTACHED    |    |
|   +---------------------------------------------------+    |
+-------------------------------------------------------------+
```

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Bun | Native SQLite driver, fast HTTP, bundled TypeScript |
| Database | SQLite + WAL + ATTACHED DBs | Zero-infrastructure, LAN-latency safe, good read concurrency |
| Auth | Self-signed JWT (HS256) in httpOnly cookie | No external dependency; SameSite=Lax CSRF protection |
| Password hashing | Argon2id | Memory-hard; resistant to GPU brute force |
| Frontend | Next.js static export | Pre-built SPA served directly from Bun; no Node.js needed at runtime |
| Single binary | Single server.ts | Easy to deploy on school LAN -- one process does everything |
| Rate limiting | In-memory IP Map | Lightweight for LAN deployment; avoids Redis dependency |
| Real-time | Server-Sent Events (SSE) | One-way push from server without WebSocket complexity |

---

## 2. Database Schema & Entity Relationships

### Primary Database: `exampool.db`

```
users
  id, name, email (UNIQUE), role, password_hash,
  grade (required for students), reg_id, is_active,
  first_name, last_name, address, phone, dob, image_url,
  created_at
       |
       | teacher_id / created_by / enrolled_by
       v
subjects
  id, name, code, term (UNIQUE: code+term),
  duration (minutes, 1-360), total_score (computed),
  exam_datetime, window_duration (minutes, default 120),
  is_published, is_timetable_published, can_retake, is_assignment,
  mode (exam|test|quiz), instructions, class, session,
  teacher_id -> users(id), created_by -> users(id)
       |
       +---------------------------+
       |                           |
       v                           v
questions                    subject_enrollments
  id, subject_id               id, subject_id, student_id,
  question_text,               enrolled_by -> users(id)
  options_json (JSON array),   enrolled_at
  correct_answer (0-3 index),  UNIQUE(subject_id, student_id)
  marks, order_index,
  question_type (objective|essay|true_false),
  teacher_answer, image_url, is_file_upload, attached_file_url,
  session, term, mode
       |
       v
exams  (one per student per subject -- UNIQUE(student_id, subject_id))
  id, student_id -> users(id),
  subject_id -> subjects(id),
  start_time, end_time,
  answers_json (array of {question_id, selected_option}),
  score (REAL), total_score (INTEGER),
  status (in-progress | completed), retake_count,
  reg_id (denormalised copy), session, term, mode,
  teacher_remark, principal_remark
       |
       +----> exam_attempts (archive of retakes)
       |        id, exam_id, student_id, subject_id, attempt_number,
       |        start_time, end_time, answers_json, score, total_score, status, archived_at
       |
       +----> question_map (v4.1)
       |        id, exam_id, display_order, question_id, shuffle_seed
       v
student_answers  (populated on submit -- UNIQUE(exam_id, question_id))
  id, exam_id, question_id, student_id, subject_id,
  selected_option (INTEGER, nullable for essay),
  essay_response (TEXT, nullable for objective),
  is_correct (0|1), marks_awarded (REAL), file_url

audit_logs                        settings (key/value store)
  id, timestamp, actor_id,          key (UNIQUE), value
  action, resource,
  resource_id, details (JSON)

config (singleton row, id=1)      student_term_remarks
  org_name, description,            student_id, term (UNIQUE pair)
  admin_name, admin_email,          teacher_remark, principal_remark
  favicon, licence_key,
  licence_type, theme_json,
  version, admin_password_hash

notifications (v4.1)              kiosk_sessions (v4.1)
  id, user_id, type,                id, pc_id, seat_number, student_id, exam_id,
  message, link, is_read,           login_time, logout_time, status, hardware_fingerprint
  created_at

license_registry (v4.1)           content_manifest (v4.1)
  id, license_key, license_type,    id, package_name, version, exam_body,
  hardware_fingerprint,             import_date, signature_valid, file_size_bytes
  activated_at, expires_at,
  max_pcs, max_devices, content_packs, device_whitelist, public_key_pem
```

### Attached Databases

```
content_bank.content_bank (v4.1)  practice_logs.practice_logs (v4.1)
  id, exam_body, year,              id, student_id, question_id,
  subject_code, paper_type,         selected_answer, is_correct,
  question_text, options_json,      time_spent_seconds, session_date,
  correct_answer, solution_text,    mode, device_fingerprint, log_signature
  difficulty, topic_tag, diagram_path,
  fts_document, question_text_local
```

### Column-Level Constraints Summary

| Table | Constraint | Purpose |
|---|---|---|
| `users.role` | CHECK(role IN ('student','teacher','operator')) | Enforce valid role enum |
| `users.grade` | CHECK(role != 'student' OR grade IS NOT NULL) | Students must have a grade |
| `subjects.code + term` | UNIQUE(code, term) | No duplicate subjects per academic term |
| `subjects.duration` | CHECK(duration > 0 AND duration <= 360) | Limit exam to max 6 hours |
| `subjects.mode` | CHECK(mode IN ('test','exam','quiz')) | Enforce valid mode enum |
| `questions.correct_answer` | CHECK(correct_answer BETWEEN 0 AND 3) | Option index 0-3 |
| `exams.status` | CHECK(status IN ('in-progress','completed')) | State machine enforcement at DB level |
| `exams` | UNIQUE(student_id, subject_id) | One exam attempt per student per subject |
| `student_answers` | UNIQUE(exam_id, question_id) | No duplicate answer per question |
| `kiosk_sessions.status` | CHECK(status IN ('active','suspended','completed')) | Kiosk state machine |

### Performance Indexes

```sql
-- users
idx_users_email, idx_users_role, idx_users_reg

-- subjects
idx_subjects_teacher, idx_subjects_published (term, is_published), idx_subjects_mode

-- questions
idx_questions_subject (subject_id, order_index), idx_questions_type

-- exams
idx_exams_student, idx_exams_subject, idx_exams_status
idx_exams_student_status, idx_exams_subject_status

-- exam_attempts
idx_attempts_student, idx_attempts_subject, idx_attempts_exam

-- audit_logs
idx_audit_actor, idx_audit_timestamp, idx_audit_resource (resource, resource_id)

-- student_answers
idx_sa_exam, idx_sa_student, idx_sa_question, idx_sa_subject, idx_sa_exam_question

-- notifications
idx_notifications_user (user_id, created_at DESC)

-- subject_enrollments
idx_se_subject, idx_se_student
```

---

## 3. Authentication & Session Management

### Login Flow

```
Client POST /api/auth/login { email | regId, password }
  -> checkRateLimit (10 req/min per IP)
  -> getUserByEmailOrReg (normalize: email -> lowercase, regId -> uppercase)
  -> check is_active === 1
  -> verifyPassword (Argon2id)
  -> generateToken (HS256 JWT, 8-hour TTL)
  -> buildSessionCookie (httpOnly, SameSite=Lax, Secure on HTTPS)
  -> auditLog (LOGIN)
  -> return { user: stripPassword(user) } + Set-Cookie
```

### JWT Structure

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
{
  "sub": "<userId (number)>",
  "role": "student|teacher|operator",
  "iat": "<unix timestamp>",
  "exp": "<iat + 28800>"
}
```

- **Secret:** `JWT_SECRET` env var (default: weak hardcoded -- **must change in production**)
- **Algorithm:** HMAC-SHA256 (HS256)
- **TTL:** 8 hours (covers a full school day)

### requireAuth() Guard

Every protected route calls `requireAuth()`:
1. Parse cookie `__exampool_session` OR `Authorization: Bearer <token>` header
2. `verifyToken()` validates signature + expiry
3. **Stateful check:** `getUserById` confirms user still exists and is active
4. Role mismatch (token role vs DB role) is rejected -- prevents privilege persistence after demotion

### Cookie Attributes

```
__exampool_session=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800[; Secure]
```

- `HttpOnly`: prevents JavaScript access (XSS protection)
- `SameSite=Lax`: CSRF protection for cross-origin navigations
- `Secure`: set automatically when `IS_HTTPS=true` env is present

---

## 4. Request Routing & API Design

### Request Dispatch

```
fetch(req)
  -> OPTIONS -> 204 + corsHeaders (preflight)
  -> /api/* or /api -> handleApi(req, url)
  -> /* -> serveStatic(url.pathname)
```

### API Router Pattern

Routes are matched as a flat if/else chain inside `handleApi()`. Route matching uses:
- Exact string match for fixed paths (`/api/auth/login`)
- Regex for parameterized paths (`/api/exams/(\d+)/submit`)
- Query params for filters (`/api/users?role=student&grade=SS1`)

### Response Envelope

All API responses use one of:
- `{ data: ... }` -- success with payload
- `{ message: "..." }` -- success with message only
- `{ error: "..." }` -- error

### Error Codes

| Status | Meaning |
|---|---|
| 400 | Bad request / invalid payload |
| 401 | Not authenticated |
| 403 | Forbidden (wrong role or ownership check failed) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, wrong state) |
| 413 | Payload too large |
| 423 | Account deactivated |
| 429 | Rate limited |
| 500 | Internal server error |
| 503 | Setup required |

### Security Headers (applied to all responses)

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' ...
```

NOTE: `unsafe-inline` and `unsafe-eval` in the CSP weaken XSS protection. These exist because Next.js static export injects inline scripts. A nonce-based CSP would be stronger in a future upgrade.

---

## 5. Authorization Model (RBAC)

### Roles

| Role | Capabilities |
|---|---|
| `student` | Login, take exams, view own results, practice mode |
| `teacher` | Create/edit own subjects & questions, view enrolled student results, grade essays, add remarks |
| `operator` | Full admin access: user management, settings, audit logs, content import, all reports |

### Ownership Checks

| Resource | Check |
|---|---|
| Subject | `subjects.teacher_id = auth.userId` (teacher only) |
| Question | Via parent subject ownership |
| Exam remark | Via subject ownership |
| Essay grading | Via subject ownership |
| Student grade update | Must have at least one shared exam |

### Student Data Isolation

- Students only see their own enrolled subjects
- Students only see their own completed exams
- `correct_answer` and `teacher_answer` are stripped from question responses for students via `stripCorrectAnswer()`
- `dob` and `phone` are stripped from all `/api/auth/me` responses via `stripPassword()`

---

## 6. Exam Lifecycle & State Machine

```
Subject is published (is_published = 1)
Student is enrolled + exam window is open
  |
  v
POST /api/exams/start
  exams row created
  status = 'in-progress'
  start_time = now
  answers_json = '[]'
  |
  v (every 30s or on answer change)
POST /api/exams/:id/save
  answers_json updated
  Grace: 60s past deadline
  Rate limited: 15/min/user
  |
  v (student submits OR time expires via SSE force_submit)
POST /api/exams/:id/submit
  db.transaction() -- atomic
  If past deadline: use DB saved answers only
  If within time: merge client + DB answers
  Grade all questions (server-side)
  status = 'completed'
  score, total_score, end_time set
  student_answers table populated
  answers_json cleared (-> student_answers)
  guard: changes === 0 -> 409 already submitted
  |
  v (Optional -- if subject.can_retake = 1)
POST /api/exams/:id/retake
  exam archived -> exam_attempts
  student_answers deleted
  exams row reset to in-progress
```

### Exam Window Logic

- `exam_datetime` = scheduled start time
- `window_duration` (default 120 min) = time window students can start
- Students cannot start before `exam_datetime`
- Students cannot start after `exam_datetime + window_duration`
- Once started, timer is `start_time + duration` regardless of when they began

---

## 7. Grading Algorithms

### Objective / True-False Questions

```
is_correct = (student selected_option === question.correct_answer) ? 1 : 0
marks_awarded = is_correct ? question.marks : 0
```

### Essay Questions

- `is_correct = 0`, `marks_awarded = 0` at submit time
- Teacher manually calls `POST /api/exams/:id/grade` with `{ question_id, marks_awarded }`
- Server re-sums `student_answers.marks_awarded` into `exams.score`

### Total Score

```
exams.total_score = SUM(questions.marks) WHERE subject_id = ?
exams.score = SUM(student_answers.marks_awarded) WHERE exam_id = ?
```

`total_score` is always recomputed server-side -- never trusted from client.

### Grade Band (CSV Export)

```
pct >= 70 -> A
pct >= 55 -> B
pct >= 40 -> C
pct <  40 -> F
```

---

## 8. Concurrency & Data Integrity

### Submit Path

Exam submission runs entirely inside `db.transaction()`:
- Prevents double-submit: `submitExam` query uses `WHERE status = 'in-progress'`; if `changes === 0`, throws 409
- Atomic: score calculation and `student_answers` insert are in the same transaction
- Deadline enforcement: server computes from `start_time`, ignores client-supplied time

### Race Condition Guards

| Scenario | Guard |
|---|---|
| Double-submit | `UNIQUE(student_id, subject_id)` constraint + `changes === 0` check |
| Retake on in-progress exam | `status = 'completed'` required before retake |
| Enrollment on existing exam | Unenroll blocked if student has completed exam |
| Duplicate question answer | `UNIQUE(exam_id, question_id)` in student_answers + `INSERT OR REPLACE` |
| SQLite busy under concurrent load | `PRAGMA busy_timeout = 5000` |

### WAL Mode Benefits

- Readers do not block writers
- Writers do not block readers
- Multiple concurrent reads are fully parallel

---

## 9. Anti-Cheat Mechanisms (Frontend)

1. **Server-side Timer:** `GET /api/exams/:id/stream` pushes `{ type: "sync", remaining }` every 15s. When remaining reaches 0, server pushes `{ type: "force_submit" }` -- frontend auto-submits.
2. **Answer Stripping:** `correct_answer` is removed from question payloads for students at the API level.
3. **Time Enforcement:** After deadline + 30s grace, the server ignores the client-submitted answers and uses only the last DB-saved state.
4. **Auto-save:** Frontend saves answers every 30s so DB state is always nearly current.
5. **Session Validation:** Every request re-checks `is_active` in the DB -- suspended students are instantly blocked.
6. **Exam Window:** Students cannot start outside the allowed window -- `exam_datetime` to `exam_datetime + window_duration`.

---

## 10. Frontend Exam Engine

### App Structure

```
frontend/app/
  page.tsx                -> Landing (auto-detects role, redirects)
  setup/                  -> First-time setup wizard
  register/               -> Student/teacher registration
  forgot-password/        -> Self-service password reset
  student/
    dashboard/            -> Enrolled subjects + exam cards
    exams/                -> Active exam interface
    results/              -> Completed exam list
    review/               -> Per-question exam review
    practice/             -> JAMB/WAEC content bank practice
    settings/             -> Profile settings
  teacher/
    dashboard/            -> Assigned subjects
    subjects/             -> Subject + question management
    students/             -> Student roster + results
    results/              -> Exam results with grading
    report-card/          -> Term remark management
  operator/ (alias ADMIN/)
    page.tsx              -> Operator dashboard
    subjects/             -> Subject management
    students/             -> User management
    results/              -> All results
    settings/             -> System config
    report-card/          -> Principal remarks
  kiosk/                  -> Kiosk seat map + login
  ~offline/               -> Offline assignment sync
```

### Key Components

```
frontend/components/
  ExamCalculator.tsx      -> Subject-level score calculator
  ExamNavigator.tsx       -> Per-question navigation panel
  ui/
    TopBar.tsx            -> Navigation bar with notifications
    NotificationsPage.tsx -> Notification history
  teacher/
    BulkUploadModal.tsx   -> CSV/PDF question import
```

### Frontend Session Behavior

- `credentials: "include"` on all fetch calls -- cookie sent automatically
- `fetchWithAuth()` wrapper handles 401 -> redirect to `/`, 503 -> redirect to `/setup/`
- Session checked via `/api/auth/me` on every page load

---

## 11. Schema Migration Strategy

### Version History

| Schema Version | Changes |
|---|---|
| 1 | Initial schema |
| 2 | Users, subjects, questions, exams restructured (v2 resets legacy tables) |
| 3 | Adds: reg_id, session, term, mode, question_type, remarks, image_url, offline support |
| 4.1 | Adds: attached DBs (content_bank, practice_logs), notifications, kiosk_sessions, license_registry, content_manifest, question_map, exam_attempts |

### Migration Approach

- `addColumnIfMissing()` -- idempotent `ALTER TABLE ADD COLUMN` with table allowlist (prevents injection)
- Table allowlist (`ALTERABLE_TABLES`) prevents dynamic SQL injection in migrations
- v1->v2 is a breaking wipe (explicit `DROP TABLE`)
- v2->v3+ is non-destructive (addColumnIfMissing only)

---

## 12. Input Validation Rules

| Field | Rule | Enforced In |
|---|---|---|
| Email | `[^\s@]+@[^\s@]+\.[^\s@]+` regex + lowercase normalize | `validation.ts` |
| Password | >= 8 characters | `validation.ts` |
| Duration | Integer 1-360 | `validation.ts` |
| exam_datetime | Valid ISO date | `validation.ts` |
| Role | student or teacher or operator | `validation.ts` |
| IDs | Positive integer | `validation.ts` |
| options | Array of exactly 4 strings | `server.ts` |
| correct_answer | Integer 0-3 (0-1 for true_false) | `server.ts` |
| marks | Positive integer | `server.ts` |
| JSON payloads | Max 1MB (50MB for DB import) | `readJson()` |
| File uploads | Max 5MB | `server.ts` |
| Rate limits | Login: 10/min, Register: 5/min, PW reset: 5/min, Save: 15/min, Submit: 5/min | `checkRateLimit()` |

---

## 13. Static File Serving Algorithm

```
serveStatic(urlPath):
  1. Strip query string
  2. Auto-redirect casing mistakes (/Teacher -> /teacher, /admin -> /ADMIN)
  3. Build candidate paths:
     - /           -> distDir/index.html
     - /path/ext   -> distDir/path.ext (has extension)
     - /path       -> distDir/path/index.html, distDir/path.html, distDir/path
  4. For each candidate:
     a. Resolve absolute path
     b. Path traversal guard: reject if outside distDir
     c. If file exists -> serve with correct MIME + Cache-Control
  5. Fallback: serve index.html (SPA shell) with no-cache
```

### distDir Resolution Order

1. `<server_dir>/out/index.html`
2. `<server_dir>/dist/index.html`
3. `<server_dir>/frontend/out/index.html`
4. `<server_dir>/frontend/dist/index.html`

### Cache-Control Policy

| Path Pattern | Cache-Control |
|---|---|
| `/_next/static/**` | `public, max-age=31536000, immutable` |
| `*.html, *.txt, *.rsc, *.meta` | `no-store, no-cache, must-revalidate` |
| Everything else | `public, max-age=60, must-revalidate` |

---

## 14. Audit Logging System

Every mutation is logged via `auditLog()` to the `audit_logs` table. Non-blocking -- never fails the parent request if the log fails.

### Logged Actions

| Action | Resource | When |
|---|---|---|
| `LOGIN` | user | Successful login |
| `LOGOUT` | user | Session cleared |
| `USER_CREATE` | user | New user registered or operator created |
| `USER_UPDATE` | user | Profile or password updated |
| `USER_ACTIVATE` / `USER_DEACTIVATE` | user | Toggle active status |
| `PASSWORD_CHANGE` | user | Self-change password |
| `STUDENT_GRADE_UPDATE` | user | Grade promoted |
| `SUBJECT_CREATE` | subject | New subject created |
| `SUBJECT_DELETE` | subject | Subject deleted |
| `QUESTION_CREATE` | question | New question added |
| `QUESTION_EDIT` | question | Question updated |
| `QUESTION_DELETE` | question | Question deleted |
| `STUDENT_ENROLL` / `STUDENT_UNENROLL` | subject_enrollment | Single enroll / unenroll |
| `STUDENT_ENROLL_BULK` / `BULK_ENROLL` | subject_enrollment | Grade-level bulk enroll |
| `EXAM_START` | exam | Student starts exam |
| `EXAM_SUBMIT` | exam | Exam submitted |
| `EXAM_RETAKE` | exam | Exam reset for retake |
| `EXAM_DELETE` | exam | Exam attempt deleted |
| `ESSAY_GRADE` | student_answers | Teacher grades essay question |
| `EXAM_REMARK` | exam | Teacher adds remark |
| `EXAM_PRINCIPAL_REMARK` | exam | Operator adds principal remark |
| `TERM_REMARK` | user | Term-level remark upserted |
| `CONFIG_UPDATE` | config | School config changed |
| `SETTINGS_IMPORT` | setting | Database imported |
| `FILE_UPLOAD` | system | File uploaded |
| `LICENSE_UPDATE` | system | License file updated |

Audit logs are returned to operators ordered by `timestamp DESC`, limited to the last 500 entries.

---

## 15. Complete API Reference

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/setup | None | First-time setup -- creates first operator |
| POST | /api/auth/login | None | Login with email/regId + password; sets session cookie |
| GET | /api/auth/me | Any | Get current authenticated user |
| POST | /api/auth/logout | Any | Clear session cookie |
| POST | /api/auth/register | None/Operator | Register student or teacher |
| POST | /api/auth/reset-password/verify-email | None | Verify identity before reset |
| POST | /api/auth/reset-password | None | Reset password with DOB/phone verification |
| POST | /api/auth/change-password | Any | Change own password (requires current password) |

### Users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/users | Operator/Teacher | List users (filterable by ?role=&grade=) |
| POST | /api/users/operator | Operator | Create additional operator account |
| PUT | /api/users/:id | Operator | Update user profile or toggle active status |
| DELETE | /api/users/:id | Operator | Soft-delete (deactivate) user |
| POST | /api/users/:id/reset-password | Operator | Force reset user password |
| PUT | /api/users/:id/grade | Teacher/Operator | Update student grade |
| GET | /api/users/:id/exams | Teacher/Operator | Get all completed exams for a student |
| GET | /api/users/me/profile | Any | Full profile: enrolled subjects + exam stats |
| GET | /api/users/:id/term-remarks/:term | Any | Get term remarks for a student |
| PUT | /api/users/:id/term-remarks/:term | Teacher/Operator | Upsert term remark |

### Subjects

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/subjects | Any | List subjects (role-filtered) |
| POST | /api/subjects | Teacher/Operator | Create subject |
| PUT | /api/subjects/:id | Teacher (own)/Operator | Update subject |
| DELETE | /api/subjects/:id | Operator | Delete subject (blocked if exams exist) |
| GET | /api/subjects/:id/questions | Any | Get questions (correct answers stripped for students) |
| GET | /api/subjects/:id/students | Teacher/Operator | Get enrolled students with exam status |
| POST | /api/subjects/:id/students | Operator | Enroll a student (single or bulk IDs) |
| DELETE | /api/subjects/:id/students/:sid | Operator | Unenroll a student |
| POST | /api/subjects/:id/students/bulk | Operator | Bulk-enroll all active students in a grade |

### Questions

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/questions | Teacher/Operator | Create question (subject must be unpublished) |
| PUT | /api/questions/:id | Teacher (own)/Operator | Update question |
| DELETE | /api/questions/:id | Teacher (own)/Operator | Delete question |

### Exams

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/exams/active | Student | Get currently in-progress exams |
| POST | /api/exams/start | Student | Start an exam |
| POST | /api/exams/:id/save | Student | Auto-save current answers |
| POST | /api/exams/:id/submit | Student | Final submission with server-side grading |
| GET | /api/exams/results | Any | Get exam results (role-filtered) |
| GET | /api/exams/results/export | Teacher/Operator | Download CSV of all results |
| GET | /api/exams/:id/review | Any | Per-question review with student answers |
| GET | /api/exams/by-student-subject | Teacher/Operator | Look up exam by ?student_id=&subject_id= |
| POST | /api/exams/:id/grade | Teacher/Operator | Grade an essay question |
| PUT | /api/exams/:id/remarks | Teacher/Operator | Add teacher remark to completed exam |
| PUT | /api/exams/:id/principal-remark | Operator | Add principal remark to completed exam |
| POST | /api/exams/:id/retake | Student | Reset completed exam for retake |
| DELETE | /api/exams/:id | Teacher/Operator | Delete exam attempt |

### Settings & Config

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/server-info | None | Server IP, port, version |
| GET | /api/settings/public | Any (auth required) | School name, current term, admin name, theme |
| GET | /api/config | Operator | Full config including registration status |
| PUT | /api/config | Operator | Update config |
| POST | /api/settings/export | Operator | Download raw SQLite DB file |
| POST | /api/settings/import | Operator | Upload and restore SQLite DB file |
| POST | /api/settings/reset | Operator | Factory reset (requires confirmation string) |
| GET | /api/audit-logs | Operator | Last 500 audit log entries |

### Notifications & Real-Time

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/notifications/stream | Any | SSE stream for live notifications |
| GET | /api/notifications | Any | Get all notifications + unread count |
| PUT | /api/notifications/read | Any | Mark all notifications as read |
| GET | /api/exams/:id/stream | Student | SSE stream for exam timer sync |

### Practice Mode (v4.1)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/practice/subjects | Any | List available practice subject packages |
| GET | /api/practice/questions | Any | Get questions for a subject/year |
| POST | /api/practice/submit | Any | Submit practice answers + log results |
| GET | /api/practice/explanation | Any | Get solution for a practice question |
| POST | /api/practice/start | Any | Start a practice sandbox session |
| GET | /api/practice/download | Any | Download encrypted .epkg content package |

### Kiosk & Content (v4.1)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/kiosk/session/start | Any auth | Start kiosk seat session |
| POST | /api/kiosk/session/switch | Any auth | Switch student on kiosk seat |
| GET | /api/kiosk/seat-map | Teacher/Operator | View all active kiosk seats |
| GET | /api/system/license | Operator (FIXED) | Read current license payload |
| POST | /api/system/license | Operator | Upload license.json |
| POST | /api/upload | Teacher/Operator | Upload a file (max 5MB) |
| POST | /api/system/content/upload | Operator/Teacher | Upload & decrypt .epkg content package |
| POST | /api/content/pdf-upload | Operator/Teacher | Upload PDF and auto-extract questions |
| GET | /api/content/search | Teacher/Operator | FTS search content bank |
| GET | /api/sync/content/manifest | Auth required (FIXED) | Content bank package manifest |
| POST | /api/license/validate | Operator (FIXED) | Validate a license key |

### Offline Assignments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/offline/assignments | Any auth | Get all published assignments for student |
| POST | /api/offline/sync | Any auth | Sync completed offline exams to server |

---

## 16. Real-Time Features (SSE)

### Notification Stream (`/api/notifications/stream`)

- Each authenticated user has a `Set<ReadableStreamDefaultController>` in `sseClients` map
- `notifyUser(userId, eventData)` inserts to `notifications` table + pushes to all open SSE connections
- `notifyOperators(eventData)` queries operator user IDs and calls `notifyUser` for each
- Keepalive comment (`: keepalive`) sent every 15s to prevent proxy timeouts
- On disconnect, controller removed; if Set empties, the `sseClients` entry is deleted
- FIXED: per-user connection limit of 5 to prevent memory exhaustion DoS

### Events That Trigger Notifications

| Event | Target |
|---|---|
| Exam submitted | Owning teacher |
| Teacher adds remark | All operators |
| Operator adds principal remark | Owning teacher |
| Teacher adds term remark | All operators |
| Operator adds term remark | All enrolled teachers |
| Admin publishes/assigns subject | Teacher |

### Exam Timer Stream (`/api/exams/:id/stream`)

- Student-specific stream; validates exam ownership before streaming
- Sends `{ type: "sync", remaining }` every 15s based on server-computed remaining time
- Sends `{ type: "force_submit" }` when timer reaches 0 -- frontend must auto-submit

---

## 17. Practice Mode & Content Bank

### Content Bank (`content_bank.db` -- ATTACHED)

- Stores JAMB/WAEC/NECO/NABTEB past questions
- Import via encrypted `.epkg` packages (AES-256-GCM, HKDF-derived key)
- FTS5 full-text search index on `question_text` and `topic_tag`
- Practice questions are served with `correct_answer` (practice, not live exam)

### Practice Flow

1. `GET /api/practice/subjects` -- list available bodies/years
2. `GET /api/practice/questions?subject_code=&exam_body=&year=&limit=` -- fetch questions
3. Student answers locally
4. `POST /api/practice/submit` -- server scores, logs to `practice_logs.db`

### Practice Logs (`practice_logs.db` -- ATTACHED)

- Per-question analytics: time spent, correctness, session date
- Enables weak-topic identification per student

---

## 18. Kiosk Mode

Kiosk sessions track which student is on which PC seat:

- `POST /api/kiosk/session/start` -- registers a seat assignment (auto-closes previous session for that PC)
- `POST /api/kiosk/session/switch` -- switches student on same seat; server returns `X-Exampool-Action: WIPE_LOCAL_STORAGE` header to signal client to clear localStorage
- `GET /api/kiosk/seat-map` -- operators/teachers see a live map of all active PC sessions

---

## 19. Offline Assignment Mode

Students can complete assignments offline and sync when reconnected:

1. `GET /api/offline/assignments` -- fetches all published assignment subjects with questions (answers stripped)
2. Student works offline (stored in localStorage/IndexedDB)
3. `POST /api/offline/sync` -- batch-submits completed assignments
   - File attachments encoded as base64 `file_data` -> saved to uploads directory
   - Server scores objective/true_false answers; essays left for grading
   - Double-submission protected by `submitExam` changes guard

---

## 20. File Upload System

### Regular File Upload (`POST /api/upload`)

- Auth: Teacher/Operator
- Max: 5MB
- FIXED: File type validated against allowlist (images, pdf, docx only)
- Filename: `{userId}_{randomHash}.{ext}` -- prevents path traversal
- Served at `/uploads/{filename}` from distDir/uploads

### Known Issue: Duplicate Route (FIXED)

There were two handlers for `POST /api/upload`. The second one (offline files) was unreachable dead code. Fixed by removing the dead duplicate.

---

## 21. Licensing System

### License File (`license.json`)

- Stored as a JWT on disk
- `POST /api/system/license` -- operator uploads new license JWT (operator-only)
- `GET /api/system/license` -- reads current license (FIXED: operator-only)
- `validateMLF()` in `crypto_utils.ts` validates the JWT

### CRITICAL NOTE: Mocked Signature Verification

The RS256 signature verification in `crypto_utils.ts` is mocked (`isValid = true`). This means any JWT passes license validation. Real RSA verification must be implemented with a genuine keypair before production use.

### Content Package Encryption

- `.epkg` files use AES-256-GCM
- Key derived via HKDF-SHA256 from `licenseKey + schoolId + version + salt`
- IV and authTag stored alongside ciphertext

### CRITICAL NOTE: Hardcoded Encryption Keys (FIXED)

The license key and school ID used in `/api/practice/download` were hardcoded strings. Fixed to read from the license file at request time.

---

## 22. Security Vulnerabilities & Fixes Applied

### CRITICAL: Hardcoded JWT Secret

**Location:** `auth.ts` line 3
**Risk:** Public default secret allows anyone to forge valid session tokens for any user, including operators.
**Status:** Code supports `JWT_SECRET` env override. Startup warning added. MUST be changed in production.
**Fix:** Set `JWT_SECRET` to a 64-byte random hex string before deploying.

---

### CRITICAL: License Signature Verification is Mocked

**Location:** `crypto_utils.ts` line 46 (`const isValid = true`)
**Risk:** Any JWT, even forged, passes license validation.
**Status:** Comment and TODO added. Real RSA verification must be wired in with a genuine keypair.

---

### CRITICAL: IP Spoofing Bypasses Rate Limiter

**Location:** `server.ts` `getClientIp()` and `checkRateLimit()`
**Risk:** A client sends `X-Forwarded-For: 127.0.0.1` to appear as localhost, bypassing all rate limits.
**Fix Applied:** `X-Forwarded-For` header is only used if `TRUST_PROXY=true` env var is set. When not set, the actual socket IP is always used.

---

### HIGH: No File Type Validation on Upload

**Location:** `server.ts` `/api/upload` handler
**Risk:** Any file type can be uploaded, including scripts served to other users.
**Fix Applied:** Allowlist of permitted MIME types and extensions enforced on upload.

---

### HIGH: Duplicate `/api/upload` Route (Dead Code)

**Location:** `server.ts` lines 2150 and 2526
**Risk:** The second handler is unreachable -- offline file uploads through that path are silently dropped.
**Fix Applied:** Dead duplicate route removed. Offline sync uses base64 inline file data.

---

### HIGH: `/api/system/license` GET Requires No Auth

**Location:** `server.ts` line 2124
**Risk:** License tier, max_devices, sub, expiry readable by anyone unauthenticated.
**Fix Applied:** `requireAuth(req)` and `requireRole(..., ["operator"])` added.

---

### HIGH: `/api/sync/content/manifest` Requires No Auth

**Location:** `server.ts` line 2330
**Risk:** Content bank manifest readable by unauthenticated users, reveals school content metadata.
**Fix Applied:** `requireAuth(req)` added.

---

### HIGH: `/api/license/validate` Requires No Auth

**Location:** `server.ts` line 2682
**Risk:** Unauthenticated license key brute-force enumeration possible.
**Fix Applied:** `requireAuth(req)` + `requireRole(..., ["operator"])` + rate limit added.

---

### HIGH: Hardcoded Encryption Keys in Download Handler

**Location:** `server.ts` lines 2375-2376
**Risk:** Content packages encrypted with publicly-known fixed key -- any deployment can decrypt any school's content.
**Fix Applied:** Keys read from the `license.json` file at request time.

---

### MEDIUM: Timing-Unsafe Password Reset Comparison

**Location:** `server.ts` lines 731, 734 (DOB/phone reset verification)
**Risk:** Non-constant-time string comparison `!==` could theoretically reveal DOB/phone characters.
**Fix Applied:** Comparison uses `timingSafeEqual` from `node:crypto`.

---

### MEDIUM: PDF Upload Has No Size Limit

**Location:** `server.ts` `/api/content/pdf-upload`
**Risk:** Multi-gigabyte PDF upload could exhaust server memory.
**Fix Applied:** 10MB limit enforced before parsing.

---

### MEDIUM: Term Remark Parameter Not Length-Capped

**Location:** `server.ts` term remark handlers
**Risk:** Extremely long term strings stored in DB.
**Fix Applied:** Term string trimmed and capped at 64 characters.

---

### MEDIUM: `require()` Calls Inside Request Handlers

**Location:** `server.ts` lines 2166, 2254, 2538
**Risk:** Performance issue -- module lookup on every request.
**Fix Applied:** `require()` calls moved to module-level imports at top of file.

---

### MEDIUM: SSE Client Map Can Grow Unbounded

**Location:** `server.ts` `sseClients` Map
**Risk:** Thousands of open SSE connections per user can exhaust memory.
**Fix Applied:** Per-user SSE connection limit of 5. New connections beyond the limit close the oldest.

---

### MEDIUM: Remarks Have No Max Length

**Location:** `server.ts` remark handlers
**Risk:** 10MB remark strings stored in DB.
**Fix Applied:** All remarks (teacher, principal, term) trimmed and capped at 4000 characters.

---

### LOW: `BigInt.prototype.toJSON` Monkey-Patch

**Location:** `server.ts` line 111-113
**Risk:** Modifying built-in prototypes can interfere with libraries.
**Status:** Already guarded with `if (!(BigInt.prototype as any).toJSON)`. Acceptable workaround for bun:sqlite BigInt behavior.

---

### LOW: Rate Limiter State Lost on Restart

**Location:** `server.ts` `rateLimits` Map
**Risk:** In-memory rate limit cleared on server restart. Acceptable for LAN school use.
**Note:** For internet-facing deployments, use a Redis-backed rate limiter.

---

### LOW: Audit Log Has No Pagination

**Location:** `db.ts` `getAuditLogs` query (LIMIT 500 hardcoded)
**Risk:** On high-volume deployments, older audit entries are inaccessible via the API.
**Note:** Consider adding ?after_id= pagination or date-range filter in a future update.

---

## 23. Deployment Architecture

### LAN (Recommended for schools)

```
School PCs (browsers) -> Bun server (port 8001) on dedicated PC
```

- All data stays on-premises
- Single `bun server.ts` process
- No internet required after setup

### Cloud Deployment (Railway / Render / Fly.io)

- `railway.toml` / `render.yaml` / `fly.toml` provided
- `Dockerfile` available for containerized deploy
- Persistent volume needed for `exampool.db`
- Set `JWT_SECRET`, `PORT`, `EXAMPOOL_DB` env vars
- Use HTTPS (set `IS_HTTPS=true`)

---

## 24. Environment Variables Reference

| Variable | Default | Required | Description |
|---|---|---|---|
| `JWT_SECRET` | `"exampool-lan-secret-change-me"` | YES -- change in production | HMAC-SHA256 signing secret for session JWTs |
| `PORT` | `8001` | No | HTTP listen port |
| `EXAMPOOL_DB` | `./exampool.db` | No | Absolute path to SQLite database file |
| `IS_HTTPS` | unset | No | Set to `"true"` to add Secure flag to session cookie |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | No | CORS allowed origin |
| `TRUST_PROXY` | unset | No | Set to `"true"` to trust X-Forwarded-For header (only when behind a known trusted reverse proxy) |

CAUTION: The default `JWT_SECRET` is publicly known. Always set a strong, random `JWT_SECRET` before any non-development deployment. A compromised secret allows anyone to forge valid session tokens for any user, including operators.

Generate a secure secret:
```bash
bun -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
