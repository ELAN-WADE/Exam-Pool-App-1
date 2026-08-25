# Guardian System — Architecture Audit & Implementation Plan

## A. Current Architecture

### System Overview
ExamPool is a school management platform built with:
- **Backend**: Bun.js + SQLite (via `bun:sqlite`)
- **Frontend**: Next.js 14+ with App Router
- **Auth**: JWT tokens (access + refresh) with device fingerprinting
- **Database**: SQLite with WAL mode, foreign keys, attached databases (content_bank, practice_logs)

### Database Schema (Key Tables)
```
users (id, name, email, role, password_hash, grade, grade_level_id, ...)
  └─ role CHECK: 'student' | 'teacher' | 'operator' | 'guardian'

guardian_student_links (id, guardian_id, student_id, relationship, status, ...)
  └─ status CHECK: 'pending' | 'approved' | 'rejected' | 'revoked'

subjects (id, name, code, teacher_id, term_id, session_id, ...)
exams (id, student_id, subject_id, score, total_score, status, ...)
term_results (id, student_id, grading_subject_id, ca_score, exam_score, ...)
grading_subjects (id, name, code, class_id, term_id, teacher_id, ...)
classes (id, name, section, level, class_teacher_id, ...)
class_enrollments (id, student_id, class_id, term_id, ...)
academic_sessions / academic_terms
notifications (id, user_id, type, message, link, is_read, ...)
```

### Role Architecture

| Role | Capabilities | Data Access |
|------|-------------|-------------|
| **operator** | Full CRUD on all resources, user management, grading config, term management | All data |
| **teacher** | Create/manage own subjects, questions, enrollments, grade own students, view own results | Own subjects, enrolled students |
| **student** | Take exams, view own results, practice | Own exams, own results |
| **guardian** | ⚠️ **INCOMPLETE**: Only can create link requests | Only approved wards (via `getGuardianWards` query) |

### Existing Guardian Infrastructure

**Backend (Implemented):**
- ✅ `guardian` role in users table
- ✅ `guardian_student_links` table with full schema
- ✅ `POST /api/v2/guardian-links` (create link request)
- ✅ `GET /api/v2/guardian-links` (admin view of all links)
- ✅ `PUT /api/v2/guardian-links/:id/(approve|reject|revoke)`
- ✅ Repository: `GuardianStudentLinkRepository`
- ✅ Service: `AcademicService.getGuardianLinks()`
- ✅ Queries: `getGuardianWards`, `getStudentGuardians`
- ✅ Permission seed: `["guardian", "student:read:wards"]`

**Frontend (Missing):**
- ❌ No `/guardian/` route pages
- ❌ No guardian layout or navigation
- ❌ No guardian-specific components
- ❌ Guardian not in `SessionUser` type
- ❌ Guardian not in middleware role map
- ❌ Guardian not in LoginForm redirect logic
- ❌ Guardian not in RequireRole component
- ❌ No guardian API calls in frontend

---

## B. Problems Found

### Critical (Security/Authorization)

1. **Data Leakage Risk**: `/api/exams/results` has no guardian-specific branch. A guardian hitting this endpoint falls through to operator-level query returning ALL exam results system-wide.

2. **Missing Authorization Check**: `student:read:wards` permission is seeded but never enforced in any API route. The `requireRole` function only checks role string, not granular permissions.

3. **No Ward Data Access**: Guardians cannot access their wards' results, report cards, grades, or exam schedules through any API endpoint.

### High Priority (Architecture)

4. **Frontend-Backend Disconnect**: Backend fully supports guardian role with database, API, and audit logging, but frontend has zero support.

5. **Incomplete Guardian Dashboard**: No endpoint to aggregate ward information for a guardian's dashboard view.

6. **No Notification Logic**: No mechanism to push ward-related events (results published, remarks added) to guardians.

7. **Middleware Gap**: Frontend middleware doesn't recognize guardian role, would redirect guardians to `/`.

### Medium Priority (Maintainability)

8. **TypeScript Types Incomplete**: `SessionUser.role` and `User.role` don't include `guardian`.

9. **Registration Excluded**: No way for guardians to self-register through the UI.

10. **Admin Users Page**: No guardian tab or count in user management.

---

## C. Hidden Risks

