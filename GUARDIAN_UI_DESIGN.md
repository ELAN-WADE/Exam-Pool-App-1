# Guardian System — UI/UX Design Specification

## Design Philosophy

The Guardian interface is a **bridge between home and school**. It should feel like a calm, trustworthy window into a student's academic life — not a dashboard for management, but a lens for understanding.

**Core principle**: Guardians don't manage; they observe, understand, and connect.

---

## Visual Identity

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| **Guardian Primary** | `#6366F1` | Primary actions, active states |
| **Guardian Accent** | `#F59E0B` | Warnings, alerts, attention |
| **Success Green** | `#10B981` | Positive indicators, completed |
| **Calm Blue** | `#3B82F6` | Links, informational |
| **Surface** | `#F8FAFC` | Background |
| **Surface Card** | `#FFFFFF` | Cards, panels |
| **Text Primary** | `#1E293B` | Headings, primary text |
| **Text Muted** | `#64748B` | Secondary text |
| **Border** | `#E2E8F0` | Dividers, borders |

**Rationale**: Indigo (`#6366F1`) is chosen as the guardian primary because it conveys trust, wisdom, and protection — qualities associated with guardianship. It's distinct from the admin blue (`#4F7cff`) and teacher green, creating immediate visual differentiation.

### Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| Display | Inter | 700 | 28px |
| Heading | Inter | 600 | 20px |
| Subheading | Inter | 500 | 16px |
| Body | Inter | 400 | 14px |
| Caption | Inter | 400 | 12px |
| Data | JetBrains Mono | 500 | 14px |

**Rationale**: Inter provides excellent readability for data-dense interfaces. JetBrains Mono is used for numerical data (scores, percentages) to create visual distinction for quantitative information.

### Spacing Scale

```
4px  → xs
8px  → sm
12px → md
16px → lg
24px → xl
32px → 2xl
48px → 3xl
```

---

## Layout Architecture

### Guardian Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  [Sidebar]  │  [TopBar]                                     │
│             │  ┌───────────────────────────────────────────┐│
│  Dashboard  │  │                                           ││
│  My Wards   │  │  [Main Content Area]                      ││
│  Links      │  │                                           ││
│  Calendar   │  │                                           ││
│  Settings   │  │                                           ││
│             │  │                                           ││
│             │  └───────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Sidebar Navigation

```typescript
const guardianNav: NavItem[] = [
  {
    section: "Overview",
    href: "/guardian/dashboard",
    label: "Dashboard",
    icon: <DashboardIcon />,
  },
  {
    section: "My Wards",
    href: "/guardian/wards",
    label: "My Wards",
    icon: <WardsIcon />,
  },
  {
    section: "Connection",
    href: "/guardian/links",
    label: "Guardian Links",
    icon: <LinkIcon />,
  },
  {
    section: "Information",
    href: "/guardian/calendar",
    label: "Academic Calendar",
    icon: <CalendarIcon />,
  },
  {
    section: "Account",
    href: "/guardian/settings",
    label: "Settings",
    icon: <SettingsIcon />,
  },
];
```

---

## Page Designs

### 1. Guardian Dashboard

**Purpose**: At-a-glance overview of all wards' academic status.

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  Welcome back, [Guardian Name]                              │
│  Here's what's happening with your wards today              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Ward Count  │ │ Avg Score   │ │ Alerts      │           │
│  │     2       │ │    78%      │ │     3       │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────┐ ┌───────────────────────┐│
│  │ Recent Results                │ │ Upcoming Events       ││
│  │                               │ │                       ││
│  │  • John - Mathematics - 85%   │ │  • Mid-term Exam      ││
│  │  • Jane - English - 72%       │ │    Mar 15-19          ││
│  │  • John - Science - 91%       │ │  • Parent-Teacher     ││
│  │                               │ │    Meeting - Mar 22   ││
│  │  [View All Results]           │ │  [View Calendar]      ││
│  └───────────────────────────────┘ └───────────────────────┘│
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Ward Performance Overview                             │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  John Doe - JSS 2                               │  │  │
│  │  │  Average: 82% │ Trend: ↑ Improving              │  │  │
│  │  │  [View Details]                                 │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Jane Doe - SS 1                                │  │  │
│  │  │  Average: 75% │ Trend: → Stable                 │  │  │
│  │  │  [View Details]                                 │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Components**:
- `GuardianStatsCards` — Summary statistics
- `RecentResultsFeed` — Latest results from all wards
- `UpcomingEventsList` — Academic calendar events
- `WardPerformanceCards` — Individual ward summaries

