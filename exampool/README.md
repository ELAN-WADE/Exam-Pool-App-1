# Exampool LAN

Offline-first LAN examination system with:

- Bun backend (`server.ts`) + SQLite (`exampool.db`)
- Next.js frontend static build in `frontend/`
- Cookie-based auth (`__exampool_session`)

## Prerequisites

Install these first on the server machine:

- [Bun](https://bun.sh/docs/installation) (required for backend and package management)
- Git (optional, recommended)

## Quick Start (Windows PowerShell)

```powershell
cd "c:\Users\DUDU\Documents\EXAM POOL\exampool"
bun install
cd frontend
bun install
cd ..
```

Run backend:

```powershell
bun server.ts
```

Run frontend (dev):

```powershell
cd frontend
bun run dev
```

Run frontend build (static export):

```powershell
cd frontend
bun run build
```

## LAN Access

On backend start, the server prints available IPv4 LAN addresses:

- `Students should open: http://<IP>:3000`

## API and Architecture

See `docs/ARCHITECTURE.md` for:

- network model
- DB and auth model
- key API contracts
- concurrency notes

## Notes

- Backend default port is `3000`.
- Authentication uses httpOnly cookies (with Bearer fallback for compatibility).
- SQLite schema is versioned by `settings.SCHEMA_VERSION`.
