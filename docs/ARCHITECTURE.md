# Exampool System Architecture & Design Specification

> **Version:** 5.0 (Naija Hybrid Enterprise & School Management)  
> **Runtime:** Bun HTTP · SQLite (WAL) + Attached DBs · Next.js 15 (Static Export)  
> **Port Defaults:** Backend `8001` (production) / Frontend `3000` (dev)  

---

## 1. Runtime Architecture

- **Backend Server:** Bun HTTP Server (`server.ts`)
  - Multi-threaded, zero-dependency HTTP routing & static asset server listening on `0.0.0.0:8001`.
  - Dynamic static directory resolution (`resolveStaticDistDir()`) auto-detecting `dist/` or `frontend/dist/`.
  - Canonical path containment checks (`path.resolve`) in `serveStatic()` preventing path traversal attacks.
- **Database Engine:** SQLite 3 with WAL Mode (`exampool.db`)
  - Primary single-file transactional database.
  - Performance PRAGMAs: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`, `cache_size = -8000`.
  - Multi-Database Attachment: `content_bank.db` (Question Bank & FTS search) and `practice_logs.db` (Student practice audit trails).
- **Frontend SPA:** Next.js 15 App Router (`frontend/`)
  - Pre-built production static export (`output: "export"`, `distDir: "dist"`) served directly by the Bun server.
  - Development proxy (`next.config.ts` rewrites) routing `/api/*` to `http://127.0.0.1:8001`.

---

## 2. Network & Deployment Model

- **Local School LAN / Cloud Hybrid:**
  - Clients connect via browser to `http://<server-ip>:8001` (production) or `http://localhost:3000` (dev).
  - Public Unauthenticated Discovery: `GET /api/server-info` returns active IP and port to power frontend status indicators.
  - Built-in DNS Masking (`dns2`): Optional local DNS server mapping custom domains (e.g. `exampool.ng`) to the server's primary LAN IP.

---

## 3. Authentication & Security Safeguards

- **Session Management:**
  - Token-based auth stored in HTTP-Only cookies (`__exampool_session`).
  - Cookie Flags: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=28800` (8 hours), with conditional `Secure` flag when `IS_HTTPS=true`.
- **Password Security:** Argon2id hashing via Bun native password utilities (`timeCost: 2`, `memoryCost: 8192` or `65536`).
- **Rate-Limiting:** IP-keyed sliding-window rate limiter on authentication & mutation routes with automatic 5-minute memory garbage collection.
- **Data Isolation:**
  - Strict Role-Based Access Control (`student`, `teacher`, `operator`).
  - Student response isolation: `stripCorrectAnswer()` strips `correct_answer` and `teacher_answer` from question payloads for students.
  - Sensitive profile fields (`dob`, `phone`, `password_hash`) stripped from user payloads via `stripPassword()`.

---

## 4. Core Entity Model (v5 Schema)

- `users`: Core identity table supporting `student`, `teacher`, and `operator` roles with activation status (`is_active`).
- `terms`: Academic terms tracking session (`2025/2026`), name (`First Term`), date boundaries, active flag, and registration state.
- `classes`: Grade levels and sections (`JSS1 A`, `SS3 Science`) with level grouping (`junior`/`senior`).
- `class_enrollments`: Links students to classes per academic term.
- `timetables`: Timetable slots mapping classes, subjects, terms, teachers, days, and times with automated conflict detection.
- `academic_calendar_events`: School-wide calendar events mapped to academic terms.
- `guardian_student_links`: Guardian-to-student relationships with verification workflows (`pending`/`approved`).
- `subjects`: Exam subjects with teacher ownership, duration limits, exam date/time, and publication status (`is_published`).
- `questions`: Objective, essay, and true/false questions linked to subjects with order index and marks.
- `exams`: Student exam attempts with state machine (`in-progress` → `completed`), timers, score computation, and answer archiving.
- `student_answers`: Granular per-question student responses and awarded marks.
- `audit_logs`: Detailed audit trails recording actor ID, action, resource, resource ID, and JSON details.

---

## 5. API Response Conventions

Responses follow a standardized JSON envelope structure:

- **Success with payload:** `{ "data": ... }`
- **Success message:** `{ "message": "..." }`
- **Error response:** `{ "error": "Error description", ... }`

---

## 6. Exam Concurrency & Data Integrity

- **Transaction Guards:** `db.transaction()` wrapper with `status = 'in-progress'` atomic verification ensures double-submits are prevented (`409 Conflict`).
- **Auto-Save Cadence:** 30-second background auto-save payload sync (`POST /api/exams/:id/save`) with a 60-second grace window after exam expiration.
- **Grace Period Enforcement:** If a submission arrives past the deadline, the backend evaluates only the server-saved state from DB to prevent client-side answer tampering.