1. **Silent Authorization Failures**: If a guardian somehow accesses operator routes, they could see all data without explicit denial.

2. **Stale Cache**: Teacher subject cache and class teacher cache don't account for guardian access patterns.

3. **Audit Trail Gap**: Guardian data access is not logged, making it impossible to track unauthorized access attempts.

4. **Notification Delivery**: No push mechanism exists to alert guardians of important events.

5. **Scalability**: Current architecture assumes single-school deployment. Guardian-student links are global, not scoped to schools.

---

## D. Recommended Architecture

### 1. Guardian Domain Model

```
Guardian Domain
├── Guardian Profile
│   ├── Personal Info (from users table)
│   └── Linked Wards (from guardian_student_links)
├── Ward Access
│   ├── Academic Results (term_results, exams)
│   ├── Attendance (future: attendance_records)
│   ├── Report Cards (term_results + remarks)
│   └── Exam Schedule (timetables)
├── Communication
│   ├── Ward Messages (future: messages table)
│   └── School Announcements (future: announcements table)
└── Notifications
    ├── Result Published
    ├── Remark Added
    └── Upcoming Exams
```

### 2. API Design for Guardian

```
GET  /api/guardian/wards                    → List approved wards
GET  /api/guardian/wards/:id/results        → Ward's term results
GET  /api/guardian/wards/:id/report-card    → Ward's report card
GET  /api/guardian/wards/:id/exams          → Ward's exam history
GET  /api/guardian/wards/:id/attendance     → Ward's attendance (future)
GET  /api/guardian/notifications            → Guardian-specific notifications
POST /api/guardian/links                    → Create link request
GET  /api/guardian/links                    → View own link requests
```

### 3. Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GUARDIAN DATA FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Teacher Creates Result                                     │
│       ↓                                                     │
│  term_results INSERT                                        │
│       ↓                                                     │
│  Notification Created (type: 'result_published')            │
│       ↓                                                     │
│  Guardian SSE Stream Updated                                │
│       ↓                                                     │
│  Guardian Dashboard Auto-Refreshes                          │
│       ↓                                                     │
│  Guardian Views Ward Result                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4. Authorization Flow

```
Guardian Request
    ↓
requireAuth() → Verify JWT, extract userId + role
    ↓
requireRole(role, ['guardian']) → Verify role
    ↓
getGuardianWards(userId) → Get approved ward IDs
    ↓
Check if requested resource belongs to approved ward
    ↓
Return data or 403 Forbidden
```

---

## E. Required Changes

### Backend Changes

#### 1. New API Endpoints (server.ts)

```typescript
// Guardian Wards
GET /api/guardian/wards
GET /api/guardian/wards/:id/results
GET /api/guardian/wards/:id/report-card
GET /api/guardian/wards/:id/exams

// Guardian Links (self-service)
GET /api/guardian/links
POST /api/guardian/links

// Guardian Notifications
GET /api/guardian/notifications
```

#### 2. New Queries (db.ts)

```typescript
// Guardian-specific queries
getGuardianWardsWithStats: db.prepare(`
  SELECT gsl.*, 
    su.name as student_name, su.grade, su.reg_id, su.image_url,
    (SELECT COUNT(*) FROM exams WHERE student_id = su.id AND status = 'completed') as completed_exams,
    (SELECT ROUND(AVG(CASE WHEN status = 'completed' AND total_score > 0 THEN CAST(score AS REAL)/total_score*100 END), 1) FROM exams WHERE student_id = su.id) as avg_score
  FROM guardian_student_links gsl
  JOIN users su ON su.id = gsl.student_id
  WHERE gsl.guardian_id = ? AND gsl.status = 'approved'
`),

getWardTermResults: db.prepare(`
  SELECT tr.*, gs.name as subject_name, gs.code
  FROM term_results tr
  JOIN grading_subjects gs ON gs.id = tr.grading_subject_id
  WHERE tr.student_id = ? AND tr.term_id = ? AND tr.is_approved = 1
`),

getWardExams: db.prepare(`
  SELECT e.*, s.name as subject_name, s.code
  FROM exams e
  JOIN subjects s ON s.id = e.subject_id
  WHERE e.student_id = ? AND e.status = 'completed'
  ORDER BY e.end_time DESC
