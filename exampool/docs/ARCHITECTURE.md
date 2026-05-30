# Exampool Architecture (Current)

## Runtime

- **Backend:** Bun HTTP server (`server.ts`)
- **Database:** SQLite (`exampool.db`) with WAL mode
- **Frontend:** Next.js static export served from `dist/`

## Network Model

- Single server machine on school LAN
- Clients connect via browser over HTTP to `http://<server-ip>:3000`
- Public discovery endpoint: `GET /api/server-info`

## Authentication

- Session cookie: `__exampool_session` (httpOnly, SameSite=Strict)
- JWT payload: `{ sub, role, iat, exp }`
- Login endpoint sets cookie, logout clears cookie

## Database Notes

Startup PRAGMAs:

- `journal_mode = WAL`
- `foreign_keys = ON`
- `busy_timeout = 5000`
- `synchronous = NORMAL`
- `cache_size = -8000`

Core entities:

- `users` (`is_active`, roles)
- `subjects` (`is_published`, `UNIQUE(code, term)`)
- `questions` (`order_index`, `correct_answer`)
- `exams` (`UNIQUE(student_id, subject_id)`, `status`)
- `audit_logs`
- `settings` (`SCHEMA_VERSION`, `CURRENT_TERM`, `REGISTRATION_OPEN`)

## API Envelope

Responses use one of:

- `{ data: ... }`
- `{ message: "..." }`
- `{ error: "..." }`

## Key Authorization Rules

- All protected routes call auth verification first.
- Teacher mutations are ownership-checked against `subjects.teacher_id`.
- Student questions strip `correct_answer` from response.
- Operator-only controls: users, audit logs, settings import/export/reset.

## Exam Concurrency

- Submit path uses SQLite `BEGIN IMMEDIATE` guard.
- Submit transition enforces `status = 'in-progress'` to prevent double-submit race.
- Frontend auto-save cadence is 30 seconds.

## Frontend Session Behavior

- Frontend uses cookie sessions (`credentials: "include"`).
- On `401`, user is redirected to login.
- On `503`, user is redirected to setup.

## Important Migration Note

Schema version migration currently resets legacy tables when upgrading to schema v2 to align with the documented model.
