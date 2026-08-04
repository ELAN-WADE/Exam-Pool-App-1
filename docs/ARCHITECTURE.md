# Exampool System Architecture & Design Specification

> **Version:** 5.2 (Naija Hybrid Enterprise & School Management)  
> **Runtime:** Bun HTTP · SQLite (WAL) + Attached DBs · Next.js 15 (Static Export)  
> **Port Defaults:** Backend `8001` (production) / Frontend `3000` (dev)  
> **Last Updated:** 2026-08-04  

---

## 1. Runtime Architecture

- **Backend Server:** Bun HTTP Server (`server.ts`)
  - Multi-threaded, zero-dependency HTTP routing & static asset server listening on `0.0.0.0:8001`.
  - Dynamic static directory resolution (`resolveStaticDistDir()`) auto-detecting `dist/` or `frontend/dist/`.
  - Canonical path containment checks (`path.resolve`) in `serveStatic()` preventing path traversal attacks.
- **Database Engine:** SQLite 3 with WAL Mode (`exampool.db`)
  - Primary single-file transactional database.
  - Performance PRAGMAs: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`, `cache_size = -8000`.
  - Multi-Database Attachment: `content_bank.db` (Question Bank & FTS5 search) and `practice_logs.db` (Student practice audit trails).
- **Frontend SPA:** Next.js 15 App Router (`frontend/`)
  - Pre-built production static export (`output: "export"`, `distDir: "dist"`) served directly by the Bun server.
  - Development proxy (`next.config.ts` rewrites) routing `/api/*` to `http://127.0.0.1:8001`.

---

## 2. Network & Deployment Model

- **Local School LAN / Cloud Hybrid:**
  - Clients connect via browser to `http://<server-ip>:8001` (production) or `http://localhost:3000` (dev).
  - Public Unauthenticated Discovery: `GET /api/server-info` returns active IP and port to power frontend status indicators.
  - Built-in DNS Masking (`dns2`): Optional local DNS server mapping custom domains (e.g. `exampool.ng` or `bbhs.edu.ng`) to the server's primary LAN IP.

---

## 3. Authentication & Security Safeguards

- **Session Management:**
  - Token-based auth stored in HTTP-Only cookies (`__exampool_session`).
  - Cookie Flags: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=28800` (8 hours), with conditional `Secure` flag when `IS_HTTPS=true`.
- **Password Security:** Argon2id hashing via Bun native password utilities (`timeCost: 2`, `memoryCost: 8192` or `65536`).
- **Rate-Limiting:** IP-keyed sliding-window rate limiter on authentication & mutation routes with automatic 5-minute memory garbage collection.
- **Data Isolation:**
  - Strict Role-Based Access Control (`student`, `teacher`, `operator`).
  - Class Teacher status determined dynamically via `SELECT * FROM classes WHERE class_teacher_id = ?`.
  - Student response isolation: `stripCorrectAnswer()` strips `correct_answer` and `teacher_answer` from question payloads for students.
  - Sensitive profile fields (`dob`, `phone`, `password_hash`) stripped from user payloads via `stripPassword()`.

---

## 4. Role Hierarchy & Access Boundaries

| Role | Interface | Primary Scope & Boundaries |
|---|---|---|
| **Operator / Admin** | `/ADMIN/*`, `/operator/*` | Institutional configuration, sessions, terms, user management, license management, global historical search, session snapshots. |
| **Class Teacher** | `/teacher/*` | Assigned class roster, student promotion/demotion for class roster, single-term and cumulative 3rd-term report cards, class teacher remarks. |
| **Subject Teacher** | `/teacher/*` | Assigned subject question bank, continuous assessment (CA) scoring, terminal exam grading, offline assignments. |
| **Student** | `/student/*` | CBT examination taking, offline practice (.epkg), results view, homework submission. |

---

## 5. Report Card Architecture & Multi-Term Logic

- **Multi-Term Aggregation Engine:**
  - Endpoint `/api/users/:id/report-card-results` returns all approved term scores for a student ordered by `session_id ASC, term_id ASC`.
  - Calculates `term_order_in_session` (`1` = First Term, `2` = Second Term, `3` = Third Term) dynamically in SQL.
- **Dual Layout System & Live Preview:**
  - Interactive segment controls `[ Standard (1st/2nd Term) | 3rd Term Cumulative ]` on screen.
  - 9-Column Cumulative Table (`Subject`, `Code`, `1st Term`, `2nd Term`, `3rd C.A.`, `3rd Exam`, `3rd Total`, `Cum. Avg.`, `Grade`).
  - Synchronized A4 Printable PDF frame.
- **Historical Term & Session Isolation:**
  - Switching sessions or terms reloads grades and remarks without polluting active session records.

---

## 6. Historical Record Crawler & Session Analytics

- **Global Search Engine (`AdminGlobalSearch`):**
  - Instant cross-session search across Students, Teachers, Subjects, Exam Submissions, and Remarks without altering active academic session state.
- **Session Snapshots (`SessionSnapshotCard`):**
  - Real-time aggregate performance metrics per session (enrolled students, active teachers, completed exams, average score percentages, report cards generated, and annual promotion distribution).

---

## 7. Exam Concurrency & Data Integrity

- **Transaction Guards:** `db.transaction()` wrapper with `status = 'in-progress'` atomic verification ensures double-submits are prevented (`409 Conflict`).
- **Auto-Save Cadence:** 30-second background auto-save payload sync (`POST /api/exams/:id/save`) with a 60-second grace window after exam expiration.
- **Grace Period Enforcement:** If a submission arrives past the deadline, the backend evaluates only the server-saved state from DB to prevent client-side answer tampering.