### 2. My Wards Page

**Purpose**: List and manage all linked wards.

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  My Wards                                    [+ Add Ward]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  🔍 Search wards...                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ┌─────────┐                                          │  │
│  │  │  [Photo] │  John Doe                               │  │
│  │  │         │  JSS 2 • Reg: STD/2024/001              │  │
│  │  └─────────┘  Relationship: Son                      │  │
│  │                                                       │  │
│  │  Average: 82% │ Exams: 12 │ Status: Active           │  │
│  │                                                       │  │
│  │  [View Results] [View Report Card] [View Exams]       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ┌─────────┐                                          │  │
│  │  │  [Photo] │  Jane Doe                               │  │
│  │  │         │  SS 1 • Reg: STD/2024/002               │  │
│  │  └─────────┘  Relationship: Daughter                 │  │
│  │                                                       │  │
│  │  Average: 75% │ Exams: 10 │ Status: Active           │  │
│  │                                                       │  │
│  │  [View Results] [View Report Card] [View Exams]       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Components**:
- `WardCard` — Individual ward display with quick actions
- `WardSearch` — Search/filter wards
- `AddWardButton` — Trigger link request flow

### 3. Ward Detail Page

**Purpose**: Deep dive into a specific ward's academic progress.

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  ← Back to Wards                                           │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ┌─────────┐                                          │  │
│  │  │  [Photo] │  John Doe                               │  │
│  │  │         │  JSS 2 • Reg: STD/2024/001              │  │
│  │  └─────────┘  Relationship: Son                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  [Results] [Report Card] [Exams] [Attendance]        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Term Results - First Term 2026/2027                  │  │
│  │                                                       │  │
│  │  Subject      CA    Exam   Total   Grade   Status     │  │
│  │  ─────────────────────────────────────────────────    │  │
│  │  Mathematics  45    40     85      A       Excellent  │  │
│  │  English      38    34     72      B+      Very Good  │  │
│  │  Science      48    43     91      A+      Excellent  │  │
│  │  Social St.   42    38     80      A       Very Good  │  │
│  │                                                       │  │
│  │  Average: 82% │ Class Position: 3rd of 35             │  │
│  │                                                       │  │
│  │  Teacher Remark: John is a diligent student who       │  │
│  │  consistently performs well. Keep it up!              │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Components**:
- `WardProfileHeader` — Ward info with photo
- `WardTabNavigation` — Results/Report Card/Exams tabs
- `WardResultsTable` — Detailed results grid
- `WardPerformanceChart` — Visual performance trend

### 4. Guardian Links Page

**Purpose**: Manage guardian-student link requests.

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  Guardian Links                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Pending Requests (2)                                 │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Request to link: Sarah Johnson                 │  │  │
│  │  │  Student: MJ/2024/005 • JSS 3                   │  │  │
│  │  │  Relationship: Niece                             │  │  │
│  │  │  Status: Pending Approval                        │  │  │
│  │  │  Submitted: Jan 15, 2026                         │  │  │
│  │  │                                                 │  │  │
│  │  │  [Cancel Request]                                │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Active Links (2)                                     │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  ✓ John Doe - JSS 2                             │  │  │
│  │  │  Relationship: Son • Approved: Jan 10, 2026     │  │  │
│  │  │  [View Ward] [Revoke Link]                       │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  ✓ Jane Doe - SS 1                              │  │  │
│  │  │  Relationship: Daughter • Approved: Jan 10, 2026│  │  │
│  │  │  [View Ward] [Revoke Link]                       │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  [+ Request New Link]                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Components**:
- `PendingLinksList` — Links awaiting approval
- `ActiveLinksList` — Approved guardian-ward links
- `RequestLinkModal` — Form to request new ward link