`),
```

#### 3. Authorization Service Updates

```typescript
// Add to AuthorizationService
canGuardianAccessWard(guardianId: number, studentId: number): boolean {
  const link = this.db.prepare(
    "SELECT 1 FROM guardian_student_links WHERE guardian_id = ? AND student_id = ? AND status = 'approved'"
  ).get(guardianId, studentId);
  return !!link;
}
```

#### 4. Notification Integration

```typescript
// When result is published
function notifyGuardiansOfResult(studentId: number, resultId: number) {
  const guardians = queries.getStudentGuardians.all(studentId);
  for (const guardian of guardians) {
    queries.createNotification.run(
      guardian.guardian_id,
      'result_published',
      `New result available for your ward`,
      `/guardian/wards/${studentId}/results`
    );
  }
}
```

### Frontend Changes

#### 1. Type Updates (lib/types.ts)

```typescript
type Role = "student" | "teacher" | "operator" | "guardian";

interface SessionUser {
  userId: number;
  role: Role;
  // ...
}
```

#### 2. Middleware Updates (middleware.ts)

```typescript
const routeRoleMap: { pattern: RegExp; role: Role }[] = [
  { pattern: /^\/student\/(?!$)/, role: "student" },
  { pattern: /^\/teacher\/(?!$)/, role: "teacher" },
  { pattern: /^\/ADMIN\/(?!$)/, role: "operator" },
  { pattern: /^\/guardian\/(?!$)/, role: "guardian" },  // ADD THIS
];
```

#### 3. LoginForm Updates

```typescript
// Add guardian redirect logic
if (user.role === "guardian") {
  router.push("/guardian/dashboard/");
}
```

#### 4. New Guardian Pages

```
app/guardian/
├── layout.tsx          # Guardian layout with sidebar
├── dashboard/
│   └── page.tsx        # Guardian dashboard
├── wards/
│   ├── page.tsx        # List of wards
│   └── [id]/
│       ├── page.tsx    # Ward overview
│       ├── results/
│       │   └── page.tsx
│       ├── report-card/
│       │   └── page.tsx
│       └── exams/
│           └── page.tsx
├── links/
│   └── page.tsx        # Manage guardian links
└── settings/
    └── page.tsx
```

#### 5. Guardian Navigation

```typescript
const guardianNav = [
  { label: "Dashboard", href: "/guardian/dashboard/", icon: "dashboard" },
  { label: "My Wards", href: "/guardian/wards/", icon: "people" },
  { label: "Links", href: "/guardian/links/", icon: "link" },
  { label: "Notifications", href: "/guardian/notifications/", icon: "notifications" },
  { label: "Settings", href: "/guardian/settings/", icon: "settings" },
];
```

---

## F. Guardian Architecture

### Dashboard Components

1. **Ward Overview Cards**
   - Student name, class, reg_id
   - Average score
   - Completed exams count
   - Quick links to results

2. **Recent Results Feed**
   - Latest exam results for all wards
   - Grade, score, teacher remarks
   - Timestamp

3. **Upcoming Events**
   - Exam schedules for wards
   - Academic calendar events
   - Payment reminders (future)

4. **Notifications Panel**
   - Result published alerts
   - New remarks
   - Message notifications

### Ward Detail View

1. **Academic Summary**
   - Term-by-term performance
   - Subject breakdown
   - Grade trends

2. **Exam History**
   - All completed exams
   - Scores, attempts, retakes
   - Teacher feedback

3. **Report Card**
   - Term results
   - CA + Exam breakdown
   - Principal/teacher remarks

4. **Attendance (Future)**
   - Daily attendance log
   - Attendance percentage
   - Absence reasons

---

## G. Data Flow Diagrams

### Flow 1: Result Published → Guardian Notification

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Teacher    │     │   Backend    │     │   Guardian   │
│   Grades     │────▶│   System     │────▶│   Dashboard  │
│   Student    │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  INSERT INTO │
                     │ term_results │
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Create      │
                     │ Notification │
                     │ (guardian)   │
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  SSE Push    │
                     │  to Guardian │
                     └──────────────┘
