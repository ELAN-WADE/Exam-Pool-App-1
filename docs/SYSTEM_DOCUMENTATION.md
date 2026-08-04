# Exampool — Full System Documentation & Feature Specification

> **Version:** 5.2 (Naija Hybrid Enterprise, Multi-Session RBAC & Cumulative Report Cards)  
> **Stack:** Bun HTTP · SQLite (WAL) + ATTACHED DBs · Next.js 15 (Static SPA Export)  
> **Last Updated:** 2026-08-04  

---

## Table of Contents

1. [Executive Summary & Core Philosophy](#1-executive-summary--core-philosophy)
2. [System Architecture & Runtime Model](#2-system-architecture--runtime-model)
3. [Role-Based Access Control (RBAC) Architecture](#3-role-based-access-control-rbac-architecture)
4. [Admin / Operator Portal Feature Specification](#4-admin--operator-portal-feature-specification)
5. [Teacher Portal Feature Specification](#5-teacher-portal-feature-specification)
6. [Student Portal Feature Specification](#6-student-portal-feature-specification)
7. [Specialized Subsystems (Kiosk, Licensing, Practice, Offline)](#7-specialized-subsystems)
8. [Report Card & Academic Assessment Engine](#8-report-card--academic-assessment-engine)
9. [CBT Exam Engine & Anti-Cheat Subsystem](#9-cbt-exam-engine--anti-cheat-subsystem)
10. [Database Schema & Entity Relationships](#10-database-schema--entity-relationships)
11. [Complete API Reference (v1 & v2)](#11-complete-api-reference)
12. [Security, Performance & Deployment Hardening](#12-security-performance--deployment-hardening)

---

## 1. Executive Summary & Core Philosophy

**Exampool** is an offline-first, hybrid school examination and enterprise academic management platform engineered specifically for schools and institutions in high-latency or bandwidth-constrained environments.

- **Offline-First Capability:** Runs fully self-contained on a local LAN server (via Bun + SQLite) without requiring continuous internet connectivity.
- **Enterprise School Management:** End-to-end management of Academic Sessions, Terms, Class Rosters, Timetables, Grading Scales, Annual Promotions, and Official Cumulative Report Cards.
- **Robust Anti-Cheat CBT Engine:** Computer-Based Testing with fullscreen enforcement, focus tracking, question/option shuffling, and atomic server-side state machines.
- **Multi-Role Security:** Granular Role-Based Access Control (RBAC) enforcing strict separation of concerns across Administrators, Class Teachers, Subject Teachers, Students, and Guardians.

---

## 2. System Architecture & Runtime Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Browser                                │
│           (Next.js 15 App Router — Production Static Export)            │
│                                                                         │
│  Roles:  Admin/Operator · Class Teacher · Subject Teacher · Student     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │  HTTP/HTTPS (LAN / Cloud)
                                     │  Cookie: __exampool_session (JWT)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Bun HTTP Server  (server.ts)                         │
│   Port: 8001 (default) — listen 0.0.0.0                                 │
│                                                                         │
│   ┌─────────────────────┐       ┌───────────────────────────────────┐   │
│   │  API Router         │       │  Static File Server               │   │
│   │  /api/* →           │       │  /* → serveStatic()               │   │
│   │  handleApi()        │       │  distDir (canonical path check)   │   │
│   └──────────┬──────────┘       └─────────────────┬─────────────────┘   │
│              │                                    │                     │
│   ┌──────────▼────────────────────────────────────▼─────────────────┐   │
│   │  Security & Middleware Stack                                    │   │
│   │  • CORS Headers & Security Headers (CSP, X-Frame, HSTS)         │   │
│   │  • Sliding-Window Rate Limiter (IP-based with 5-min GC)         │   │
│   │  • requireAuth() → verifyToken() → DB active check              │   │
│   │  • requireRole() & is_class_teacher RBAC Guard                  │   │
│   └──────────┬──────────────────────────────────────────────────────┘   │
│              │                                                          │
│   ┌──────────▼──────────────────────────────────────────────────────┐   │
│   │  Business Logic & Query Layer (db.ts, auth.ts, crypto_utils.ts) │   │
│   └──────────┬──────────────────────────────────────────────────────┘   │
│              │                                                          │
│   ┌──────────▼──────────────────────────────────────────────────────┐   │
│   │  SQLite WAL Database Cluster                                    │   │
│   │  • exampool.db (Primary Transactional Database)                 │   │
│   │  • content_bank.db (ATTACHED — Question Banks & FTS5 Search)    │   │
│   │  • practice_logs.db (ATTACHED — Student Practice History)       │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Role-Based Access Control (RBAC) Architecture

Exampool enforces a multi-tiered authorization hierarchy:

| Role / Capability | Scope & Permissions | Key Protected Boundaries |
|---|---|---|
| **Operator / Admin** | Institutional Master Authority | Full CRUD across Sessions, Terms, Users, Classes, Subjects, Timetables, Grading, System Settings, Audit Logs, and Global Historical Crawl. |
| **Class Teacher** (`is_class_teacher = true`) | Class & Student Level Authority | Exclusive access to assigned Class Roster, Class Report Card Generation, Promotion/Demotion permissions for class students, and Master Class Remarks. |
| **Subject Teacher** | Subject & Assessment Level Authority | Create/manage questions for assigned subjects, enter Continuous Assessment & Exam scores, create CBT assignments, and manage offline homework. |
| **Student** | Learner Access | Take CBT exams, access self-paced JAMB/WAEC practice packs, view released term results, and submit offline assignments. |
| **Guardian** | Ward Monitoring | Linked access to verified student academic performance and attendance records. |
| **Kiosk** | Dedicated Examination Device | Locked down terminal interface dedicated to student CBT exam taking. |

---

## 4. Admin / Operator Portal Feature Specification

Located at `/ADMIN/*` and `/operator/*`:

### 4.1. Dashboard & Real-Time Metrics
- **Institutional KPI Cards:** Live aggregation of Total Students, Total Teachers, Active Subjects, Exams In-Progress, and Completed Exams.
- **Server Health & Discovery:** Live indicator showing backend IP address, port, database size, memory usage, and connection status.
- **Quick Actions:** Instant shortcut triggers for Term Activation, User Registration, Timetable Creation, and Global Search.

### 4.2. Academic Sessions & Terms Management (`/ADMIN/academic-sessions`)
- **Session Lifecycle:** Create and manage academic years (e.g. `2025/2026`). Switch active sessions without losing historical data.
- **Term Management:** Create First, Second, and Third Terms with distinct start/end dates and registration flags.
- **Term Activation Guard:** Single-click activation of terms with automatic session state synchronization.

### 4.3. Historical Session Snapshots (`SessionSnapshotCard`)
- **Interactive Accordion Analytics:** Collapsible performance cards per academic session.
- **Aggregate Metrics:** Enrolled student counts, active teachers, total subjects (Grading + CBT), completed exams, average score percentages, and total report cards generated.
- **Annual Promotion Breakdown:** Distribution metrics of Promoted, Repeated, and Graduated students for each session.
- **Term-by-Term Sub-Breakdowns:** Per-term exam counts, average scores, and report card completions.
- **Dashboard Filter Focus:** "Filter Dashboard View" button to inspect historical metrics across the entire dashboard.

### 4.4. Global Historical Search & Crawler (`AdminGlobalSearch`)
- **Cross-Session Deep Querying:** Search across all historical sessions without manually switching active sessions.
- **Multi-Entity Indexing:** Instant search across Students, Teachers, Subjects, Exam Submissions, and Report Card Remarks.
- **Live Search Highlighting & Direct Navigation:** Click-through navigation to student report cards, user profiles, or subject grading details.

### 4.5. Class & Class Teacher Management (`/ADMIN/class-teachers`, `/ADMIN/users`)
- **Class Level Management:** Create and configure classes categorized by Junior (JSS1–JSS3) and Senior (SS1–SS3) tiers.
- **Class Teacher Assignment:** Assign designated faculty members as Class Teachers with automatic `is_class_teacher` authorization.
- **Roster Enrollment:** Bulk or individual enrollment of students into classes per academic term.
- **Grade Promotion / Demotion:** Modify student grade levels and class assignments.

### 4.6. Subject & Assessment Management (`/ADMIN/subjects`)
- **Subject Creation:** Define subject name, code, level, and assigned teacher.
- **Grading Scale Configuration:** Customizable CA components (CA1, CA2, CA3, Project, Assignment) and Terminal Exam weighting (e.g., 40% CA / 60% Exam).
- **Publication Controls:** Publish or unpublish subjects for CBT examination access.

### 4.7. Annual Results & Promotion Engine (`/operator/annual-results`)
- **Multi-Term Aggregator:** Aggregates 1st, 2nd, and 3rd term results to compute cumulative annual averages.
- **Decision Engine:** Automatically suggests or records promotion decisions (`Promoted`, `Repeated`, `Graduated`, `Withdrawn`) based on configurable pass marks.
- **Export & Print:** Print-ready master broadsheets and annual result summaries.

### 4.8. Timetable Engine & Conflict Detection (`/ADMIN/timetable`, `/operator/timetable`)
- **Interactive Weekly Grid:** Schedule periods across Monday through Friday with classroom allocations.
- **Automated Collision Prevention:**
  - *Teacher Collision Check:* Prevents double-booking a teacher in multiple classes at the same time.
  - *Classroom Collision Check:* Prevents allocating the same classroom to different subjects simultaneously.

### 4.9. Institution Settings, Branding & Licensing (`/ADMIN/settings`, `/ADMIN/license`)
- **Custom Branding:** School logo upload, school name, motto, address, and report card headers.
- **Grading Boundaries:** Define grade letter boundaries (`A: 75-100`, `B: 65-74`, `C: 50-64`, `D: 40-49`, `F: 0-39`).
- **Cryptographic License Manager:** Verify offline Ed25519/HMAC signed license packages (`license.json`) enforcing terminal limits and activation periods.

### 4.10. Broadcast Notifications & Audit Logging (`/ADMIN/notifications`)
- **Real-Time Notification Dispatch:** Send school-wide or role-targeted announcements via Server-Sent Events (SSE).
- **System Audit Log:** Immutable audit log tracking administrative operations, logins, grade modifications, and promotions.

---

## 5. Teacher Portal Feature Specification

Located at `/teacher/*`:

### 5.1. Teacher Dashboard (`/teacher/dashboard`)
- **Personalized Overview:** Active assigned subjects, student count, total questions created, and upcoming exam schedules.
- **Dedicated Class Teacher Banner:** For teachers designated as Class Teachers, displays their assigned class level and direct links to their Class Report Cards and Roster.

### 5.2. Role-Based Permissions (Class Teacher vs Subject Teacher)
- **Class Teacher Privileges:**
  - Dynamic navigation item **"Report Card"** in `/teacher/layout.tsx` visible exclusively to Class Teachers.
  - Full access to generate and review report cards for their assigned class.
  - Permission to input Class Teacher remarks and principal recommendations.
  - Authority to promote/demote students within their assigned class roster.
- **Subject Teacher Privileges:**
  - Authority to record CA and Exam scores for assigned subjects.
  - Author and manage questions for assigned subjects.
  - Manage and publish offline homework assignments.

### 5.3. Report Card Generation & Management (`/teacher/report-card`)
- **Class Roster Scoping:** Class Teachers only see students enrolled in their assigned class.
- **Session & Term Preservation:** Switching sessions or terms cleanly isolates and loads historical grades and remarks without cross-term contamination.
- **Dual View Layout:**
  - *Single-Term Standard Report:* Term CA breakdown, Exam score, Total, Grade, Class Average, and Remarks.
  - *Cumulative 3rd Term Report:* 9-column format (`1st Term Total` + `2nd Term Total` + `3rd Term CA` + `3rd Term Exam` + `Cumulative Average` + `Annual Grade`).
- **Remark Entry:** Input Form Teacher Remarks and Headmaster/Principal Remarks with instant auto-save.
- **A4 Print Engine:** Pixel-perfect A4 printable layout with school crest, grading legend, and signature blocks.

### 5.4. Continuous Assessment & Grading Center (`/teacher/grading`, `/teacher/grading/details`)
- **Spreadsheet Data Entry Grid:** Fast tab-and-enter score entry for CA1, CA2, CA3, Project, and Terminal Exam.
- **Live Calculations:** Real-time score totalization and grade conversion according to school policy.
- **Session/Term Scoping:** Switch between past and present terms to review historical grade entries.

### 5.5. Question Bank & Exam Creation (`/teacher/questions`, `/teacher/assignments`)
- **Multi-Format Question Builder:** Multiple Choice (Single/Multi-select), True/False, Fill-in-the-Blank, and Theory/Essay questions.
- **Rich Media & LaTeX Support:** Embed images, formulas, and formatted code snippets.
- **CBT Parameter Configuration:** Exam duration, start/end date windows, shuffle questions/answers, pass percentages, and retake allowances.
- **Bulk Question Import:** Import questions via standard JSON and CSV templates.

### 5.6. Offline Homework & Assignment Dispatch (`/teacher/content`)
- **Assignment Distribution:** Create assignments with downloadable study attachments and submission due dates.
- **Submission Review:** Download student file submissions and award grades.

---

## 6. Student Portal Feature Specification

Located at `/student/*`:

### 6.1. Student Dashboard (`/student/dashboard`)
- **Academic Hub:** Displays enrolled subjects, active exam notifications, upcoming tests, and published results.
- **One-Click CBT Launcher:** Direct entry into eligible, published examinations.

### 6.2. Interactive CBT Exam Engine (`/student/exam`)
- **Modern Low-Latency Interface:** High-contrast, responsive test interface with large question navigation grid.
- **State Preservation & Resiliency:**
  - Answers cached in browser `localStorage` and synchronized with the backend every 30 seconds.
  - Network disconnection protection with graceful reconnection synchronization.
- **Anti-Cheat Lockouts:**
  - Fullscreen enforcement modal.
  - Tab switch / blur detection with strike limit counter.
  - Disabled right-click, text selection, and keyboard shortcuts (`Ctrl+C`, `Ctrl+V`, `F12`).
- **Server-Side Timer Enforcement:** Hard deadline calculation on the backend with a 60-second submission grace window.

### 6.3. Self-Paced Practice Center (`/student/practice`)
- **Past Question Packs (`.epkg`):** Practice with official JAMB, WAEC, and NECO past question banks.
- **Instant Mode vs Test Mode:** Practice with immediate answer explanations or simulated timed exam conditions.
- **Practice Analytics:** Topic-level mastery tracking, speed analysis, and historical practice logs stored in `practice_logs.db`.

### 6.4. Results & Academic Records (`/student/results`)
- **Instant Score Release:** View score breakdowns and performance grades upon teacher publication.
- **Question-by-Question Review:** When enabled by the instructor, inspect correct answers, solutions, and explanations.

### 6.5. Offline Assignments Portal (`/student/offline-assignments`)
- **Homework Access:** Download assignment briefs, worksheets, and reference materials.
- **Digital File Submissions:** Upload homework files directly to the portal with submission timestamp verification.

---

## 7. Specialized Subsystems

### 7.1. Kiosk Mode (`/kiosk`)
- Dedicated locked-down examination portal designed for school computer laboratories.
- Simple student ID entry with auto-redirection into assigned exam papers.
- Session auto-clearing upon exam submission to prepare terminal for the next candidate.

### 7.2. Cryptographic Licensing Engine
- Offline-first Ed25519 & HMAC-SHA256 signature verification of `license.json`.
- Enforces maximum student counts, concurrent terminal limits, feature flags, and institutional license validity periods.

### 7.3. Local Network DNS Masking (`dns2`)
- Built-in DNS responder mapping custom institutional domains (e.g. `bbhs.edu.ng` or `exampool.ng`) to the server's local LAN IP address (`10.132.145.32`).
- Enables students and staff to access the portal using a friendly URL on school Wi-Fi without internet connectivity.

---

## 8. Report Card & Academic Assessment Engine

### 8.1. Single-Term Standard Report Card
- Standard 1st or 2nd term report format showing CA components (typically 40 marks), Terminal Exam (typically 60 marks), Total Score (100%), Subject Position, Grade Letter, and Teacher Remarks.

### 8.2. Cumulative 3rd Term Report Card
- Aggregates all three terms in an academic session:
$$\text{Cumulative Total} = \text{Term 1 Total} + \text{Term 2 Total} + \text{Term 3 Total}$$
$$\text{Cumulative Average} = \frac{\text{Cumulative Total}}{3}$$
- 9-Column Table Layout:
  `Subject` · `Code` · `1st Term (100)` · `2nd Term (100)` · `3rd CA (40)` · `3rd Exam (60)` · `3rd Total (100)` · `Cum. Avg (%)` · `Grade`

### 8.3. Session & Term Switch Isolation
- Querying `/api/users/:id/report-card-results?sessionId=X&termId=Y` retrieves records strictly scoped to the requested session and term, preventing data bleed across academic years.

---

## 9. CBT Exam Engine & Anti-Cheat Subsystem

| Mechanism | Implementation Details | Purpose |
|---|---|---|
| **Fullscreen Lockdown** | Enforces `requestFullscreen()`; exits trigger strike warnings. | Prevents side-by-side browsing on desktop. |
| **Blur / Tab Detection** | Window `blur` and `visibilitychange` event listeners log strikes. | Detects switching browser tabs or opening applications. |
| **Answer Masking** | `stripCorrectAnswer()` removes correct answers from student payloads. | Eliminates client-side DOM inspection cheats. |
| **Atomic Submission** | SQLite transactional submission (`status = 'in-progress'` check). | Prevents double-submission and replay attacks. |
| **Server-Side Timer** | `start_time + duration_minutes + 60s grace` evaluated on backend. | Prevents tampering with client-side clocks. |

---

## 10. Database Schema & Entity Relationships

### Primary Database: `exampool.db`

```sql
-- Academic Structure
academic_sessions (id, name, is_active, status, start_date, end_date, created_at)
academic_terms    (id, session_id, name, is_active, status, start_date, end_date, created_at)
classes           (id, name, section, level, class_teacher_id, created_at)
class_enrollments (id, student_id, class_id, term_id, enrollment_date)
timetables        (id, class_id, subject_id, term_id, teacher_id, day_of_week, start_time, end_time, classroom)

-- Users & Authentication
users             (id, name, email, role, password_hash, grade, reg_id, is_active, first_name, last_name, address, phone, dob, image_url, created_at)

-- Subjects & CBT
subjects          (id, session_id, term_id, teacher_id, name, code, duration, total_score, exam_datetime, window_duration, is_published, can_retake, mode)
questions         (id, subject_id, question_text, question_type, options, correct_answer, explanation, marks, order_index)
exams             (id, session_id, term_id, subject_id, student_id, start_time, end_time, status, score, total_score, answers_json)
student_answers   (id, exam_id, question_id, student_answer, marks_awarded, is_correct)

-- Continuous Assessment & Report Cards
grading_subjects  (id, session_id, term_id, teacher_id, class_id, name, code, ca_max, exam_max)
term_results      (id, session_id, term_id, student_id, subject_id, ca_score, exam_score, total_score, grade, is_approved)
student_term_remarks (id, session_id, term_id, student_id, teacher_remarks, principal_remarks, attendance, punctuality)
annual_results    (id, session_id, student_id, class_id, annual_average, promotion_status, remarks)
```

---

## 11. Complete API Reference

### 11.1. Authentication & Identity
- `POST /api/auth/login` — Authenticate user and issue JWT cookie.
- `GET /api/auth/me` — Return authenticated user profile with `is_class_teacher` flag.
- `POST /api/auth/logout` — Clear session cookie.
- `POST /api/auth/change-password` — Update user password.
- `PUT /api/users/:id/grade` — Update student grade level (authorized for Operator, Class Teacher, Subject Teacher).

### 11.2. Academic Session & Term Management
- `GET /api/academic-sessions` — List all academic sessions.
- `POST /api/academic-sessions` — Create academic session.
- `POST /api/academic-sessions/:id/activate` — Set active session.
- `GET /api/academic-terms` — List terms for a session.
- `POST /api/academic-terms/:id/activate` — Activate term.

### 11.3. Historical Analysis & Global Search
- `GET /api/admin/session-snapshots` — Historical aggregate metrics across sessions.
- `GET /api/admin/global-search` — Cross-session search across students, teachers, subjects, and remarks.

### 11.4. Report Cards & Grading
- `GET /api/users/:id/report-card-results` — Multi-term scores and cumulative averages.
- `GET /api/student-term-remarks` — Retrieve teacher and principal remarks.
- `POST /api/student-term-remarks` — Save teacher and principal remarks.
- `GET /api/grading-entries` — Retrieve continuous assessment score entries.
- `POST /api/grading-entries` — Save continuous assessment and exam scores.

### 11.5. CBT Exam Lifecycle
- `POST /api/exams/start` — Initialize exam attempt and begin server timer.
- `POST /api/exams/:id/save` — Periodic answer auto-save.
- `POST /api/exams/:id/submit` — Submit and grade exam attempt.
- `GET /api/exams/:id/result` — Retrieve exam score breakdown.

---

## 12. Security, Performance & Deployment Hardening

1. **Path Containment:** Static file server guarantees `path.resolve` containment within `distDir`, preventing directory traversal attacks.
2. **Argon2id Password Security:** Memory-hard password hashing protecting against offline GPU cracking.
3. **Session Cookie Defense:** `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` prevents cross-site request forgery (CSRF) and script hijacking.
4. **Sliding-Window Rate Limiting:** Dynamic memory-managed sliding window protecting against brute-force attacks.
5. **Zero-Latency SQLite WAL:** SQLite in Write-Ahead Logging mode (`PRAGMA journal_mode = WAL`) supporting high-concurrency LAN traffic.