### 5. Academic Calendar Page

**Purpose**: View school events relevant to wards.

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  Academic Calendar                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  March 2026                                           │  │
│  │                                                       │  │
│  │  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐        │  │
│  │  │ Sun │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │        │  │
│  │  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤        │  │
│  │  │     │     │     │     │     │     │  1  │        │  │
│  │  │  2  │  3  │  4  │  5  │  6  │  7  │  8  │        │  │
│  │  │  9  │ 10  │ 11  │ 12  │ 13  │ 14  │ 15  │        │  │
│  │  │ 16  │ 17  │ 18  │ 19  │ 20  │ 21  │ 22  │        │  │
│  │  │ 23  │ 24  │ 25  │ 26  │ 27  │ 28  │ 29  │        │  │
│  │  │ 30  │ 31  │     │     │     │     │     │        │  │
│  │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Upcoming Events                                      │  │
│  │                                                       │  │
│  │  📅 Mar 15-19: Mid-term Examination Period            │  │
│  │     Affected Wards: John (JSS 2), Jane (SS 1)        │  │
│  │                                                       │  │
│  │  📅 Mar 22: Parent-Teacher Meeting                    │  │
│  │     Time: 10:00 AM - 2:00 PM                          │  │
│  │                                                       │  │
│  │  📅 Mar 29: End of Term                               │  │
│  │     Term Break: Mar 29 - Apr 13                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Components**:
- `CalendarGrid` — Monthly calendar view
- `EventList` — Upcoming events with ward impact
- `EventCard` — Individual event details

---

## Signature Element: Ward Progress Ring

The **Ward Progress Ring** is the memorable visual element of the Guardian interface. It's a circular progress indicator that shows each ward's overall academic performance at a glance.

```
        ┌─────────────────┐
        │    ┌───────┐    │
        │   /         \   │
        │  │    82%    │  │
        │  │   John    │  │
        │   \         /   │
        │    └───────┘    │
        │  ↑ Improving    │
        └─────────────────┘
```

**Design Rules**:
- Green ring (≥80%): Excellent performance
- Blue ring (60-79%): Good performance
- Amber ring (40-59%): Needs attention
- Red ring (<40%): Requires immediate focus

**Animation**: The ring fills on page load with a smooth ease-out animation. The percentage counter animates from 0 to the actual value.

---

## Responsive Breakpoints

| Breakpoint | Layout |
|------------|--------|
| < 640px | Single column, stacked cards, hamburger menu |
| 640-1024px | Two-column grid, collapsible sidebar |
| > 1024px | Full sidebar, three-column grid |

---

## Interaction Patterns

### 1. Ward Selection
- Clicking a ward card navigates to ward detail
- Ward photo/name is always visible in the header
- Back button returns to wards list

### 2. Data Refresh
- Dashboard auto-refreshes every 30 seconds
- Manual refresh button available
- SSE connection for real-time notifications

### 3. Loading States
- Skeleton loaders for cards
- Progress rings animate on load
- Shimmer effect for data tables

### 4. Empty States
- "No wards linked yet" with prominent "Add Ward" CTA
- "No results available" with explanation
- "No upcoming events" with calendar link

---

## Accessibility

- All interactive elements have focus indicators
- Color is never the only indicator (icons + text always accompany)
- ARIA labels on all buttons and links
- Keyboard navigation support
- Reduced motion media query support

---

## Implementation Notes

### Component Structure