```

### Flow 2: Guardian Views Ward Results

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Guardian   │────▶│   API Route  │────▶│   Database   │
│   Request    │     │   /api/      │     │   Query      │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ 1. Verify    │
                     │    Auth      │
                     │ 2. Check     │
                     │    Ward Link │
                     │ 3. Fetch     │
                     │    Results   │
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Return Ward  │
                     │ Results Only │
                     └──────────────┘
```

### Flow 3: Guardian-Teacher Communication (Future)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Guardian   │────▶│   Messages   │────▶│   Teacher    │
│   Sends      │     │   API        │     │   Receives   │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Create      │
                     │  Message     │
                     │  Record      │
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Notify      │
                     │  Teacher     │
                     └──────────────┘
```

---

## H. Implementation Order

### Phase 1: Backend Foundation (Priority: HIGH)
1. Add guardian-specific API endpoints
2. Implement ward data access queries
3. Add authorization checks for guardian-ward access
4. Update frontend types to include guardian role
5. Update middleware to recognize guardian routes

### Phase 2: Frontend Structure (Priority: HIGH)
1. Create guardian layout with navigation
2. Build guardian dashboard page
3. Build ward list page
4. Build ward detail pages (results, report-card, exams)

### Phase 3: Integration (Priority: MEDIUM)
1. Implement guardian notifications
2. Add real-time updates via SSE
3. Build guardian links management page
4. Add guardian to admin user management

### Phase 4: Enhancement (Priority: LOW)
1. Add guardian-teacher messaging
2. Add attendance tracking for guardians
3. Add payment history view
4. Add academic calendar view

---

## I. Security Considerations

1. **Ward Access Validation**: Every guardian API endpoint must verify the requested student is an approved ward of the authenticated guardian.

2. **No Data Leakage**: Guardian endpoints must never return data for students not linked to the guardian.

3. **Audit Logging**: All guardian data access should be logged for security audit trails.

4. **Rate Limiting**: Guardian endpoints should have appropriate rate limits to prevent abuse.

5. **Token Validation**: Guardian JWT tokens must be validated with the same rigor as other roles.

---

## J. Testing Strategy

1. **Unit Tests**: Test authorization service methods for guardian access
2. **Integration Tests**: Test guardian API endpoints with mock data
3. **E2E Tests**: Test guardian login → dashboard → ward results flow
4. **Security Tests**: Test that guardians cannot access unlinked students' data
5. **Performance Tests**: Test dashboard load times with multiple wards

---

## K. PWA & Mobile Architecture

### PWA Requirements

The Guardian System must be a **Progressive Web App (PWA)** that works on mobile devices over the internet.

**Core Requirements:**
1. **Installable**: Users can add to home screen on iOS/Android
2. **Offline Support**: Core functionality works without internet
3. **Push Notifications**: Real-time alerts for results, events, messages
4. **Mobile-First**: Touch-optimized interface for mobile devices
5. **Internet Access**: Works over public internet, not just LAN

### PWA Configuration

**Current State:**
- ✅ Basic `manifest.json` exists
- ✅ Service worker (`sw.js`) exists with network-first strategy
- ❌ No guardian-specific PWA configuration
- ❌ No push notification support
- ❌ No offline data caching for guardian data

**Required Updates:**

1. **Manifest Updates** (`public/manifest.json`):
```json
{
  "name": "ExamPool Guardian",
  "short_name": "Guardian",
  "description": "Monitor your child's academic progress",
  "start_url": "/guardian/dashboard",
  "display": "standalone",
  "background_color": "#F8FAFC",
  "theme_color": "#6366F1",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/guardian-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/guardian-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "screenshots": [
    {
      "src": "/screenshots/guardian-mobile.png",
      "sizes": "390x844",
      "type": "image/png",
      "form_factor": "mobile"
    }
  ]
}
```

2. **Service Worker Updates** (`public/sw.js`):
```javascript
// Add push notification support
self.addEventListener('push', (event) => {
  const data = event.data.json();
  const options = {
    body: data.message,
    icon: '/icons/guardian-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: { url: data.link },
    actions: [
      { action: 'view', title: 'View Details' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});

// Cache guardian-specific data
const GUARDIAN_CACHE = 'guardian-data-v1';
const GUARDIAN_ROUTES = [
  '/guardian/dashboard',
  '/guardian/wards',
  '/guardian/links',
  '/guardian/calendar'
];
```

3. **Push Notification Integration**:
```typescript
// Frontend: Register push notifications
export async function registerPushNotifications() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: process.env.NEXT_PUBLIC_VAPID_KEY
    });
    
    // Send subscription to backend
    await api.post('/guardian/notifications/subscribe', { subscription });
  }
}

