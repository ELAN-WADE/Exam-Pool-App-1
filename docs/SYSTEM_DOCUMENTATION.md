# Exampool — Full System Documentation

> **Version:** 5.0 (Schema v5.0 Naija Hybrid Enterprise)  
> **Stack:** Bun HTTP · SQLite (WAL) + ATTACHED DBs · Next.js 15 (static export)  
> **Last updated:** 2026-07-26  

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Database Schema & Entity Relationships](#2-database-schema--entity-relationships)
3. [v5 Academic Structure (Terms, Classes, Timetables, Guardians)](#3-v5-academic-structure)
4. [Authentication & Session Management](#4-authentication--session-management)
5. [Request Routing & API Design](#5-request-routing--api-design)
6. [Authorization Model (RBAC)](#6-authorization-model-rbac)
7. [Exam Lifecycle & State Machine](#7-exam-lifecycle--state-machine)
8. [Grading Algorithms](#8-grading-algorithms)
9. [Concurrency & Data Integrity](#9-concurrency--data-integrity)
10. [Anti-Cheat Mechanisms (Frontend)](#10-anti-cheat-mechanisms-frontend)
11. [Frontend Exam Engine](#11-frontend-exam-engine)
12. [Schema Migration Strategy](#12-schema-migration-strategy)
13. [Input Validation Rules](#13-input-validation-rules)
14. [Static File Serving & Path Containment](#14-static-file-serving--path-containment)
15. [Audit Logging System](#15-audit-logging-system)
16. [Complete API Reference (v1 & v2)](#16-complete-api-reference)
17. [Real-Time Features (SSE)](#17-real-time-features-sse)
18. [Practice Mode & Content Bank](#18-practice-mode--content-bank)
19. [Kiosk Mode](#19-kiosk-mode)
20. [Offline Assignment Mode](#20-offline-assignment-mode)
21. [File Upload System](#21-file-upload-system)
22. [Licensing System](#22-licensing-system)
23. [Security Vulnerabilities & Hardening Applied](#23-security-vulnerabilities--hardening-applied)
24. [Deployment Architecture](#24-deployment-architecture)
25. [Environment Variables Reference](#25-environment-variables-reference)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Browser                        │
│          (Next.js SPA — served as static HTML/JS)           │
│                                                             │
│  Roles:  Student · Teacher · Operator(Admin) · Kiosk · Guardian
└──────────────────────┬──────────────────────────────────────┘
                       │  HTTP (LAN / public internet)
                       │  Cookie: __exampool_session (JWT)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               Bun HTTP Server  (server.ts)                  │
│   Port: 8001 (default) — listen 0.0.0.0                     │
│                                                             │
│   ┌───────────────────┐  ┌──────────────────────────────┐  │
│   │  API Router       │  │  Static File Server          │  │
│   │  /api/* →         │  │  /* → serveStatic()          │  │
│   │  handleApi()      │  │  distDir (auto-resolved)     │  │
│   └────────┬──────────┘  └────────┬─────────────────────┘  │
│            │                      │ Canonical path containment
│   ┌────────▼──────────────────────▼───────────────────┐    │
│   │  Middleware Stack                                 │    │
│   │  • CORS headers (corsHeaders)                     │    │
│   │  • Security headers (X-Frame, CSP, HSTS etc.)     │    │
│   │  • Sliding-window Rate limiter (Map + 5min GC)    │    │
│   │  • requireAuth() → verifyToken() → DB user check  │    │
│   │  • requireRole() → RBAC enforcement               │    │
│   └────────┬──────────────────────────────────────────┘    │
│            │                                                │
│   ┌────────▼──────────────────────────────────────────┐    │
│   │  auth.ts · validation.ts · crypto_utils.ts        │    │
│   │  db.ts (queries)                                  │    │
│   └────────────────────────┬──────────────────────────┘    │
│                            │                                │
│   ┌────────────────────────▼──────────────────────────┐    │
│   │         SQLite  (exampool.db)  — WAL mode         │    │
│   │         SQLite  (content_bank.db)  — ATTACHED     │    │
│   │         SQLite  (practice_logs.db) — ATTACHED     │    │
│   └───────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Bun | Native SQLite driver, fast HTTP, zero-dependency TS execution |
| Database | SQLite + WAL + ATTACHED DBs | Zero-infrastructure, LAN-latency safe, high read concurrency |
| Auth | Self-signed JWT (HS256) in httpOnly cookie | No third-party dependency; SameSite=Strict CSRF protection |
| Password Hashing | Argon2id | Memory-hard algorithm; resistant to GPU brute-force attacks |
| Frontend | Next.js 15 static export | Pre-built SPA served directly from Bun backend; no Node.js at runtime |
| Rate Limiting | In-memory IP Map with 5min GC | Lightweight protection for LAN/cloud deployment without Redis |
| Path Protection | `path.resolve` containment check | Guarantees static file serving cannot escape `distDir` |

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
       +---> terms (v5 academic terms)
       |       id, session, name, start_date, end_date, is_active, registration_open, created_at
       |
       +---> classes (v5 class levels)
       |       id, name, section, level (junior|senior), created_at
       |
       +---> class_enrollments (v5 class roster)
       |       id, student_id, class_id, term_id, enrollment_date
       |
       +---> timetables (v5 class timetables)
       |       id, class_id, subject_id, term_id, teacher_id, day_of_week, start_time, end_time, classroom
       |
       +---> guardian_student_links (v5 guardian connections)
       |       id, guardian_id, student_id, relationship, verification_method, status, verified_by, verified_at
       |
       +---> subjects
               id, name, code, term (UNIQUE: code+term),
               duration (minutes, 1-360), total_score (computed),
               exam_datetime, window_duration, is_published, can_retake, mode
```

---

## 3. v5 Academic Structure

Schema v5 introduces full school administrative management:

1. **Academic Terms (`terms`):**
   - Tracks school sessions (`2025/2026`) and terms (`First Term`, `Second Term`).
   - Maintains active term flag (`is_active = 1`) and term-specific registration state.
   - Bootstrapped automatically on first deployment (`bootstrap_v5_migration()`).

2. **Classes & Enrollments (`classes`, `class_enrollments`):**
   - Groups students into formal classes (`JSS1 A`, `SS3 Science`) categorized by level (`junior` / `senior`).
   - Links students to classes per academic term.

3. **Timetable Engine (`timetables`):**
   - Schedules weekly class slots (`day_of_week`, `start_time`, `end_time`, `classroom`).
   - Automated conflict checking via SQL prepared statements:
     - `checkTeacherConflict`: Prevents double-booking teachers across classes at the same time.
     - `checkClassroomConflict`: Prevents assigning the same classroom to multiple subjects simultaneously.

4. **Guardian Portal (`guardian_student_links`):**
   - Links parent/guardian accounts to student wards.
   - Verification status lifecycle (`pending` → `approved` / `rejected`) managed by operators.

---

## 4. Authentication & Session Management

### Cookie Configuration
```
__exampool_session=<jwt>; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800[; Secure]
```
- `HttpOnly`: Prevents client-side script access (XSS defense).
- `SameSite=Strict`: Restricts cookie transmission exclusively to same-origin requests (CSRF defense).
- `Secure`: Dynamically appended when `IS_HTTPS=true`.

### Unauthenticated Public Discovery
- `GET /api/server-info` remains unauthenticated to allow frontend status indicators on the login page to detect server IP, port, and online status before and after login.

---

## 5. Static File Serving & Path Containment

Static assets and Next.js SPA HTML pages are served via `serveStatic()`:

```ts
const resolvedDistDir = path.resolve(currentDistDir);

for (const filePath of candidates) {
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(resolvedDistDir + path.sep) && resolvedFilePath !== resolvedDistDir) {
    return apiError(403, "Forbidden");
  }
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, { headers: { ...corsHeaders, "Content-Type": getMimeType(filePath) } });
  }
}
```

This canonical path validation guarantees that path traversal sequences (`/../`, `%2e%2e%2f`) cannot access system files outside `distDir`.

---

## 6. Complete API Reference

### Authentication & Public Discovery
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/server-info` | None | Public discovery — server IP and port |
| POST | `/api/setup` | None | Initial operator account setup |
| POST | `/api/auth/login` | None | Login with email/reg_id and password |
| GET | `/api/auth/me` | Any | Get current session user info |
| POST | `/api/auth/logout` | Any | Log out and clear session cookie |
| POST | `/api/auth/register` | None/Operator | Register student or teacher |
| POST | `/api/auth/change-password` | Any | Change password for current user |

### v2 Academic API (v5 Features)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v2/terms` | Any | List all academic terms |
| POST | `/api/v2/terms` | Operator | Create a new academic term |
| PUT | `/api/v2/terms/:id` | Operator | Update academic term details |
| POST | `/api/v2/terms/:id/activate` | Operator | Activate an academic term |
| GET | `/api/v2/classes` | Any | List all classes |
| POST | `/api/v2/classes` | Operator | Create a class |
| PUT | `/api/v2/classes/:id` | Operator | Update a class |
| DELETE | `/api/v2/classes/:id` | Operator | Delete a class |
| GET | `/api/v2/classes/:id/roster` | Teacher/Operator | Get student roster for a class |
| POST | `/api/v2/classes/:id/enrollments` | Operator | Enroll student in class |
| DELETE | `/api/v2/classes/:id/enrollments/:sid` | Operator | Unenroll student from class |
| GET | `/api/v2/timetables` | Any | Get class timetable slots |
| POST | `/api/v2/timetables` | Operator | Add a timetable slot (conflict-checked) |
| DELETE | `/api/v2/timetables/:id` | Operator | Delete a timetable slot |
| GET | `/api/v2/guardian-links` | Operator/Guardian | List guardian-student connections |
| POST | `/api/v2/guardian-links` | Operator | Create guardian link |
| PUT | `/api/v2/guardian-links/:id/status` | Operator | Approve/reject guardian link |

---

## 7. Security Hardening Applied

1. **Path Traversal Protection:** Resolved paths verified against `distDir` prefix.
2. **Session Cookie Security:** Strict cookie flags (`HttpOnly`, `SameSite=Strict`, conditional `Secure`).
3. **Argon2id Hashing:** Password hashing configured with memory-hard parameters.
4. **Rate Limiting:** Sliding-window IP rate limiter with 5-minute garbage collection.
5. **Stateful Session Check:** `requireAuth()` verifies DB active status (`is_active = 1`) on every request.
6. **SQL Parameterization:** 100% of database operations use parameterized SQLite prepared statements.