```
components/guardian/
├── Dashboard/
│   ├── GuardianStatsCards.tsx
│   ├── RecentResultsFeed.tsx
│   ├── UpcomingEventsList.tsx
│   └── WardPerformanceCards.tsx
├── Wards/
│   ├── WardCard.tsx
│   ├── WardList.tsx
│   ├── WardDetail.tsx
│   └── WardProfileHeader.tsx
├── Results/
│   ├── WardResultsTable.tsx
│   ├── WardPerformanceChart.tsx
│   └── ResultCard.tsx
├── Links/
│   ├── PendingLinksList.tsx
│   ├── ActiveLinksList.tsx
│   └── RequestLinkModal.tsx
├── Calendar/
│   ├── CalendarGrid.tsx
│   ├── EventCard.tsx
│   └── EventList.tsx
└── shared/
    ├── WardProgressRing.tsx
    ├── GuardianStatsCard.tsx
    └── GuardianEmptyState.tsx
```

### API Integration

```typescript
// Guardian API client additions
export const guardianApi = {
  getWards: () => api.get('/guardian/wards'),
  getWardResults: (wardId: number) => api.get(`/guardian/wards/${wardId}/results`),
  getWardReportCard: (wardId: number) => api.get(`/guardian/wards/${wardId}/report-card`),
  getWardExams: (wardId: number) => api.get(`/guardian/wards/${wardId}/exams`),
  getLinks: () => api.get('/guardian/links'),
  requestLink: (studentId: number, relationship: string) => 
    api.post('/guardian/links', { student_id: studentId, relationship }),
  cancelLink: (linkId: number) => api.delete(`/guardian/links/${linkId}`),
};
```

### State Management

```typescript
// Guardian context
interface GuardianContextType {
  wards: Ward[];
  selectedWard: Ward | null;
  setSelectedWard: (ward: Ward | null) => void;
  refreshWards: () => Promise<void>;
  loading: boolean;
}
```

---

## Design Tokens (CSS Variables)