// Backend: Send push notification
async function sendPushNotification(userId: number, notification: Notification) {
  const subscription = await getUserPushSubscription(userId);
  if (subscription) {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: notification.type,
      message: notification.message,
      link: notification.link
    }));
  }
}
```

### Mobile-First Design Requirements

**Touch Interactions:**
- Swipe gestures for navigation
- Pull-to-refresh on data lists
- Tap targets minimum 44x44px
- Long-press for context menus

**Mobile Layout Patterns:**
- Bottom navigation bar for primary actions
- Full-screen modals for forms
- Sheet-style panels for details
- Floating action buttons for primary actions

**Performance:**
- Lazy loading for images and data
- Virtual scrolling for long lists
- Optimistic updates for better UX
- Background sync for offline actions

### Internet Network Requirements

**Current Deployment:**
- ✅ Fly.io deployment configured (`fly.toml`)
- ✅ Docker containerization
- ✅ HTTPS enforced
- ❌ No guardian-specific internet configuration

**Required Changes:**

1. **Environment Variables**:
```bash
# Public internet access
NEXT_PUBLIC_API_URL=https://api.exampool.school
NEXT_PUBLIC_APP_URL=https://guardian.exampool.school
NEXT_PUBLIC_VAPID_KEY=your-vapid-public-key

# Push notification credentials
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_EMAIL=mailto:admin@exampool.school
```

2. **CORS Configuration** (`server.ts`):
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Push": "true"  // For push notifications
};
```

3. **Service Worker Scope**:
```javascript
// Ensure service worker covers all guardian routes
const GUARDIAN_ROUTES = [
  '/guardian/*',
  '/api/guardian/*'
];
```

4. **Offline Data Strategy**:
```typescript
// Cache guardian-specific data
const OFFLINE_CACHE = {
  wards: 'guardian-wards-v1',
  results: 'guardian-results-v1',
  calendar: 'guardian-calendar-v1'
};

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'guardian-sync') {
    event.waitUntil(syncGuardianData());
  }
});
```

### PWA Installation Flow

**Mobile Installation:**
1. User visits guardian URL on mobile browser
2. Browser detects PWA manifest
3. "Add to Home Screen" prompt appears
4. User installs app
5. App launches in standalone mode
6. Push notifications are enabled

**Desktop Installation:**
1. User visits guardian URL in Chrome/Edge
2. Install icon appears in address bar
3. User clicks install
4. App launches in windowed mode

### Offline Capabilities

**Cached Data:**
- Ward list (last 24 hours)
- Recent results (last 7 days)
- Academic calendar (current term)
- Notification history (last 30 days)

**Offline Actions:**
- View cached ward data
- View cached results
- Queue notification subscriptions
- Queue link requests (sync when online)

**Sync Strategy:**
- Background sync when connection restored
- Conflict resolution for concurrent edits
- Retry logic for failed API calls

### Push Notification Types

**Academic Notifications:**
- `result_published` — New exam result available
- `report_card_ready` — Term report card generated
- `remark_added` — Teacher/principal remark added

**Calendar Notifications:**
- `exam_scheduled` — New exam scheduled for ward
- `event_reminder` — Upcoming school event
- `term_starting` — New term beginning

**Communication Notifications:**
- `message_from_teacher` — Teacher sent message
- `announcement` — School announcement

### Security for Internet Access

**Authentication:**
- JWT tokens with short expiry (15 minutes)
- Refresh tokens with device binding
- Biometric authentication support (WebAuthn)

**Data Protection:**
- End-to-end encryption for sensitive data
- HTTPS enforcement for all API calls
- Certificate pinning for mobile apps

**Rate Limiting:**
- API rate limiting per IP/user
- Push notification rate limiting
- Offline action queue limits

## L. Conclusion

The Guardian System has a solid backend foundation but requires significant frontend implementation and API expansion. The recommended approach is to:

