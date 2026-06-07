# Exampool — Full System Documentation

> **Version:** 3.x (Schema v3)  
> **Stack:** Bun HTTP · SQLite (WAL) · Next.js 14 (static export)  
> **Last updated:** 2026-06-06

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

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Browser                        │
│          (Next.js SPA — served as static HTML/JS)           │
└──────────────────────┬──────────────────────────────────────┘
                       │  HTTP (LAN / public internet)
                       │  Cookie: __exampool_session (JWT)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               Bun HTTP Server  (server.ts)                  │
│   Port: 3000 (default) — listen 0.0.0.0                     │
│                                                             │
│   ┌───────────────────┐  ┌──────────────────────────────┐  │
│   │  API Router        │  │  Static File Server          │  │
│   │  /api/* → handleApi│  │  /* → serveStatic()          │  │
│   └────────┬──────────┘  └──────────────────────────────┘  │
│            │                                                │
│   ┌────────▼────────────────────────────────────────────┐  │
│   │  auth.ts  ·  validation.ts  ·  db.ts (queries)      │  │
│   └────────────────────────┬───────────────────────────-┘  │
│                            │                                │
│   ┌────────────────────────▼───────────────────────────-┐  │
│   │         SQLite  (exampool.db)  — WAL mode            │  │
│   └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Bun | Native SQLite driver, fast HTTP, bundled TypeScript |
| Database | SQLite + WAL | Zero-infrastructure, LAN-latency safe, good read concurrency |
| Auth | Self-signed JWT (HS256) in httpOnly cookie | No external dependency; SameSite=Lax CSRF protection |
| Password hashing | Argon2id | Memory-hard; resistant to GPU brute force |
| Frontend | Next.js static export | Pre-built SPA served directly from Bun; no Node.js needed at runtime |
| Single binary | Single server.ts | Easy to deploy on school LAN — one process does everything |

---

## 2. Database Schema & Entity Relationships

### Entity Relationship Diagram

```
users
  id, name, email (UNIQUE), role, password_hash,
  grade (required for students), reg_id, is_active,
  first_name, last_name, address, phone, dob, image_url
       |
       | teacher_id / created_by / enrolled_by
       v
subjects
  id, name, code, term (UNIQUE: code+term),
  duration (minutes, 1-360), total_score (computed),
  exam_datetime, window_duration (minutes, default 120),
  is_published, is_timetable_published,
  mode (exam|test|quiz), instructions, class, session,
  teacher_id → users(id), created_by → users(id)
       |
       +---------------------------+
       |                           |
       v                           v
questions                    subject_enrollments
  id, subject_id               id, subject_id, student_id,
  question_text,               enrolled_by → users(id)
  options_json (JSON array),   UNIQUE(subject_id, student_id)
  correct_answer (0-3 index),
  marks, order_index,
  question_type (objective|essay|true_false),
  teacher_answer, image_url,
  session, term, mode
       |
       v
exams  (one per student per subject — UNIQUE(student_id, subject_id))
  id, student_id → users(id),
  subject_id → subjects(id),
  start_time, end_time,
  answers_json (array of {question_id, selected_option}),
  score (REAL), total_score (INTEGER),
  status (in-progress | completed),
  reg_id (denormalised copy), session, term, mode,
  teacher_remark, principal_remark
       |
       v
student_answers  (populated on submit — UNIQUE(exam_id, question_id))
  id, exam_id, question_id, student_id, subject_id,
  selected_option (INTEGER, nullable for essay),
  essay_response (TEXT, nullable for objective),
  is_correct (0|1), marks_awarded (REAL)

audit_logs                        settings (key/value store)
  id, timestamp, actor_id,          key (UNIQUE), value
  action, resource,
  resource_id, details (JSON)

config (singleton row, id=1)      student_term_remarks
  org_name, description,            student_id, term (UNIQUE pair)
  admin_name, admin_email,          teacher_remark, principal_remark
  favicon, licence_key,
  licence_type, theme_json,
  version
```

### Column-Level Constraints Summary

| Table | Constraint | Purpose |
|---|---|---|
| `users.role` | CHECK(role IN ('student','teacher','operator')) | Enforce valid role enum |
| `users.grade` | CHECK(role != 'student' OR grade IS NOT NULL) | Students must have a grade |
| `subjects.code + term` | UNIQUE(code, term) | No duplicate subjects per academic term |
| `subjects.duration` | CHECK(duration > 0 AND duration <= 360) | Limit exam to max 6 hours |
| `subjects.mode` | CHECK(mode IN ('test','exam','quiz')) | Enforce valid mode enum |
| `questions.correct_answer` | CHECK(correct_answer BETWEEN 0 AND 3) | Option index 0–3 |
| `exams.status` | CHECK(status IN ('in-progress','completed')) | State machine enforcement at DB level |
| `exams` | UNIQUE(student_id, subject_id) | One exam attempt per student per subject |
| `student_answers` | UNIQUE(exam_id, question_id) | No duplicate answer per question |

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

-- audit_logs
idx_audit_actor, idx_audit_timestamp, idx_audit_resource (resource, resource_id)

-- student_answers
idx_sa_exam, idx_sa_student, idx_sa_question, idx_sa_subject

-- subject_enrollments
idx_se_subject, idx_se_student
```

### Settings Store (Key/Value)

| Key | Default | Description |
|---|---|---|
| `SCHEMA_VERSION` | "3" | Tracks migration version |
| `REGISTRATION_OPEN` | "true" | Whether public registration is allowed |
| `CURRENT_TERM` | "2026-T1" | Active academic term label |
| `SCHOOL_NAME` | "ExamPool School" | School display name |

---

## 3. Authentication & Session Management

### Password Hashing — Argon2id

```
Algorithm: Argon2id (password hashing via Bun.password)
  memoryCost: 65536 KB  (64 MB)
  timeCost:   2 iterations

Input:  plaintext password (string)
Output: Argon2id hash string (includes salt, parameters)

Verification: Bun.password.verify(plain, hash)
  → constant-time comparison (timing-safe)
```

Argon2id is chosen because it is:
- **Memory-hard**: defeats GPU / ASIC attacks
- **Hybrid**: resistant to both side-channel (Argon2i) and GPU (Argon2d) attacks

### JWT Token Generation (HS256)

```
Signing algorithm: HMAC-SHA256 (node:crypto createHmac)
Secret:            JWT_SECRET env var (default: "exampool-lan-secret-change-me")
TTL:               8 hours (28800 seconds — covers a full school day)

Token structure:
  header.payload.signature   (all Base64URL encoded)

Payload fields:
  {
    sub: userId (number),
    role: "student" | "teacher" | "operator",
    iat: issuedAt (Unix seconds),
    exp: iat + 28800
  }

Signing:
  signingInput = base64url(header) + "." + base64url(payload)
  signature    = HMAC-SHA256(JWT_SECRET, signingInput)  → base64url encoded
```

### Token Verification Algorithm

```
verifyToken(token):
  1. Split token on "." — must have exactly 3 parts.
  2. Re-compute expected HMAC over "header.payload".
  3. Decode received signature from Base64URL to Buffer.
     (Legacy fallback: also accept hex-encoded signatures for old tokens.)
  4. timingSafeEqual(received, expected) — constant-time to prevent timing attacks.
  5. If invalid signature → return null.
  6. Decode payload, check decoded.exp > now() → if expired return null.
  7. Return { userId: decoded.sub, role: decoded.role }.
```

> [!IMPORTANT]
> **Timing-safe comparison** (`timingSafeEqual`) is used to prevent signature oracle timing attacks where an attacker could deduce correct bytes by measuring response time.

### Session Cookie

```
Name:     __exampool_session
Flags:    HttpOnly (JS cannot read), SameSite=Lax (CSRF protection), Path=/
Max-Age:  28800 seconds (8 hours)
```

Token is accepted from either:
1. Cookie `__exampool_session` (preferred — browser flow)
2. `Authorization: Bearer <token>` header (API clients)

### Self-Service Password Reset Algorithm

Students reset via **Date of Birth** verification:

```
1. Client POSTs { identifier, verification: "YYYY-MM-DD", new_password }
2. Server looks up user by email or reg_id (normalised).
3. Checks user.role:
   - student  → verify user.dob === verification
   - teacher  → verify user.phone === verification
4. If match → hash new_password (Argon2id) → UPDATE users SET password_hash
5. Audit log: action=USER_UPDATE, details={ action: "self_reset_password" }
```

---

## 4. Request Routing & API Design

### Dispatch Algorithm

```
fetch(req):
  1. OPTIONS → return 204 with CORS headers (preflight)
  2. Parse URL.
  3. If pathname starts with /api/ or === /api → handleApi(req, url)
  4. Else → serveStatic(pathname)
  5. Catch HttpError → apiError(status, message)
  6. Catch unknown → apiError(500, "Server error")
```

### API Guard — Setup Mode

```
setupRequired = (count of active operators === 0)  // evaluated at startup

For every API request (except exempt):
  if (setupRequired && !isApiExemptWhileSetup(pathname, method)):
    return 503 { error: "Setup required", setup: true }

Exempt routes (always accessible):
  GET  /api/server-info
  POST /api/setup
  POST /api/setup/complete
```

The frontend detects the `setup: true` flag in `503` responses and redirects to `/setup`.

### Response Envelope

All API responses use one of three shapes:

| Shape | Used For |
|---|---|
| `{ data: ... }` | Successful data read / write |
| `{ message: "..." }` | Successful action with no data payload |
| `{ error: "...", ...extra }` | All error conditions |

> [!NOTE]
> BigInt safety: SQLite `INTEGER` columns may be returned as JavaScript `BigInt` by `bun:sqlite`. All responses are serialized with a custom replacer that converts BigInt to Number to prevent JSON serialization failures.

### Route Matching Strategy

Routes are matched **top-to-bottom** in `handleApi()` using:
1. **Exact matches** for simple paths: `pathname === "/api/subjects"`
2. **RegExp captures** for parameterized paths: `pathname.match(/^\/api\/subjects\/(\d+)$/)`

---

## 5. Authorization Model (RBAC)

### Roles

| Role | Description | Can Self-Register |
|---|---|---|
| `student` | Takes exams, views own results | Yes (if registration open) |
| `teacher` | Creates/manages subjects and questions, views results | Yes (if registration open) |
| `operator` | Full system access: users, settings, audit logs | No (created by existing operator or setup) |

### Permission Matrix

| Action | student | teacher | operator |
|---|---|---|---|
| View own profile / exams | ✅ | ✅ | ✅ |
| View enrolled subjects | ✅ | — | — |
| Start / save / submit exam | ✅ | — | — |
| Create / edit subjects | — | ✅ (own only) | ✅ (any) |
| Add / edit / delete questions | — | ✅ (own, unpublished) | ✅ |
| Publish subjects | — | ✅ (own) | ✅ |
| View student roster | — | ✅ (own subjects) | ✅ |
| Enroll / unenroll students | — | — | ✅ |
| Bulk-enroll by grade | — | — | ✅ |
| View all results | — | ✅ (own subjects) | ✅ |
| Add exam/term remarks | — | ✅ (own subjects) | ✅ |
| Grade essay questions | — | ✅ (own subjects) | ✅ |
| Export results CSV | — | ✅ (own subjects) | ✅ |
| Manage users (activate/deactivate) | — | — | ✅ |
| View audit logs | — | — | ✅ |
| Import / export / reset database | — | — | ✅ |
| Update config (school name, theme) | — | — | ✅ |

### Ownership Enforcement

Teacher mutations include an ownership check every time:
```typescript
// Subject ownership:
if (auth.role !== "operator" && !sameUserId(subject.teacher_id, auth.userId))
  return apiError(403, "You do not own this subject");

// sameUserId handles BigInt safely:
function sameUserId(dbValue: unknown, tokenUserId: number): boolean {
  return sqlInt(dbValue) === tokenUserId;
}
```

### Data Stripping

- **Password hash**: `stripPassword()` removes `password_hash` before any user object is sent to the client.
- **Correct answers**: `stripCorrectAnswer()` removes both `correct_answer` AND `teacher_answer` from question payloads when the requester is a `student`.

---

## 6. Exam Lifecycle & State Machine

### States

```
         ┌─────────────┐
         │   (no exam)  │
         └──────┬───────┘
                │  POST /api/exams/start
                │  (enrollment + window check)
                v
         ┌─────────────┐
         │ in-progress  │◄─────── auto-save every 30s
         └──────┬───────┘
                │  POST /api/exams/:id/submit
                │  OR timer expires (auto-submit)
                v
         ┌─────────────┐
         │  completed   │──► grading ──► student_answers populated
         └─────────────┘
```

States are enforced at the database level via `CHECK(status IN ('in-progress','completed'))`. The `UNIQUE(student_id, subject_id)` constraint on `exams` ensures only one attempt per student per subject.

### Exam Start Algorithm

```
POST /api/exams/start:
  1. requireRole student
  2. Validate subjectId
  3. subject.is_timetable_published must be 1 — else 403
  4. Enrollment check: subject_enrollments WHERE subject_id=? AND student_id=?
  5. Window check:
       now   = Date.now()
       start = Date.parse(subject.exam_datetime)
       end   = start + subject.window_duration * 60_000   (default: 120 min window)
       if now < start  → 403 "Exam window not open yet"
       if now >= end   → 403 "Exam window has closed"
  6. createExam INSERT (UNIQUE constraint acts as dedup guard → 409 if already started)
  7. Return: { exam, questions (correct_answer stripped), server_time, examId, startTime }
```

> [!NOTE]
> **Two time parameters exist:**
> - `subject.duration` — the exam's actual time limit (e.g. 60 min). The student countdown is based on `start_time + duration`.
> - `subject.window_duration` — how long the exam window is open for students to start (e.g. 120 min). A student who starts at minute 119 still gets the full `duration` to finish.

### Exam Submit Algorithm

```
POST /api/exams/:id/submit (wrapped in db.transaction):
  1. requireRole student, ownership check
  2. status must be 'in-progress' — else 409 (double-submit guard)
  3. Grace deadline: start_time + duration + 30s
  4. Build answerMap: Map<question_id, selected_option | null>
     and essayMap: Map<question_id, essay_response>
  5. Load all questions for the subject.
  6. Score computation:
       score = 0, total = 0
       for each question q:
         total += q.marks
         if answerMap.get(q.id) === q.correct_answer:
           score += q.marks
  7. submitExam.run(answers_json, end_time, score, total, examId, student_id)
     → changes count MUST be > 0 (race guard — if 0, another request already submitted)
  8. Denormalize: UPDATE exams SET reg_id = student.reg_id
  9. Populate student_answers for each question:
       selected_option: null for essays
       essay_response:  essay text or null
       is_correct:      1 if objective/true_false and answer matches, else 0
       marks_awarded:   q.marks if is_correct, else 0 (essays always start at 0)
  10. Return: { exam_id, score, total_score, time_taken_seconds }
```

---

## 7. Grading Algorithms

### 7.1 Objective / True-False Auto-Grading

```
For each question of type "objective" or "true_false":
  selected = answerMap.get(question.id)   // integer index 0–3 or null
  correct  = question.correct_answer       // integer index 0–3

  is_correct    = (selected !== null && selected === correct) ? 1 : 0
  marks_awarded = is_correct ? question.marks : 0
```

No partial credit. Full marks for correct answer, zero for incorrect or unanswered.

### 7.2 Essay Manual Grading

Essay questions receive `marks_awarded = 0` at submission time. Teachers grade afterward:

```
POST /api/exams/:id/grade:
  1. requireRole teacher/operator
  2. Teacher ownership check (teachers can only grade their own subject)
  3. Validate question belongs to this exam's subject
  4. question.question_type must be "essay" — else 400
  5. marksAwarded must be <= question.marks — else 400
  6. UPDATE student_answers SET marks_awarded=?, is_correct=(marks_awarded >= marks)
  7. Recompute exam total:
       SELECT SUM(marks_awarded) FROM student_answers WHERE exam_id=?
  8. UPDATE exams SET score = computed_total
```

### 7.3 Total Score Computation (Subjects)

Subject `total_score` is **never trusted from client input**. It is always recomputed server-side:

```sql
-- Runs inside a transaction whenever a question is created, updated, or deleted:
UPDATE subjects
SET total_score = (SELECT COALESCE(SUM(marks), 0) FROM questions WHERE subject_id = ?)
WHERE id = ?
```

### 7.4 Letter Grade / Percentage (CSV Export)

```
total = exam.total_score
pct   = total > 0 ? Math.round((score / total) * 100) : 0

letter:
  pct >= 70 → "A"
  pct >= 55 → "B"
  pct >= 40 → "C"
  else      → "F"
```

---

## 8. Concurrency & Data Integrity

### Double-Submit Race Condition Prevention

The exam submit path uses a `db.transaction()` block. The `submitExam` prepared statement's `WHERE` clause acts as an atomic test-and-set:

```sql
UPDATE exams
SET answers_json=?, end_time=?, score=?, total_score=?, status='completed'
WHERE id=? AND student_id=? AND status='in-progress'  -- gate
```

If two concurrent requests arrive simultaneously:
1. First transaction acquires SQLite write lock, updates the row (`status` changes to `'completed'`).
2. Second transaction runs the same `UPDATE` — the `WHERE status='in-progress'` no longer matches → `changes = 0`.
3. Server throws `409 "Exam already submitted"`.

SQLite WAL mode allows concurrent reads but serializes writes, so no two writes can execute simultaneously on the same row.

### Foreign Key Cascade Rules

| Delete Event | Cascaded Effect |
|---|---|
| Delete `subject` | Cascade deletes `questions`, `subject_enrollments`, `student_answers` |
| Delete `exam` | Cascade deletes `student_answers` |
| Delete `user` | RESTRICTED if they have audit_log entries or are referenced as `teacher_id`/`created_by` |
| Delete `student` | RESTRICTED if they have exam records (enforced at app layer too) |

### Unenroll Safety Guard

```typescript
// Before unenrolling a student:
const hasCompletedExam = db.prepare(
  "SELECT id FROM exams WHERE student_id=? AND subject_id=? AND status='completed' LIMIT 1"
).get(studentId, subjectId);
if (hasCompletedExam) return apiError(409, "Cannot unenroll a student who has completed the exam");
```

---

## 9. Anti-Cheat Mechanisms (Frontend)

### Tab-Switch Detection

```typescript
// Active only while mode === "in-progress"
window.addEventListener("blur", onBlur);  // user switched tabs / minimised

onBlur():
  cheatWarnings += 1
  if cheatWarnings >= 3:
    auto-submit exam immediately
  else:
    show toast: "Warning: Please stay on the exam tab. (N/3 warnings)"
```

### Single-Instance Guard (`useSingleInstance`)

Prevents a student from opening the same exam in multiple browser tabs simultaneously. Uses `localStorage` as a cross-tab mutex:

```
useSingleInstance(key: `exam-${subjectId}`):
  → returns { blocked: boolean }
  → if another tab holds the lock → blocked = true
  → the exam page renders a "close other tabs" screen
```

### Before-Unload Protection

```typescript
// Registered when mode === "in-progress"
window.addEventListener("beforeunload", (e) => {
  e.preventDefault();
  e.returnValue = "Your exam is in progress. Are you sure you want to leave?";
});
```

---

## 10. Frontend Exam Engine

### Exam Page State Machine

```
"loading"    → fetch subjects + active exams from API
    |
  Has in-progress exam?
  ├── YES → set examId, restore answers (localStorage or answers_json)
  │          → "showResume" modal
  │               ├── Continue → mode = "in-progress"
  │               └── Start fresh → clear answers, mode = "in-progress"
  └── NO  → "showInstructions" modal
                  └── Start Exam → startExam() → mode = "in-progress"

"in-progress" → student answers questions, timer runs
    |
  Timer reaches 0 OR student clicks Submit
    |
"submitting"  → POST /api/exams/:id/submit
    |
"completed"   → show DonutChart score, confetti
```

### Timer Algorithm (`useMonotonicTimer`)

The timer is **monotonic** — it counts down from a seeded value rather than relying on `Date.now()` differences to prevent time drift:

```typescript
seedTimer(startTimeIso, durationMins, serverTimeIso?):
  // Use server_time if provided to correct for client clock skew
  now     = serverTimeIso ? Date.parse(serverTimeIso) : Date.now()
  elapsed = Math.max(0, Math.floor((now - Date.parse(startTimeIso)) / 1000))
  seed    = Math.max(0, durationMins * 60 - elapsed)
  setTimerSeed(seed)

// The hook counts down from `seed` in 1-second intervals.
// When it reaches 0, triggers handleSubmit() automatically.
```

### Auto-Save Algorithm

```
Every 30–35s (30s + random 0–5s jitter to spread load):
  if offline:
    saveStatus = "offline"
    return
  saveStatus = "syncing"
  POST /api/exams/:id/save  with current answers
  → success: saveStatus = "saved" (resets to "idle" after 3s)
  → failure: saveStatus = "offline"

// Answers are also persisted to localStorage after every change:
localStorage.setItem(`exam_answers_${examId}`, JSON.stringify(answers))
```

The random jitter prevents a thundering-herd scenario where all students auto-save at the exact same millisecond.

### Answer Payload Format

```typescript
// Built by buildAnswerPayload():
[
  {
    question_id:     number,
    selected_option: number | null,  // index 0–3 for objective/true_false
    essay_response:  string | null,  // text for essay
  },
  ...
]
```

### Question Navigation

- **Arrow keys**: ArrowRight / ArrowLeft to move between questions
- **Number keys 1–4**: Quick-select options A–D for objective questions (1–2 for true/false)
- **Key F**: Toggle flag on current question
- Question navigator sidebar shows color-coded grid: current (blue), answered (green), flagged (amber), skipped (grey)

---

## 11. Schema Migration Strategy

### Version History

| Version | Migration Approach |
|---|---|
| v1 | Original schema |
| v1→v2 | **Destructive reset**: drops all legacy tables, recreates from scratch |
| v2→v3 | **Additive migrations**: `addColumnIfMissing()` only — no data loss |

### `addColumnIfMissing()` Algorithm

```typescript
function addColumnIfMissing(table, column, definition):
  cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if not cols.some(c => c.name === column):
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
```

This is **idempotent** — safe to call on every server startup.

### Startup Sequence

```
1. Ensure DB directory exists (mkdirSync recursive)
2. Open database (create: true)
3. Apply PRAGMAs: WAL, foreign_keys, busy_timeout, synchronous, cache_size
4. Run initializeDatabase():
   a. Create `settings` table if missing
   b. Check SCHEMA_VERSION:
      - If missing or "1" → destructive wipe + recreate (v2 upgrade)
   c. CREATE TABLE IF NOT EXISTS for all tables
   d. addColumnIfMissing() for all v3/v4/v5 extension columns
   e. Seed defaults: SCHEMA_VERSION="3", REGISTRATION_OPEN="true", CURRENT_TERM="2026-T1"
   f. Upsert default config row (id=1)
5. Prepare all query statements (queries object)
6. Check setupRequired: count active operators === 0
7. Start HTTP server
```

---

## 12. Input Validation Rules

All validation is centralised in `validation.ts`.

| Field | Rule |
|---|---|
| Email | Must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (after trim + lowercase) |
| Password | typeof === "string" && length >= 6 |
| Exam duration | isInteger && > 0 && <= 360 (minutes) |
| `exam_datetime` | Must be parseable by Date.parse() |
| `exam_datetime` on create | Must be at least 1 minute in the future (with 60s grace) |
| Role parameter | Must be "student", "teacher", or "operator" |
| Resource IDs | isInteger && > 0 (rejects 0, negatives, non-integers) |

### Registration Field Requirements

| Role | Required | Not Required |
|---|---|---|
| student | name, grade, dob, role | email (auto-generated if omitted), phone |
| teacher | name, email, phone, role | grade, dob |
| operator | Created by existing operator only — needs name, email, password | — |

### Registration ID Generation

```typescript
const prefix = role === "teacher" ? "TCH" : "REG";
const regId  = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
// e.g. "REG-1NF3G2A0" — time-based base-36 string, practically unique

// Operator IDs:
const opRegId = `OP-${Date.now().toString(36).toUpperCase()}`;
```

---

## 13. Static File Serving Algorithm

```typescript
serveStatic(urlPath):
  pathname = urlPath.split("?")[0]  // strip query string
  rel      = pathname trimmed of leading/trailing slashes

  Build candidate file paths:
    if rel is empty:
      candidates = ["dist/index.html"]
    else if rel has file extension:
      candidates = ["dist/{rel}"]
    else:
      candidates = [
        "dist/{rel}/index.html",   // directory with index
        "dist/{rel}.html",         // .html extension implicit
        "dist/{rel}",              // bare file
      ]

  For each candidate:
    if file exists → serve with appropriate Content-Type + Cache-Control

  Fallback: serve dist/index.html (SPA shell) with no-cache headers

Cache-Control policy:
  /_next/static/**    → "public, max-age=31536000, immutable"  (hashed assets)
  *.html, *.txt, etc  → "no-store, no-cache, must-revalidate"
  everything else     → "public, max-age=60, must-revalidate"
```

---

## 14. Audit Logging System

Every significant action is recorded in `audit_logs`:

```typescript
auditLog(actorId, action, resource, resourceId, details):
  // Never throws — failures are logged to console only
  INSERT INTO audit_logs (actor_id, action, resource, resource_id, details)
```

### Audit Action Catalog

| Action | Resource | When |
|---|---|---|
| `LOGIN` | user | Successful login |
| `LOGOUT` | user | Explicit logout |
| `USER_CREATE` | user | Registration or operator-created user |
| `USER_UPDATE` | user | Profile update, password reset |
| `USER_ACTIVATE` / `USER_DEACTIVATE` | user | Toggle active status |
| `PASSWORD_CHANGE` | user | Self-service password change |
| `STUDENT_GRADE_UPDATE` | user | Grade promotion/demotion |
| `SUBJECT_CREATE` | subject | New subject created |
| `SUBJECT_DELETE` | subject | Subject deleted |
| `QUESTION_CREATE` | question | New question added |
| `QUESTION_EDIT` | question | Question updated |
| `QUESTION_DELETE` | question | Question deleted |
| `STUDENT_ENROLL` | subject_enrollment | Single enroll |
| `STUDENT_UNENROLL` | subject_enrollment | Single unenroll |
| `BULK_ENROLL` | subject_enrollment | Grade-level bulk enroll |
| `EXAM_START` | exam | Student starts exam |
| `EXAM_SUBMIT` | exam | Exam submitted |
| `ESSAY_GRADE` | student_answers | Teacher grades an essay question |
| `EXAM_REMARK` | exam | Teacher adds exam remark |
| `EXAM_PRINCIPAL_REMARK` | exam | Operator adds principal remark |
| `TERM_REMARK` | user | Term-level remark upserted |
| `CONFIG_UPDATE` | config | School config changed |
| `SETTINGS_IMPORT` | setting | Database imported |

Audit logs are returned to operators ordered by `timestamp DESC`, limited to the last 500 entries.

---

## 15. Complete API Reference

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/setup | None | First-time setup — creates first operator |
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
| POST | /api/subjects/:id/students | Operator | Enroll a student |
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
| POST | /api/exams/:id/submit | Student | Final submission with grading |
| GET | /api/exams/results | Any | Get exam results (role-filtered) |
| GET | /api/exams/results/export | Teacher/Operator | Download CSV of all results |
| GET | /api/exams/:id/review | Any | Per-question review with student answers |
| GET | /api/exams/by-student-subject | Teacher/Operator | Look up exam by ?student_id=&subject_id= |
| POST | /api/exams/:id/grade | Teacher/Operator | Grade an essay question |
| PUT | /api/exams/:id/remarks | Teacher/Operator | Add teacher remark to completed exam |
| PUT | /api/exams/:id/principal-remark | Operator | Add principal remark to completed exam |

### Settings & Config

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/server-info | None | Server IP, port, version |
| GET | /api/settings/public | Any | School name, current term, admin name, theme |
| GET | /api/config | Operator | Full config including registration status |
| PUT | /api/config | Operator | Update config |
| POST | /api/settings/export | Operator | Download raw SQLite DB file |
| POST | /api/settings/import | Operator | Upload and restore SQLite DB file |
| POST | /api/settings/reset | Operator | Factory reset (requires confirmation string) |
| GET | /api/audit-logs | Operator | Last 500 audit log entries |

---

## Appendix: Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | "exampool-lan-secret-change-me" | **Must change in production** |
| `PORT` | `8001` | HTTP listen port |
| `EXAMPOOL_DB` | ./exampool.db | Absolute path to SQLite database file |

> [!CAUTION]
> The default `JWT_SECRET` is publicly known. **Always set a strong, random `JWT_SECRET`** in any non-development deployment. A compromised secret allows anyone to forge valid session tokens.