```css
:root {
  /* Guardian-specific colors */
  --guardian-primary: #6366F1;
  --guardian-primary-light: #818CF8;
  --guardian-primary-dark: #4F46E5;
  
  /* Progress ring colors */
  --ring-excellent: #10B981;
  --ring-good: #3B82F6;
  --ring-attention: #F59E0B;
  --ring-critical: #EF4444;
  
  /* Spacing */
  --guardian-gap: 16px;
  --guardian-padding: 24px;
  --guardian-radius: 12px;
  
  /* Shadows */
  --guardian-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  --guardian-shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

---

## PWA & Mobile Design

### Mobile-First Architecture

The Guardian interface is designed as a **mobile-first PWA** that works seamlessly on smartphones and tablets.

**Design Principles:**
1. **Thumb-Friendly**: All primary actions within thumb reach
2. **Touch-Optimized**: Minimum 44x44px tap targets
3. **Swipe-Enabled**: Natural gesture navigation
4. **Offline-Capable**: Core functionality works without internet
5. **Installable**: Add to home screen for native-like experience

### Mobile Layout Structure

```
┌─────────────────────────────────────┐
│  [Status Bar]                       │
├─────────────────────────────────────┤
│  [Header]                           │
│  Guardian Portal                    │
├─────────────────────────────────────┤
│                                     │
│  [Main Content Area]                │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Content scrolls here       │    │
│  │                             │    │
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
├─────────────────────────────────────┤
│  [Bottom Navigation Bar]            │
│  🏠    👨‍👩‍👧‍👦    🔗    📅    ⚙️      │
│  Home  Wards Links Calendar Settings│
└─────────────────────────────────────┘
```

### Bottom Navigation Bar

The primary navigation is a **fixed bottom bar** for easy thumb access:

```typescript
const bottomNavItems = [
  { 
    label: "Home", 
    href: "/guardian/dashboard", 
    icon: <HomeIcon />,
    activeIcon: <HomeIconActive />
  },
  { 
    label: "Wards", 
    href: "/guardian/wards", 
    icon: <WardsIcon />,
    activeIcon: <WardsIconActive />
  },
  { 
    label: "Links", 
    href: "/guardian/links", 
    icon: <LinkIcon />,
    activeIcon: <LinkIconActive />
  },
  { 
    label: "Calendar", 
    href: "/guardian/calendar", 
    icon: <CalendarIcon />,
    activeIcon: <CalendarIconActive />
  },
  { 
    label: "Settings", 
    href: "/guardian/settings", 
    icon: <SettingsIcon />,
    activeIcon: <SettingsIconActive />
  }
];
```

### Mobile Dashboard Design

**Layout:**
```
┌─────────────────────────────────────┐
│  Good evening, [Name]               │
│  Here's what's happening today      │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Quick Stats                │    │
│  │  ┌─────┐ ┌─────┐ ┌─────┐  │    │
│  │  │  2  │ │ 78% │ │  3  │  │    │
│  │  │Wards│ │ Avg │ │Alert│  │    │
│  │  └─────┘ └─────┘ └─────┘  │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Recent Results             │    │
│  │  ─────────────────────────  │    │
│  │  John - Math - 85%  ✓      │    │
│  │  Jane - English - 72%  ✓   │    │
│  │  John - Science - 91%  ✓   │    │
│  │                             │    │
│  │  [View All] →               │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Upcoming Events            │    │
│  │  ─────────────────────────  │    │
│  │  📅 Mar 15: Mid-term Exam   │    │
│  │  📅 Mar 22: Parent Meeting  │    │
│  │                             │    │
│  │  [View Calendar] →          │    │
│  └─────────────────────────────┘    │
│                                     │
└─────────────────────────────────────┘
```

### Mobile Ward Card Design

**Touch-Optimized Card:**
```
┌─────────────────────────────────────┐
│  ┌─────┐                           │
│  │     │  John Doe                  │
│  │  📷 │  JSS 2 • Reg: STD/2024/001│
│  │     │  Son                       │
│  └─────┘                           │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ████████████████░░░░  82%  │    │
│  │  Average Score              │    │
│  └─────────────────────────────┘    │
│                                     │
│  [Results]  [Report Card]  [Exams]  │
│                                     │
└─────────────────────────────────────┘
```

### Mobile Results Table

**Swipeable Table:**
```
┌─────────────────────────────────────┐
│  John Doe - First Term 2026/2027   │
├─────────────────────────────────────┤
│                                     │
│  ← Swipe for more columns →         │
│                                     │
│  ┌────────────┬─────┬─────┬─────┐  │
│  │ Subject    │ CA  │Exam │Total│  │
│  ├────────────┼─────┼─────┼─────┤  │
│  │ Mathematics│ 45  │ 40  │ 85  │  │
│  │ English    │ 38  │ 34  │ 72  │  │
│  │ Science    │ 48  │ 43  │ 91  │  │
│  └────────────┴─────┴─────┴─────┘  │
│                                     │
│  Average: 82% │ Position: 3rd/35   │
│                                     │
└─────────────────────────────────────┘
```

### Mobile Interaction Patterns

**1. Pull-to-Refresh:**
```typescript
// Pull down to refresh data
const pullToRefresh = {
  threshold: 80,
  onRefresh: async () => {
    await refreshWards();
    await refreshResults();
  }
};
```

**2. Swipe Navigation:**
```typescript
// Swipe left/right to navigate between wards
const swipeNavigation = {
  onSwipeLeft: () => nextWard(),
  onSwipeRight: () => previousWard()
};
```

**3. Long Press Menu:**
```typescript
// Long press on ward card for quick actions
const longPressMenu = {
  items: [
    { label: "View Results", action: () => viewResults() },
    { label: "View Report Card", action: () => viewReportCard() },
    { label: "View Exams", action: () => viewExams() }
  ]
};
```

**4. Bottom Sheet:**
```typescript
// Bottom sheet for detailed information
const bottomSheet = {
  handleIndicator: true,
  snapPoints: [25, 50, 90],
  content: <WardDetails />
};
```

### Mobile Gestures

| Gesture | Action |
|---------|--------|
| Tap | Select item |
| Long Press | Open context menu |
| Swipe Left | Navigate to next item |
| Swipe Right | Navigate to previous item |
| Pull Down | Refresh data |
| Pinch | Zoom in/out (charts) |
| Double Tap | Like/favorite |

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
```typescript
// Background sync when connection restored
self.addEventListener('sync', (event) => {
  if (event.tag === 'guardian-sync') {
    event.waitUntil(syncGuardianData());
  }
});
```

### Push Notification Design

**Notification Types:**
1. **Result Published** — "New result available for John: Mathematics - 85%"
2. **Report Card Ready** — "Term report card is ready for Jane"
3. **Exam Scheduled** — "Mid-term exam scheduled for John: March 15-19"
4. **Event Reminder** — "Parent-Teacher meeting tomorrow at 10 AM"

**Notification Actions:**
- "View Details" — Opens relevant page
- "Dismiss" — Closes notification
- "Snooze" — Reminds later

### Mobile Performance Optimization

**1. Lazy Loading:**
```typescript
// Lazy load images and heavy components
const LazyImage = dynamic(() => import('./LazyImage'), { ssr: false });
```

**2. Virtual Scrolling:**
```typescript
// Virtual scrolling for long lists
import { FixedSizeList as List } from 'react-window';