1. **First**: Complete the backend API layer with proper authorization
2. **Second**: Build the frontend structure with types, middleware, and layout
3. **Third**: Implement the dashboard and ward views
4. **Fourth**: Add notifications and real-time updates
5. **Fifth**: Implement PWA and mobile optimization
6. **Finally**: Enhance with messaging and additional features

This incremental approach ensures security and functionality are established before UI polish, following the principle of "correct architecture before attractive screens."

**Key Success Factors:**
- Mobile-first design for guardian experience
- PWA capabilities for offline access
- Push notifications for real-time updates
- Internet-accessible deployment
- Secure, role-based data access

---

## M. Internet Network Deployment

### Deployment Architecture

The Guardian System must be accessible over the public internet, not just LAN.

**Current Deployment Options:**
1. **Fly.io** (already configured) — Recommended for production
2. **Railway** — Alternative option
3. **Render** — Alternative option
4. **Self-hosted** — For schools with their own servers

### Fly.io Deployment (Recommended)

**Configuration (`fly.toml`):**
```toml
app = 'exam-pool-guardian'
primary_region = 'ams'

[build]
  dockerfile = 'Dockerfile'

[env]
  EXAMPOOL_DB = '/app/data/exampool.db'
  PORT = '8000'
  NEXT_PUBLIC_API_URL = 'https://api.exam-pool.fly.dev'
  NEXT_PUBLIC_APP_URL = 'https://guardian.exam-pool.fly.dev'
  NEXT_PUBLIC_VAPID_KEY = 'your-vapid-public-key'
  VAPID_PRIVATE_KEY = 'your-vapid-private-key'
  VAPID_EMAIL = 'mailto:admin@exampool.school'

[[mounts]]
  source = 'exampool_data'
  destination = '/app/data'

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0
  processes = ['app']

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
  memory_mb = 512
```

**Deployment Commands:**
```bash
# Install Fly.io CLI
curl -L https://fly.io/install.sh | sh

# Login to Fly.io
fly auth login

# Launch the app
fly launch

# Set secrets
fly secrets set NEXT_PUBLIC_API_URL=https://api.exam-pool.fly.dev
fly secrets set NEXT_PUBLIC_APP_URL=https://guardian.exam-pool.fly.dev
fly secrets set NEXT_PUBLIC_VAPID_KEY=your-vapid-public-key
fly secrets set VAPID_PRIVATE_KEY=your-vapid-private-key

# Deploy
fly deploy
```

### Domain Configuration

**Option 1: Fly.io Subdomains (Default)**
- App: `https://exam-pool.fly.dev`
- API: `https://api.exam-pool.fly.dev`
- Guardian: `https://guardian.exam-pool.fly.dev`

**Option 2: Custom Domain**
```bash
# Add custom domain
fly certs add exampool.school
fly certs add guardian.exampool.school
fly certs add api.exampool.school

# Update DNS records
# Add CNAME records pointing to your Fly.io app
```

### Environment Variables for Internet Access

```bash
# Required for internet access
NEXT_PUBLIC_API_URL=https://api.exampool.school
NEXT_PUBLIC_APP_URL=https://guardian.exampool.school

# Push notification keys
NEXT_PUBLIC_VAPID_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_EMAIL=mailto:admin@exampool.school
```

### CORS Configuration

Update `server.ts` for internet access:
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true"
};
```

### Push Notification Setup

**Generate VAPID Keys:**
```bash
npx web-push generate-vapid-keys
```

**Backend Integration:**
```typescript
import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:admin@exampool.school',
  process.env.NEXT_PUBLIC_VAPID_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushNotification(subscription: PushSubscription, payload: string) {
  await webpush.sendNotification(subscription, payload);
}
```

### Security for Internet Access

1. **HTTPS Enforcement**: All traffic must use HTTPS
2. **JWT Tokens**: Short-lived access tokens (15 minutes)
3. **Rate Limiting**: Per-IP and per-user rate limits
4. **CORS**: Strict origin validation
5. **Input Validation**: Server-side validation on all inputs

### Monitoring and Logging

1. **Health Checks**: `/api/health` endpoint
2. **Error Tracking**: Sentry or similar service
3. **Performance Monitoring**: Response times, error rates
4. **Audit Logs**: Track all guardian data access