const VirtualizedList = ({ items }) => (
  <List
    height={600}
    itemCount={items.length}
    itemSize={80}
    width="100%"
  >
    {({ index, style }) => (
      <div style={style}>
        <WardCard ward={items[index]} />
      </div>
    )}
  </List>
);
```

**3. Optimistic Updates:**
```typescript
// Optimistic UI updates for better UX
const handleLinkRequest = async (studentId: number) => {
  // Optimistically add to UI
  setPendingLinks([...pendingLinks, { studentId, status: 'pending' }]);
  
  try {
    await api.post('/guardian/links', { student_id: studentId });
  } catch (error) {
    // Revert on error
    setPendingLinks(pendingLinks.filter(l => l.studentId !== studentId));
  }
};
```

### Mobile Accessibility

**Touch Accessibility:**
- Minimum 44x44px touch targets
- High contrast mode support
- Screen reader optimized
- Voice navigation support

**Visual Accessibility:**
- Scalable text (up to 200%)
- High contrast colors
- Reduced motion support
- Dark mode support

### PWA Installation Flow

**iOS Installation:**
1. Open Safari and visit guardian URL
2. Tap Share button
3. Select "Add to Home Screen"
4. Confirm installation
5. App appears on home screen

**Android Installation:**
1. Open Chrome and visit guardian URL
2. Tap "Add to Home Screen" prompt
3. Confirm installation
4. App appears on home screen

**Desktop Installation:**
1. Open Chrome/Edge and visit guardian URL
2. Click install icon in address bar
3. Confirm installation
4. App launches in windowed mode

## Summary

The Guardian UI design prioritizes:

1. **Clarity** — Information is presented without clutter
2. **Trust** — Consistent, predictable interactions
3. **Connection** — Clear links between guardian and ward data
4. **Calm** — Soothing color palette that reduces anxiety
5. **Action** — Clear CTAs for important tasks
6. **Mobile-First** — Touch-optimized for smartphone use
7. **Offline-Capable** — Core functionality without internet
8. **Installable** — PWA for native-like experience

The design follows the existing ExamPool patterns while establishing a distinct visual identity for the guardian experience through the indigo primary color and the signature Ward Progress Ring element.

**Key Mobile Features:**
- Bottom navigation for thumb access
- Swipe gestures for navigation
- Pull-to-refresh for data updates
- Push notifications for real-time alerts
- Offline caching for core data
- Touch-optimized interactions
